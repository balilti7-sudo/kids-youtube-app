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
