'use strict';

/** Skip yt-dlp binary check when the bridge only proxies client-side / InnerTube resolve. */
const clientMode = String(process.env.USE_CLIENT_STREAM_RESOLVE || '')
  .trim()
  .toLowerCase();
if (clientMode === '1' || clientMode === 'true' || clientMode === 'yes') {
  console.log('[prestart] USE_CLIENT_STREAM_RESOLVE=1 — skipping yt-dlp binary check');
  process.exit(0);
}

const { spawnSync } = require('child_process');
const path = require('path');
const result = spawnSync(process.execPath, [path.join(__dirname, 'ensure-ytdlp.cjs'), '--strict'], {
  stdio: 'inherit',
});
process.exit(result.status === null ? 1 : result.status);
