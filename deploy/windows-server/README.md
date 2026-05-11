# SafeTube Media Bridge — Windows Server deployment

Windows-native deployment of the Media Bridge using **nssm** (for the service)
and **Task Scheduler** (for the 4-hour PO-token rotation). Run from an elevated
PowerShell on the Windows Server in Germany (`176.9.82.81`).

## What's in this folder

| File                              | Role                                                                  |
| --------------------------------- | --------------------------------------------------------------------- |
| `install.ps1`                     | One-shot installer — does everything described in "One-time install"  |
| `uninstall.ps1`                   | Removes service + task + scripts (env file kept unless `-Purge`)      |
| `start-bridge.ps1`                | Service entry point: loads env file → runs `node index.js`            |
| `refresh-pot.ps1`                 | Triggered every 4h: generates fresh PO token + visitor_data           |
| `safetube-bridge.env.example`     | Env file template (copied to `C:\ProgramData\SafeTube\bridge.env`)    |
| `package.json`                    | Pins `youtube-po-token-generator` for reproducible installs           |

## Installed layout (after running install.ps1)

| Path                                                           | What                                  |
| -------------------------------------------------------------- | ------------------------------------- |
| `C:\Program Files\SafeTube\start-bridge.ps1`                   | Service entry point                   |
| `C:\Program Files\SafeTube\refresh-pot.ps1`                    | Token refresh script                  |
| `C:\Program Files\SafeTube\generator\node_modules\…`           | PO-token generator + deps             |
| `C:\ProgramData\SafeTube\bridge.env`                           | Secrets + config (ACL: SYSTEM + Admins) |
| `C:\ProgramData\SafeTube\logs\bridge.log`                      | nssm stdout/stderr capture (rotated)  |
| `SafeTubeBridge` (Windows service)                             | Runs as LocalSystem, AutoStart         |
| `SafeTube-PO-Token-Refresh` (Scheduled Task)                   | Runs as SYSTEM, every 4h               |

## Prerequisites

- **Windows Server 2016+** (PowerShell 5.1+, comes built-in)
- **Node.js 18+** — install from https://nodejs.org (msi) or `winget install OpenJS.NodeJS.LTS`
- **nssm** — `winget install NSSM.NSSM`. If `winget` isn't on this box, download
  the zip from https://nssm.cc/download, extract `nssm.exe` to a folder on PATH
  (e.g. `C:\Windows\System32`). `install.ps1` will try winget automatically and
  fail with a clear message if neither works.

Verify before running the installer:

```powershell
node --version       # >= v18
nssm --version       # 2.24+ (any version after that works)
```

## One-time install

Open **PowerShell as Administrator**, then:

```powershell
# 1. cd to your repo clone (whichever path it lives at on this box)
cd C:\path\to\kids-youtube-app

# 2. Pull the latest deploy/ folder
git pull

# 3. Run the installer (auto-detects everything)
powershell -ExecutionPolicy Bypass -File .\deploy\windows-server\install.ps1
```

The installer:

1. Verifies Node.js + nssm are present (auto-installs nssm via winget if missing).
2. Runs `npm install --omit=dev` in `server\` (bridge deps).
3. Runs `npm install` in this folder, then copies the generator package to
   `C:\Program Files\SafeTube\generator\`.
4. Copies `start-bridge.ps1` and `refresh-pot.ps1` to `C:\Program Files\SafeTube\`.
5. Creates `C:\ProgramData\SafeTube\bridge.env` from the template (skipped if
   it already exists, so re-running install.ps1 is safe).
6. Registers the `SafeTubeBridge` Windows service via nssm — start mode
   Automatic, restart on failure with 5s delay, stdout/stderr rotated to
   `C:\ProgramData\SafeTube\logs\bridge.log` (10 MB rotation).
7. Registers the `SafeTube-PO-Token-Refresh` scheduled task — first run in
   5 minutes, then every 4 hours, runs as `SYSTEM` with highest privileges.

It does **not** start anything — the env file needs FIXME values filled in first.

## Fill in the env file

```powershell
notepad C:\ProgramData\SafeTube\bridge.env
```

Set every line that says `FIXME`:

| Variable                       | What to put                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| `PUBLIC_BASE_URL`              | Your Cloudflare Tunnel URL, no trailing slash (e.g. `https://xyz.trycloudflare.com`)       |
| `YOUTUBE_COOKIES_FILE`         | Absolute path to `youtube.com_cookies.txt` — backslashes need doubling: `C:\\path\\to\\file.txt` |
| `SUPABASE_URL`                 | `https://ioylyyqlluenkkltguhf.supabase.co` (from your dev `.env`)                          |
| `SUPABASE_ANON_KEY`            | The anon key from your dev `.env`                                                          |
| `MEDIA_BRIDGE_GRANT_SECRET`    | Random hex string — see below                                                              |
| `MEDIA_BRIDGE_CORS_ORIGINS`    | Your Vercel domain(s), comma-separated                                                     |

Generate a grant secret in PowerShell:

```powershell
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })
```

**Leave `YOUTUBE_PO_TOKEN=` and `YOUTUBE_VISITOR_DATA=` empty** — the scheduled
task fills them on first run.

## Go live

In the same admin PowerShell:

```powershell
# 1. Start the bridge (will initially run without PO tokens — that's fine for ~5 min)
Start-Service SafeTubeBridge

# 2. Fire the first PO-token rotation NOW (don't wait 5 min for the scheduled task)
Start-ScheduledTask -TaskName 'SafeTube-PO-Token-Refresh'

# 3. Tail the bridge log to confirm both env vars loaded after the auto-restart
Get-Content C:\ProgramData\SafeTube\logs\bridge.log -Tail 50 -Wait
```

Within ~10 seconds you should see:

```
[start-bridge] loaded N env vars
[media-bridge] listening on http://0.0.0.0:3001 ...
[media-bridge] yt-dlp extractor-args will include: po_token, visitor_data
[auth] cookies ready (...)
```

Stop tailing with Ctrl+C and verify the scheduled task succeeded:

```powershell
Get-ScheduledTaskInfo -TaskName 'SafeTube-PO-Token-Refresh' |
    Select-Object LastRunTime, LastTaskResult, NextRunTime
# LastTaskResult should be 0 (success). Anything else, look at the task's history.
```

## Important — kill any old `node index.js` running outside the service

If you've been launching `node index.js` manually via SSH/RDP, that ghost
process is still bound to port 3001 and will block the service from starting.
Kill it before going live:

```powershell
Get-Process node -ErrorAction SilentlyContinue |
    Where-Object { ($_.Path -like '*\nodejs\*') -and ($_.MainWindowTitle -or $_.CommandLine -like '*index.js*') } |
    Stop-Process -Force

# Or, brute force, kill ALL node.exe processes (safe only if the bridge is the
# only Node app on this box):
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
```

Then `Start-Service SafeTubeBridge`.

## Common operations

```powershell
# Force an immediate token rotation
Start-ScheduledTask -TaskName 'SafeTube-PO-Token-Refresh'

# Tail bridge logs in real time
Get-Content C:\ProgramData\SafeTube\logs\bridge.log -Tail 50 -Wait

# Restart the bridge after editing env
Restart-Service SafeTubeBridge

# When's the next rotation?
Get-ScheduledTaskInfo -TaskName 'SafeTube-PO-Token-Refresh' | Select-Object NextRunTime

# Disable the auto-rotation (e.g. while debugging)
Disable-ScheduledTask -TaskName 'SafeTube-PO-Token-Refresh'

# Pull new code and restart
cd C:\path\to\kids-youtube-app
git pull
cd server
npm install --omit=dev
Restart-Service SafeTubeBridge
```

## Troubleshooting

**`Start-Service` immediately reports `service has started and stopped`**
The bridge crashed on startup. Check `C:\ProgramData\SafeTube\logs\bridge.log`
for the error. Most common cause: a `FIXME` value still in the env file.

**`Get-ScheduledTaskInfo` shows `LastTaskResult` ≠ 0**
The PO-token refresh failed. Run it manually with output visible to see why:

```powershell
& 'C:\Program Files\SafeTube\refresh-pot.ps1'
```

Common causes:
- YouTube rate-limited the BotGuard fetch — wait 60s and retry.
- `npm install` failed inside `C:\Program Files\SafeTube\generator\` — delete
  the `node_modules` folder there and rerun the script (it'll reinstall).

**Bridge logs show only `po_token` in the extractor-args line, no `visitor_data`**
`YOUTUBE_VISITOR_DATA` is empty or unset in the env file. Confirm with:

```powershell
Get-Content C:\ProgramData\SafeTube\bridge.env | Select-String 'YOUTUBE_'
```

Run the rotation task once and recheck.

**Frontend still hits CAPTCHA after a successful rotation**
Tweak the PO token scope. Edit
`C:\Program Files\SafeTube\refresh-pot.ps1` line near the top:

```powershell
[string]$PoTokenScope = 'web.gvs'
```

Try `web`, then `mweb.gvs`, then a comma-joined multi-client form. After
changing, re-trigger:

```powershell
Start-ScheduledTask -TaskName 'SafeTube-PO-Token-Refresh'
```

**Cloudflare Tunnel can't reach localhost:3001**
Confirm the bridge bound the right address — env should have
`MEDIA_BRIDGE_HOST=0.0.0.0`. Check it's listening:

```powershell
Test-NetConnection -ComputerName 127.0.0.1 -Port 3001
```

If `TcpTestSucceeded: False`, the bridge isn't running — `Get-Service SafeTubeBridge`
and the bridge log will say why.

## Removal

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\windows-server\uninstall.ps1
# To also delete the env file + logs:
powershell -ExecutionPolicy Bypass -File .\deploy\windows-server\uninstall.ps1 -Purge
```
