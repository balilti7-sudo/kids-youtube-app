'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SERVER_DIR = __dirname;

function localBinaryPath() {
  return process.platform === 'win32'
    ? path.join(SERVER_DIR, 'yt-dlp.exe')
    : path.join(SERVER_DIR, 'yt-dlp');
}

function resolveBinary() {
  const explicit = (process.env.YT_DLP_BINARY_PATH || '').trim();
  return explicit || localBinaryPath();
}

/**
 * chmod +x local yt-dlp; optionally verify with --version.
 * @returns {{ ok: boolean, binary: string, version?: string, error?: string }}
 */
function ensureYtDlpBinary({ strict = false, probe = strict } = {}) {
  const binary = resolveBinary();
  const isLocalPath =
    binary.includes(path.sep) || binary.includes('/') || binary.includes('\\');

  if (isLocalPath && !fs.existsSync(binary)) {
    const error = `yt-dlp binary missing: ${binary} (run npm run download-tools)`;
    if (strict) throw new Error(error);
    console.warn(`[ensure-ytdlp] ${error}`);
    return { ok: false, binary, error };
  }

  if (process.platform !== 'win32' && isLocalPath) {
    fs.chmodSync(binary, 0o755);
    const mode = fs.statSync(binary).mode & 0o777;
    console.log(`[ensure-ytdlp] chmod +x ${binary} (mode=${mode.toString(8)})`);
  }

  if (!probe) {
    return { ok: true, binary };
  }

  const result = spawnSync(binary, ['--version'], {
    encoding: 'utf8',
    timeout: 20_000,
    env: process.env,
  });

  if (result.error) {
    const error = `probe spawn failed: ${result.error.message} code=${result.error.code || '?'} errno=${result.error.errno || '?'}`;
    if (strict) {
      const err = new Error(error);
      err.stderr = result.stderr || '';
      throw err;
    }
    console.warn(`[ensure-ytdlp] ${error}`);
    return { ok: false, binary, error };
  }

  if (result.status !== 0) {
    const error = `--version exited ${result.status}`;
    const stderr = (result.stderr || '').trim();
    const stdout = (result.stdout || '').trim();
    console.error(`[ensure-ytdlp] ${error} binary=${binary} stderr=${stderr} stdout=${stdout}`);
    if (strict) {
      const err = new Error(error);
      err.stderr = stderr;
      err.stdout = stdout;
      err.exitCode = result.status;
      throw err;
    }
    return { ok: false, binary, error, stderr, stdout };
  }

  const version = (result.stdout || '').trim().split(/\r?\n/)[0] || 'unknown';
  console.log(`[ensure-ytdlp] ok binary=${binary} version=${version}`);
  return { ok: true, binary, version };
}

if (require.main === module) {
  const strict = process.argv.includes('--strict');
  try {
    ensureYtDlpBinary({ strict, probe: strict });
  } catch (err) {
    console.error(`[ensure-ytdlp] fatal: ${err.message}`);
    if (err.stderr) console.error(`[ensure-ytdlp] stderr:\n${err.stderr}`);
    process.exit(1);
  }
}

module.exports = {
  ensureYtDlpBinary,
  resolveBinary,
  localBinaryPath,
};
