# SafeTube Bridge — Fix Pack (v1.1)

This pack addresses the four issues in your status update. The two symptoms
you were seeing — *"YouTube demanded Not a robot verification"* and
*"Failed to fetch http://176.9.82.81:3001"* — almost always come from
different root causes, so we fix them separately.

## Files

```
server/index.js          ← rewritten; replaces your existing one
server/pot-client.js     ← new; talks to bgutil-pot on 4416
package.json             ← minimal deps (express, cors)
scripts/install-services.ps1  ← re-installs both NSSM services + firewall rule
scripts/check-health.ps1      ← triage from the VPS or remotely
```

## What each fix does

### (1) yt-dlp uses the bgutil POT *plugin* (recommended)
When `server/yt-dlp-plugins/` contains `bgutil-ytdlp-pot-provider.zip` (from
`npm run download-tools` in the main `server/` folder, or manual download),
yt-dlp loads the plugin and fetches **video-bound** PO tokens automatically:

```
--plugin-dirs server/yt-dlp-plugins
--extractor-args "youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416"
```

Set `YT_DLP_BGUTIL_POT_BASE_URL` (or `POT_URL` on Render) to your bgutil HTTP
provider. **Do not** set `YOUTUBE_PO_TOKEN` / `YOUTUBE_VISITOR_DATA` — they are
deprecated (tokens are bound to video ID, not a static env pair).

### (2) Manual fallback (no plugin zip)
If the plugin directory is missing, `pot-client.js` mints a fresh PO token per
video via `POST /get_pot` with `content_binding=<videoId>`.

### (3) External binding
`app.listen(PORT, '0.0.0.0', …)` — driven by `HOST=0.0.0.0` env var set in
`install-services.ps1`. Verify with `check-health.ps1`; the "Listening
sockets" table must show `0.0.0.0:3001`, not `127.0.0.1:3001`.

The other very common cause of `Failed to fetch` from outside is the
**Windows Firewall**, not your code. The install script adds an inbound
rule for TCP 3001; the diagnostic script confirms it's enabled.

### (4) Stable client identity
Default chain is `web_embedded → tv → web_safari`. `web_embedded` is the
most permissive for embedded playback and rarely triggers challenges; `tv`
is the long-lived TV client that historically resists rate-limiting; `web_safari`
is a last-resort fallback. Override via the `YT_CLIENT_CHAIN` env var.

## Deploy

On the VPS, as Administrator:

```powershell
# 1. Copy files into your existing bridge directory, e.g. C:\SafeTube\bridge
#    so it looks like:
#       C:\SafeTube\bridge\server\index.js
#       C:\SafeTube\bridge\server\pot-client.js
#       C:\SafeTube\bridge\package.json
#       C:\SafeTube\bridge\scripts\install-services.ps1

cd C:\SafeTube\bridge
npm install --omit=dev

# 2. Edit the path defaults at the top of install-services.ps1 if your
#    layout differs (NSSM, bgutil-pot.exe, yt-dlp.exe locations).

# 3. Re-install both services.
powershell -ExecutionPolicy Bypass -File .\scripts\install-services.ps1

# 4. Triage anytime.
powershell -ExecutionPolicy Bypass -File .\scripts\check-health.ps1
```

## Verifying from outside (do this from your phone)

1. `http://176.9.82.81:3001/health` — should return JSON with
   `bridge.host: "0.0.0.0"` and `pot.reachable: true`.
2. `http://176.9.82.81:3001/api/info/dQw4w9WgXcQ` — should return video
   metadata (title, formats, etc.) without a "not a bot" error.

If (1) fails but loopback works on the VPS → firewall or Hetzner cloud
firewall (check the panel; some VPS plans add an extra layer above Windows
Firewall).

If (2) returns `resolve_failed` with "not a bot" → POT is reaching yt-dlp
but the token isn't validating. Hit `POST /admin/refresh-pot` once, then
retry. If it persists across several refreshes, add cookies (see below).

## When POT alone isn't enough

If you start seeing 429s or repeated challenges even with fresh tokens, the
VPS IP is probably flagged (Hetzner ranges show up on many bot lists).
Options, in order of cost:

1. **Add cookies** from a dedicated Google account exported in a private
   Firefox window (the method from our earlier conversation). Set
   `COOKIES_FILE=C:\SafeTube\cookies.txt` in the bridge service env.
2. **Residential proxy** via `PROXY_URL=http://user:pass@host:port`.

Both are already wired into `buildYtDlpArgs` — just set the env vars.

## Endpoints

| Method | Path                     | Purpose                                  |
|--------|--------------------------|------------------------------------------|
| GET    | `/health`                | Liveness + POT reachability              |
| GET    | `/api/stream/:videoId`   | Direct media URL (for `<video>` src)     |
| GET    | `/api/info/:videoId`     | Full metadata + format list              |
| POST   | `/admin/refresh-pot`     | Force visitor_data + po_token re-mint    |
