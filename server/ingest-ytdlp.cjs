'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const SERVER_DIR = __dirname;
const YT_DLP_TIMEOUT_MS = Number(process.env.YT_DLP_TIMEOUT_MS || 90_000);
const YT_DLP_LONG_TIMEOUT_MS = Number(process.env.YT_DLP_LONG_TIMEOUT_MS || 300_000);
const LONG_VIDEO_DURATION_SEC = Number(process.env.LONG_VIDEO_DURATION_SEC || 65);
const YT_DLP_COOKIES_FILE = (process.env.YT_DLP_COOKIES_FILE || '').trim();
const YT_DLP_FORMAT = (process.env.YT_DLP_FORMAT || '').trim();
const YT_DLP_EXTRACTOR_ARGS = (
  process.env.YT_DLP_EXTRACTOR_ARGS ||
  process.env.YT_DLP_PRIMARY_EXTRACTOR_ARGS ||
  ''
).trim();
const YT_DLP_PLUGIN_DIRS = (
  process.env.YT_DLP_PLUGIN_DIRS || path.join(SERVER_DIR, 'yt-dlp-plugins')
).trim();
const YT_DLP_EXTRA_ARGS = (process.env.YT_DLP_EXTRA_ARGS || '').trim();
const BROWSER_USER_AGENT = (
  process.env.BROWSER_USER_AGENT || process.env.MEDIA_USER_AGENT || ''
).trim();

function resolveYtDlpBinary() {
  const explicit = (process.env.YT_DLP_BINARY_PATH || '').trim();
  if (explicit) return explicit;
  const local =
    process.platform === 'win32'
      ? path.join(SERVER_DIR, 'yt-dlp.exe')
      : path.join(SERVER_DIR, 'yt-dlp');
  if (fs.existsSync(local)) return local;
  return process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
}

function isAvailable() {
  try {
    const binary = resolveYtDlpBinary();
    if (binary.includes(path.sep) || binary.includes('/') || binary.includes('\\')) {
      return fs.existsSync(binary);
    }
    return true;
  } catch {
    return false;
  }
}

function youtubeWatchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

function qualityToFormat(quality) {
  if (YT_DLP_FORMAT) return YT_DLP_FORMAT;
  const height = parseInt(String(quality || '360p'), 10) || 360;
  return `best[height<=${height}][ext=mp4]/best[height<=${height}]/18/best[ext=mp4]/best`;
}

function buildBaseArgs() {
  const args = ['--no-warnings', '--no-playlist'];
  if (YT_DLP_PLUGIN_DIRS && fs.existsSync(YT_DLP_PLUGIN_DIRS)) {
    args.push('--plugin-dirs', YT_DLP_PLUGIN_DIRS);
  }
  if (BROWSER_USER_AGENT) {
    args.push('--user-agent', BROWSER_USER_AGENT);
  }
  if (YT_DLP_COOKIES_FILE && fs.existsSync(YT_DLP_COOKIES_FILE)) {
    args.push('--cookies', YT_DLP_COOKIES_FILE);
  }
  if (YT_DLP_EXTRACTOR_ARGS) {
    args.push('--extractor-args', YT_DLP_EXTRACTOR_ARGS);
  }
  if (YT_DLP_EXTRA_ARGS) {
    args.push(...YT_DLP_EXTRA_ARGS.split(/\s+/).filter(Boolean));
  }
  return args;
}

function ensureYtDlpExecutable(binary) {
  if (process.platform === 'win32') return;
  if (!binary || !fs.existsSync(binary)) return;
  try {
    fs.chmodSync(binary, 0o755);
  } catch (err) {
    console.warn(`[ingest-ytdlp] chmod +x failed binary=${binary}: ${err.message}`);
  }
}

function buildYtDlpError(message, { stderr = '', stdout = '', exitCode = null, spawnErr = null } = {}) {
  const err = new Error(message);
  err.stderr = stderr;
  err.stdout = stdout;
  err.exitCode = exitCode;
  if (spawnErr) {
    err.spawnCode = spawnErr.code;
    err.spawnErrno = spawnErr.errno;
  }
  return err;
}

function logYtDlpFailure(label, binary, args, err) {
  console.error(`[ingest-ytdlp] ${label} FAILED binary=${binary}`);
  console.error(`[ingest-ytdlp] ${label} args=${JSON.stringify(args)}`);
  console.error(`[ingest-ytdlp] ${label} error.message=${err.message}`);
  if (err.spawnCode) console.error(`[ingest-ytdlp] ${label} spawn.code=${err.spawnCode}`);
  if (err.spawnErrno) console.error(`[ingest-ytdlp] ${label} spawn.errno=${err.spawnErrno}`);
  if (err.exitCode != null) console.error(`[ingest-ytdlp] ${label} exitCode=${err.exitCode}`);
  if (err.stderr) console.error(`[ingest-ytdlp] ${label} stderr:\n${err.stderr}`);
  if (err.stdout) console.error(`[ingest-ytdlp] ${label} stdout:\n${err.stdout}`);
}

function runYtDlpOnce(binary, args, { timeoutMs, label }) {
  return new Promise((resolve, reject) => {
    console.log(`[ingest-ytdlp] ${label} spawn binary=${binary} timeout=${timeoutMs}ms`);
    console.log(`[ingest-ytdlp] ${label} args=${JSON.stringify(args)}`);

    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (fn) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      const err = buildYtDlpError(`yt-dlp timed out after ${timeoutMs}ms`, { stderr, stdout });
      err.fileNotReady = true;
      logYtDlpFailure(label, binary, args, err);
      finish(() => reject(err));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (spawnErr) => {
      clearTimeout(timer);
      const err = buildYtDlpError(`yt-dlp spawn failed (${binary}): ${spawnErr.message}`, {
        stderr,
        stdout,
        spawnErr,
      });
      logYtDlpFailure(label, binary, args, err);
      finish(() => reject(err));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const detail = (stderr || stdout).trim();
        const err = buildYtDlpError(`yt-dlp exited ${code}: ${detail.slice(0, 800) || 'no output'}`, {
          stderr,
          stdout,
          exitCode: code,
        });
        if (/private|unavailable|age|sign in|bot|429|rate/i.test(detail)) {
          err.fileNotReady = false;
        }
        logYtDlpFailure(label, binary, args, err);
        finish(() => reject(err));
        return;
      }
      finish(() => resolve({ stdout: stdout.trim(), stderr: stderr.trim() }));
    });
  });
}

async function runYtDlp(extraArgs, { timeoutMs = YT_DLP_TIMEOUT_MS, label = 'yt-dlp' } = {}) {
  const binary = resolveYtDlpBinary();
  const args = [...buildBaseArgs(), ...extraArgs];
  ensureYtDlpExecutable(binary);

  try {
    return await runYtDlpOnce(binary, args, { timeoutMs, label });
  } catch (firstErr) {
    const permissionDenied =
      firstErr.spawnCode === 'EACCES' ||
      firstErr.spawnCode === 'ENOENT' ||
      /EACCES|permission denied|not found/i.test(firstErr.message);

    if (!permissionDenied || process.platform === 'win32') {
      throw firstErr;
    }

    console.warn(`[ingest-ytdlp] ${label} retrying after chmod binary=${binary}`);
    ensureYtDlpExecutable(binary);

    try {
      return await runYtDlpOnce(binary, args, { timeoutMs, label: `${label}-retry` });
    } catch (retryErr) {
      throw retryErr;
    }
  }
}

function pickDirectUrl(stdout) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^https?:\/\//i.test(line));
  if (lines.length === 0) return null;
  const combined = lines.find((line) => /mime=video%2Fmp4|itag=18|\.mp4/i.test(line));
  return combined || lines[0];
}

/**
 * Resolve a direct, publicly fetchable media URL for Bunny ingest via `yt-dlp -g`.
 */
async function resolveVideoDownloadUrl(videoId, quality = '360p', options = {}) {
  if (!isAvailable()) {
    throw new Error(
      'yt-dlp binary not found — run `npm run download-tools` in server/ or set YT_DLP_BINARY_PATH'
    );
  }

  const watchUrl = youtubeWatchUrl(videoId);
  const format = qualityToFormat(quality);
  let timeoutMs = Number(options.timeoutMs) || YT_DLP_TIMEOUT_MS;

  if (!options.timeoutMs) {
    try {
      const info = await getVideoInfo(videoId, { timeoutMs: Math.min(YT_DLP_TIMEOUT_MS, 45_000) });
      const duration = Number(info.lengthSeconds) || 0;
      if (duration <= 0 || duration > LONG_VIDEO_DURATION_SEC) {
        timeoutMs = YT_DLP_LONG_TIMEOUT_MS;
      }
    } catch {
      timeoutMs = YT_DLP_LONG_TIMEOUT_MS;
    }
  }

  const { stdout } = await runYtDlp(['-g', '-f', format, watchUrl], {
    timeoutMs,
    label: `get-url video=${videoId} quality=${quality}`,
  });

  const url = pickDirectUrl(stdout);
  if (!url) {
    throw new Error('yt-dlp returned no direct media URL');
  }

  console.log(`[ingest-ytdlp] direct url video=${videoId} url=${url.slice(0, 96)}…`);

  return {
    url,
    quality,
    mime: 'video/mp4',
    ingestResolver: 'yt-dlp',
  };
}

async function getVideoInfo(videoId, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || Math.min(YT_DLP_TIMEOUT_MS, 60_000);
  if (!isAvailable()) {
    return {
      title: null,
      lengthSeconds: null,
      thumbnail: [],
      isLiveContent: false,
      liveBroadcastDetails: { isLiveNow: false },
    };
  }

  try {
    const { stdout } = await runYtDlp(['--dump-single-json', '--skip-download', youtubeWatchUrl(videoId)], {
      timeoutMs,
      label: `info video=${videoId}`,
    });
    const data = JSON.parse(stdout);
    return {
      title: data.title || null,
      lengthSeconds: Number.isFinite(data.duration) ? Math.round(data.duration) : null,
      author: data.uploader || data.channel || null,
      ownerChannelName: data.channel || data.uploader || null,
      externalChannelId: data.channel_id || null,
      thumbnail: data.thumbnail ? [{ url: data.thumbnail }] : [],
      isLiveContent: Boolean(data.is_live),
      liveBroadcastDetails: { isLiveNow: Boolean(data.is_live) },
    };
  } catch (err) {
    console.warn(`[ingest-ytdlp] getVideoInfo failed video=${videoId}: ${err.message}`);
    return {
      title: null,
      lengthSeconds: null,
      thumbnail: [],
      isLiveContent: false,
      liveBroadcastDetails: { isLiveNow: false },
    };
  }
}

module.exports = {
  resolveVideoDownloadUrl,
  getVideoInfo,
  isAvailable,
  resolveYtDlpBinary,
  YT_DLP_TIMEOUT_MS,
  YT_DLP_LONG_TIMEOUT_MS,
};
