'use strict';

/**
 * Generates YouTube PO Tokens (Proof of Origin) via BotGuard attestation.
 *
 * As of 2026, YouTube requires a valid PO Token bound to a session (visitorData) and,
 * for playback, to the specific video ID, for most InnerTube clients (WEB, MWEB, ANDROID,
 * IOS) on datacenter/cloud IPs — this is what produces "Sign in to confirm you're not a
 * bot" even with a correct User-Agent and (for some clients) valid cookies.
 *
 * This runs BotGuard's obfuscated attestation VM inside a JSDOM-simulated browser
 * environment (the same technique used by yt-dlp's PO Token providers and by
 * invidious-companion). It does not bypass BotGuard — it provides a compliant runtime
 * that BotGuard accepts, then mints tokens from the resulting integrity token.
 *
 * Reference: https://github.com/LuanRT/BgUtils
 *
 * Trade-off: this sets global `window`/`document`/`navigator` (via JSDOM) once per
 * process so BotGuard's VM has a browser-like environment to run in. This is the
 * standard approach for server-side BotGuard, but it is a real process-wide side
 * effect — acceptable here since this bridge has no other code relying on those
 * globals being undefined.
 */

const { JSDOM } = require('jsdom');
const mediaProxy = require('./media-proxy.cjs');

/** Public "WEB" BotGuard request key used by all known self-hosted BotGuard integrations. */
const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo';

/** Re-mint a fresh session even if nothing has reported failure — integrity tokens expire. */
const MAX_SESSION_AGE_MS = Number(process.env.PO_TOKEN_SESSION_TTL_MS || 55 * 60 * 1000);

let domInitialized = false;
let sessionPromise = null;
let sessionCreatedAt = 0;

let domUserAgent = null;

function ensureDom(userAgent) {
  if (domInitialized && domUserAgent === userAgent) return;
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
    url: 'https://www.youtube.com/',
    referrer: 'https://www.youtube.com/',
    userAgent: userAgent || undefined,
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
  });
  domInitialized = true;
  domUserAgent = userAgent;
}

async function loadBgUtils() {
  return require('bgutils-js');
}

async function loadYoutubei() {
  return import('youtubei.js');
}

/**
 * Wraps fetch so every BotGuard/attestation network call carries the same User-Agent as
 * the actual playback session, and — when a residential/rotating proxy is configured —
 * goes out through it instead of Render's own egress. A mismatch between the "browser"
 * that solved the BotGuard challenge and the one making the real request is exactly the
 * kind of inconsistency an attestation/fingerprinting system is designed to flag, and if
 * Render's IP is what's actually gated, the challenge itself must run from the proxy too
 * (not just the playback session) or the two halves of the attestation won't agree.
 */
function createUaFetch(userAgent) {
  return (input, init = {}) => {
    const headers = new Headers(init?.headers);
    if (userAgent) headers.set('User-Agent', userAgent);
    const dispatcher = mediaProxy.getProxyDispatcher();
    return globalThis.fetch(input, { ...init, headers, ...(dispatcher ? { dispatcher } : {}) });
  };
}

/**
 * Generates a fresh visitorData, runs the BotGuard challenge, and returns a minter
 * that can mint additional PO Tokens (per-video content-bound, or session-bound) cheaply
 * without re-running the VM challenge each time.
 *
 * @param {string} [userAgent] - Must match the User-Agent used by the actual playback
 * sessions (MEDIA_USER_AGENT) so the attested environment matches the requesting one.
 */
async function createSession(userAgent) {
  ensureDom(userAgent);
  const { BG } = await loadBgUtils();
  const { Innertube } = await loadYoutubei();
  const uaFetch = createUaFetch(userAgent);

  const bare = await Innertube.create({
    retrieve_player: false,
    user_agent: userAgent || undefined,
    fetch: uaFetch,
  });
  const visitorData = bare.session.context.client.visitorData;
  if (!visitorData) {
    throw new Error('PO Token: could not obtain visitorData from InnerTube');
  }

  const bgConfig = {
    fetch: uaFetch,
    globalObj: globalThis,
    identifier: visitorData,
    requestKey: REQUEST_KEY,
  };

  const challenge = await BG.Challenge.create(bgConfig);
  if (!challenge) {
    throw new Error('PO Token: BotGuard did not return a challenge');
  }

  const interpreterJavascript =
    challenge.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue;
  if (!interpreterJavascript) {
    throw new Error('PO Token: BotGuard challenge missing interpreter script');
  }
  // eslint-disable-next-line no-new-func
  new Function(interpreterJavascript)();

  const botguard = await BG.BotGuardClient.create({
    program: challenge.program,
    globalName: challenge.globalName,
    globalObj: globalThis,
  });

  const webPoSignalOutput = [];
  const botguardResponse = await botguard.snapshot({ webPoSignalOutput });

  const itRes = await uaFetch(
    `https://jnn-pa.googleapis.com/$rpc/google.internal.waa.v1.Waa/GenerateIT`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json+protobuf',
        'x-goog-api-key': 'AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw',
        'x-user-agent': 'grpc-web-javascript/0.1',
      },
      body: JSON.stringify([REQUEST_KEY, botguardResponse]),
    }
  );
  if (!itRes.ok) {
    throw new Error(`PO Token: GenerateIT request failed (${itRes.status})`);
  }
  const [integrityToken] = await itRes.json();
  if (!integrityToken) {
    throw new Error('PO Token: GenerateIT returned no integrity token');
  }

  const minter = await BG.WebPoMinter.create({ integrityToken }, webPoSignalOutput);
  const sessionPoToken = await minter.mintAsWebsafeString(visitorData);

  console.log(
    `[po-token] BotGuard session ready visitorData=${visitorData.slice(0, 24)}… sessionPoToken=${sessionPoToken.slice(0, 16)}… ua=${(userAgent || '(default)').slice(0, 48)}…`
  );

  return { minter, sessionPoToken, visitorData, createdAt: Date.now() };
}

let sessionUserAgent = null;

function isStale(userAgent) {
  return (
    !sessionPromise ||
    Date.now() - sessionCreatedAt > MAX_SESSION_AGE_MS ||
    sessionUserAgent !== userAgent
  );
}

/**
 * Returns (creating/refreshing as needed) the shared BotGuard session: a visitorData,
 * a session-bound PO Token (for the `pot` query param on stream URLs), and a mint
 * function for per-video content-bound PO Tokens.
 *
 * @param {string} [userAgent] - Should match the playback session's MEDIA_USER_AGENT.
 * @returns {Promise<{visitorData: string, sessionPoToken: string, mintContentBoundToken: (id: string) => Promise<string>}>}
 */
async function getPoTokenSession(userAgent) {
  if (isStale(userAgent)) {
    sessionCreatedAt = Date.now();
    sessionUserAgent = userAgent;
    sessionPromise = createSession(userAgent).catch((err) => {
      sessionPromise = null;
      throw err;
    });
  }
  const session = await sessionPromise;
  return {
    visitorData: session.visitorData,
    sessionPoToken: session.sessionPoToken,
    mintContentBoundToken: (id) => session.minter.mintAsWebsafeString(id),
  };
}

function invalidate() {
  sessionPromise = null;
  sessionCreatedAt = 0;
}

module.exports = { getPoTokenSession, invalidate };
