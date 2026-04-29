# SafeTube Media Bridge

Express service that turns a YouTube `videoId` into a **direct stream URL** (MP4 or HLS) for a custom player (e.g. Video.js).

1. Tries public **Piped** API instances (`PIPED_API_BASES`).
2. Falls back to **`@distube/ytdl-core`** if Piped does not return a usable stream.

## Run

```bash
cd server
npm install
cp .env.example .env
npm run dev
```

- Health: `GET http://127.0.0.1:8787/health`
- Stream: `GET http://127.0.0.1:8787/api/stream/{videoId}`

Response is JSON, e.g.:

```json
{
  "videoId": "dQw4w9WgXcQ",
  "url": "https://...",
  "format": "direct",
  "mimeType": "video/mp4; codecs=\"...\"",
  "quality": "360p",
  "source": "ytdl",
  "note": "URL may be short-lived; set src on the player immediately."
}
```

## Production notes

- Do **not** expose this to the public internet without **authentication** and **rate limits**.
- Piped public instances and **stream URLs** can break or expire; self-host Piped and/or add retries on the client.
- You (not this repo) are responsible for compliance with applicable laws and platform terms for your use case.

## Integration with the Vite app

Set `VITE_STREAM_API_BASE=http://127.0.0.1:8787` (or your host) in the app `.env` and have the client `fetch` this endpoint, then set Video.js’ `src` to `response.url`.

## Deploy (Render / Railway)

### Render (recommended first)

This repo includes a root `render.yaml` that deploys `server/` as a web service.

Required service env vars:

- `CORS_ORIGIN=https://kids-safe-tube.vercel.app`
- `PUBLIC_BASE_URL=https://<your-render-service>.onrender.com`
- `SUPABASE_URL=https://<your-project>.supabase.co`
- `SUPABASE_ANON_KEY=<anon-key>`
- `MEDIA_BRIDGE_GRANT_SECRET=<long-random-secret>`
- `YOUTUBE_COOKIES_FILE=/etc/secrets/youtube.com_cookies.txt`

Also upload your cookies file as a Render secret file at:

- `/etc/secrets/youtube.com_cookies.txt`

### Railway

Create a service from the repo and set:

- Root directory: `server`
- Build command: `npm install`
- Start command: `npm start`

Use the same env vars as Render. For cookies, either:

- Add file storage and point `YOUTUBE_COOKIES_FILE` to it, or
- Set `YOUTUBE_COOKIES` (header-style cookie string) if file mounts are inconvenient.

## After backend is live: update Vercel

Set frontend env var:

- `VITE_STREAM_API_BASE=https://<your-media-bridge-domain>`

Then redeploy Vercel.
