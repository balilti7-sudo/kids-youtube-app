'use strict';

/**
 * Rotating pool of YouTube cookies stored in Supabase (`youtube_cookies` table,
 * migration 061). The ingest worker claims one 'active' cookie per job, writes
 * it to a temp Netscape cookies.txt file for yt-dlp, and burns it when yt-dlp
 * exits with "Error code: 152" (session-level bot block).
 *
 * Selection is least-recently-used: `last_used_at ASC NULLS FIRST`, so fresh
 * cookies are tried first and usage spreads across the pool.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const streamStatusStore = require('./stream-status-store.cjs');

const TABLE = 'youtube_cookies';

function getClient() {
  return streamStatusStore.getClient();
}

function isConfigured() {
  return Boolean(getClient());
}

/**
 * Fetch the next 'active' cookie, skipping any ids already tried for this job.
 * Returns { id, label, cookieContent } or null when the pool is empty/exhausted.
 * Best-effort touches last_used_at so LRU ordering keeps rotating.
 */
async function fetchActiveCookie({ excludeIds = [] } = {}) {
  const sb = getClient();
  if (!sb) return null;

  let query = sb
    .from(TABLE)
    .select('id, label, cookie_content')
    .eq('status', 'active')
    .order('last_used_at', { ascending: true, nullsFirst: true })
    .limit(1);

  if (excludeIds.length > 0) {
    query = query.not('id', 'in', `(${excludeIds.map((id) => `"${id}"`).join(',')})`);
  }

  const { data, error } = await query;
  if (error) {
    console.warn(`[cookie-pool] fetchActiveCookie failed: ${error.message}`);
    return null;
  }
  const row = data?.[0];
  if (!row?.cookie_content) return null;

  const { error: touchErr } = await sb
    .from(TABLE)
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', row.id);
  if (touchErr) {
    console.warn(`[cookie-pool] last_used_at touch failed for ${row.id}: ${touchErr.message}`);
  }

  return { id: row.id, label: row.label || null, cookieContent: row.cookie_content };
}

/**
 * Mark a cookie as burned (yt-dlp 152 while it was in use). The record is kept
 * for auditing; replenish the pool by inserting new 'active' rows.
 */
async function burnCookie(id, reason = 'yt-dlp exit 152') {
  const sb = getClient();
  if (!sb || !id) return false;

  const { error } = await sb
    .from(TABLE)
    .update({
      status: 'burned',
      burned_at: new Date().toISOString(),
      burn_reason: String(reason).slice(0, 500),
    })
    .eq('id', id);

  if (error) {
    console.warn(`[cookie-pool] burnCookie failed for ${id}: ${error.message}`);
    return false;
  }
  console.warn(`[cookie-pool] cookie ${id} marked BURNED (${reason})`);
  return true;
}

async function countActiveCookies() {
  const sb = getClient();
  if (!sb) return 0;
  const { count, error } = await sb
    .from(TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active');
  if (error) {
    console.warn(`[cookie-pool] countActiveCookies failed: ${error.message}`);
    return 0;
  }
  return count || 0;
}

/**
 * Write cookie content to a private temp file yt-dlp can consume via --cookies.
 * Returns the file path; caller must cleanupCookieFile() when the job ends.
 */
function writeCookieTempFile(cookieContent, id = 'pool') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-cookies-'));
  const filePath = path.join(dir, `cookies-${String(id).slice(0, 8)}.txt`);
  let content = String(cookieContent);
  // yt-dlp requires the Netscape header line; tolerate rows pasted without it.
  if (!/^#\s*(Netscape )?HTTP Cookie File/im.test(content)) {
    content = `# Netscape HTTP Cookie File\n${content}`;
  }
  if (!content.endsWith('\n')) content += '\n';
  fs.writeFileSync(filePath, content, { mode: 0o600 });
  return filePath;
}

function cleanupCookieFile(filePath) {
  if (!filePath) return;
  try {
    fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
  } catch (err) {
    console.warn(`[cookie-pool] temp cleanup failed for ${filePath}: ${err?.message || err}`);
  }
}

module.exports = {
  isConfigured,
  fetchActiveCookie,
  burnCookie,
  countActiveCookies,
  writeCookieTempFile,
  cleanupCookieFile,
};
