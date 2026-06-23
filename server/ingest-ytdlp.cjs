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

function runYtDlp(extraArgs, { timeoutMs = YT_DLP_TIMEOUT_MS, label = 'yt-dlp' } = {}) {
  return new Promise((resolve, reject) => {
    const binary = resolveYtDlpBinary();
    const args = [...buildBaseArgs(), ...extraArgs];
    console.log(`[ingest-ytdlp] ${label} binary=${binary} timeout=${timeoutMs}ms`);

    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      const err = new Error(`yt-dlp timed out after ${timeoutMs}ms`);
      err.fileNotReady = /timeout/i.test(err.message);
      reject(err);
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (spawnErr) => {
      clearTimeout(timer);
      reject(new Error(`yt-dlp spawn failed (${binary}): ${spawnErr.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const detail = (stderr || stdout).trim().slice(0, 600);
        const err = new Error(`yt-dlp exited ${code}: ${detail || 'no output'}`);
        if (/private|unavailable|age|sign in|bot|429|rate/i.test(detail)) {
          err.fileNotReady = false;
        }
        reject(err);
        return;
      }
      resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
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
