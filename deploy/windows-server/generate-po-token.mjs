#!/usr/bin/env node
/**
 * generate-po-token.mjs
 *
 * Minimal YouTube PO token + visitor_data generator built on `bgutils-js`
 * (0 deps, 80 KB). Replaces `youtube-po-token-generator`, which depended on
 * jsdom and OOM'd on modern YouTube embed pages (Mark-Compact freed ~0 MB
 * at 8 GB heap on both Node 22 LTS and Node 24).
 *
 * Strategy:
 *   1. Fetch visitor_data via the InnerTube /visitor_id endpoint (no scraping).
 *   2. Fetch the BotGuard challenge via bgutils-js.
 *   3. Execute the challenge VM under a tiny browser-global shim (no jsdom).
 *   4. Run the challenge -> integrity token -> mint a PO token.
 *
 * Output (stdout): single line of JSON  {"poToken":"...","visitorData":"..."}
 * Errors (stderr): human-readable, then exit non-zero.
 *
 * Invoked by refresh-pot.ps1 every 4h via the SafeTube-PO-Token-Refresh
 * scheduled task.
 */

import { BG } from 'bgutils-js'
import { JSDOM } from 'jsdom'

const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo' // YouTube's WAA request key (public)
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

// ---- 1. Browser-environment shim via empty JSDOM ---------------------------
// We use jsdom only as a window/document provider (NO URL fetching). This is
// what bgutils-js's official Node example does, and it keeps memory well under
// 200 MB. The previous `youtube-po-token-generator` package OOM'd at 8 GB
// specifically because it asked jsdom to fetch & parse https://www.youtube.com/
// embed pages, which YouTube has bloated to hundreds of MB of inline JS.
const dom = new JSDOM('', { url: 'https://www.youtube.com/', pretendToBeVisual: true })

function setGlobal(name, value) {
  Object.defineProperty(globalThis, name, {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  })
}

setGlobal('window', dom.window)
setGlobal('document', dom.window.document)

// ---- 2. Fetch visitor_data via InnerTube ----------------------------------
async function getVisitorData() {
  // The /visitor_id endpoint requires the InnerTube API key (public for WEB
  // client). Returns responseContext.visitorData.
  const resp = await fetch('https://www.youtube.com/youtubei/v1/visitor_id?prettyPrint=false', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
      'X-YouTube-Client-Name': '1',
      'X-YouTube-Client-Version': '2.20240814.00.00',
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: '2.20240814.00.00',
          hl: 'en',
          gl: 'US',
        },
      },
    }),
  })
  if (!resp.ok) {
    throw new Error(`InnerTube /visitor_id returned HTTP ${resp.status} ${resp.statusText}`)
  }
  const data = await resp.json()
  const vd = data?.responseContext?.visitorData
  if (typeof vd !== 'string' || vd.length < 20) {
    throw new Error('InnerTube /visitor_id response missing visitorData')
  }
  return vd
}

// ---- 3. main --------------------------------------------------------------
const t0 = Date.now()

const visitorData = await getVisitorData()
process.stderr.write(`[generate-po-token] got visitorData (${visitorData.length} chars) in ${Date.now() - t0}ms\n`)

const bgConfig = {
  fetch: (url, init) => fetch(url, init),
  globalObj: globalThis,
  identifier: visitorData,
  requestKey: REQUEST_KEY,
}

const tChallenge = Date.now()
const challenge = await BG.Challenge.create(bgConfig)
process.stderr.write(`[generate-po-token] fetched challenge in ${Date.now() - tChallenge}ms\n`)

const interpreterJs = challenge.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue
if (!interpreterJs) {
  throw new Error('Challenge response missing interpreterJavascript')
}
if (!challenge.program) throw new Error('Challenge response missing program')
if (!challenge.globalName) throw new Error('Challenge response missing globalName')

// Execute the BotGuard VM bootstrap script. This populates globalThis[globalName].
const tVm = Date.now()
new Function(interpreterJs)()
process.stderr.write(`[generate-po-token] loaded BotGuard VM in ${Date.now() - tVm}ms\n`)

if (!globalThis[challenge.globalName]) {
  throw new Error(`BotGuard VM did not register itself at globalThis.${challenge.globalName}`)
}

const tToken = Date.now()
const { poToken } = await BG.PoToken.generate({
  program: challenge.program,
  globalName: challenge.globalName,
  bgConfig,
})
process.stderr.write(`[generate-po-token] minted poToken in ${Date.now() - tToken}ms\n`)

if (typeof poToken !== 'string' || poToken.length < 32) {
  throw new Error(`Generated poToken looks invalid (length=${poToken?.length})`)
}

process.stderr.write(
  `[generate-po-token] DONE in ${Date.now() - t0}ms (poToken ${poToken.length} chars, visitorData ${visitorData.length} chars)\n`
)

// stdout: ONLY the JSON line, parseable by refresh-pot.ps1.
process.stdout.write(JSON.stringify({ poToken, visitorData }) + '\n')
