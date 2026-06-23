# SafeTube Media Bridge

Express service that resolves a YouTube `videoId` into a **Bunny Stream HLS URL** for the SafeTube player.

## Architecture

1. **Ingest** — local **yt-dlp** (`-g` / `--get-url`) resolves a direct YouTube media URL.
2. **Transcode** — Bunny Stream fetches that URL, transcodes, and hosts adaptive HLS on Bunny CDN.
3. **Playback** — the client receives `playlist.m3u8` (`source: bunny`, `proxied: false`).

Async long videos: `GET /api/stream/:id?async=1` → poll `GET /api/stream/:id/status` until `ready`.

## Run locally

```bash
cd server
npm install
npm run download-tools   # downloads yt-dlp (and ffmpeg on Windows) into server/
cp .env.example .env     # set Bunny + Supabase vars
npm run dev
```

- Health: `GET http://127.0.0.1:8787/health`
- Stream: `GET http://127.0.0.1:8787/api/stream/{videoId}?async=1`

Example ready response:

```json
{
  "status": "ready",
  "videoId": "dQw4w9WgXcQ",
  "url": "https://vz-xxxxx.b-cdn.net/{guid}/playlist.m3u8",
  "format": "hls",
  "mimeType": "application/vnd.apple.mpegurl",
  "quality": "360p",
  "source": "bunny",
  "proxied": false
}
```

## Required environment

| Variable | Purpose |
|----------|---------|
| `BUNNY_STREAM_API_KEY` | Bunny Stream library API key |
| `BUNNY_LIBRARY_ID` | Bunny video library ID |
| `BUNNY_CDN_HOSTNAME` | Optional; auto-discovered via Bunny `/play` API if unset |
| `PUBLIC_BASE_URL` | Public bridge origin (Render URL) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Auth / email flows |

## yt-dlp ingest tuning

| Variable | Default | Purpose |
|----------|---------|---------|
| `YT_DLP_BINARY_PATH` | `./yt-dlp` in `server/` | Path to yt-dlp binary |
| `YT_DLP_TIMEOUT_MS` | `90000` | Timeout for short videos |
| `YT_DLP_LONG_TIMEOUT_MS` | `300000` | Timeout for videos > 65s |
| `YT_DLP_FORMAT` | auto by quality | yt-dlp `-f` format string override |
| `YT_DLP_COOKIES_FILE` | — | Netscape cookies file for age-restricted videos |
| `YT_DLP_EXTRACTOR_ARGS` | — | e.g. POT provider args for YouTube |
| `YT_DLP_PLUGIN_DIRS` | `./yt-dlp-plugins` | yt-dlp plugin directory |

Run `npm run download-tools` to install yt-dlp and the bgutil POT plugin zip into `server/yt-dlp-plugins/`.

## Deploy (Render)

Root `render.yaml` deploys `server/` with:

```yaml
buildCommand: npm install && npm run download-tools
```

Set `BUNNY_STREAM_API_KEY`, `BUNNY_LIBRARY_ID`, `BUNNY_CDN_HOSTNAME`, Supabase, and Resend vars in the Render dashboard.

## Frontend integration

Set on Vercel:

```
VITE_STREAM_API_BASE=https://<your-media-bridge>.onrender.com
```

Redeploy the frontend after the bridge is live.
