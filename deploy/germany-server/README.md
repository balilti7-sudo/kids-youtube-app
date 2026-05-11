# SafeTube Media Bridge — Germany server deployment

systemd-managed Media Bridge with auto-rotating YouTube PO tokens, for the
self-hosted bridge at `176.9.82.81` (tunneled to HTTPS via Cloudflare).

## What's in this folder

| File                              | Goes to                                              |
| --------------------------------- | ---------------------------------------------------- |
| `safetube-bridge.service`         | `/etc/systemd/system/safetube-bridge.service`        |
| `safetube-pot-refresh.service`    | `/etc/systemd/system/safetube-pot-refresh.service`   |
| `safetube-pot-refresh.timer`      | `/etc/systemd/system/safetube-pot-refresh.timer`     |
| `safetube-bridge.env.example`     | `/etc/safetube-bridge.env` (after filling in)        |
| `refresh-pot.sh`                  | `/usr/local/bin/refresh-yt-pot.sh`                   |
| `package.json`                    | stays here — `npm install` is run in place           |

## Prerequisites

```bash
node --version        # >= 18
npm --version
which node            # should be /usr/bin/node; if not, edit ExecStart below
systemctl --version
```

Install Node 20 from NodeSource if `node --version` < 18:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

## One-time install

Substitute three placeholders throughout the steps below:

- `<APP_DIR>` — absolute path to the kids-youtube-app clone (e.g. `/home/elad/kids-youtube-app`)
- `<RUN_USER>` — the Linux user that owns `<APP_DIR>` and will run node
- `<COOKIES_PATH>` — absolute path to the Netscape `cookies.txt` exported from your signed-in browser

```bash
# 0. Pull the latest code (if you haven't already)
cd <APP_DIR>
git pull

# 1. Strip Windows line endings from the files in this folder (only needed if
#    git checked them out with CRLF — happens when core.autocrlf=true on Linux).
cd <APP_DIR>/deploy/germany-server
sed -i 's/\r$//' refresh-pot.sh safetube-bridge.service \
  safetube-pot-refresh.service safetube-pot-refresh.timer safetube-bridge.env.example

# 2. Install the bridge dependencies once
cd <APP_DIR>/server
npm install --omit=dev

# 3. Install the PO-token generator dependency (used by the refresh script)
cd <APP_DIR>/deploy/germany-server
npm install
```

## Install the systemd units

```bash
cd <APP_DIR>/deploy/germany-server

# 4. Bridge service — fill in <RUN_USER> and <APP_DIR>, then copy.
sudo sed -e 's|RUN_USER|<RUN_USER>|g' -e 's|APP_DIR|<APP_DIR>|g' \
  safetube-bridge.service > /tmp/safetube-bridge.service
sudo mv /tmp/safetube-bridge.service /etc/systemd/system/safetube-bridge.service

# 5. Refresh service + timer — no placeholders, copy as-is.
sudo cp safetube-pot-refresh.service /etc/systemd/system/
sudo cp safetube-pot-refresh.timer   /etc/systemd/system/

# 6. Refresh script — fill in <APP_DIR>, install to /usr/local/bin.
sudo sed -e 's|APP_DIR|<APP_DIR>|g' refresh-pot.sh > /tmp/refresh-yt-pot.sh
sudo mv /tmp/refresh-yt-pot.sh /usr/local/bin/refresh-yt-pot.sh
sudo chmod +x /usr/local/bin/refresh-yt-pot.sh

# 7. Env file — copy the template, then edit and fill in FIXME values.
sudo cp safetube-bridge.env.example /etc/safetube-bridge.env
sudo chmod 600 /etc/safetube-bridge.env
sudo chown root:root /etc/safetube-bridge.env
sudo nano /etc/safetube-bridge.env
#   PUBLIC_BASE_URL=<your Cloudflare Tunnel URL>
#   YOUTUBE_COOKIES_FILE=<COOKIES_PATH>
#   SUPABASE_URL=<your supabase URL>
#   SUPABASE_ANON_KEY=<your anon key>
#   MEDIA_BRIDGE_GRANT_SECRET=<openssl rand -hex 32>
#   Leave YOUTUBE_PO_TOKEN= and YOUTUBE_VISITOR_DATA= empty — the timer fills them.
```

## First boot

```bash
# 8. Reload systemd's view of unit files
sudo systemctl daemon-reload

# 9. Start the bridge (will run WITHOUT tokens initially — that's fine for 30 seconds)
sudo systemctl enable --now safetube-bridge

# 10. Generate the first token pair NOW (don't wait 5 min for the boot timer)
sudo systemctl start safetube-pot-refresh
sudo journalctl -u safetube-pot-refresh -n 20 --no-pager
#   Expect: "[refresh-pot] rotated tokens and restarted safetube-bridge.service"

# 11. Enable the rotation timer (every 4h)
sudo systemctl enable --now safetube-pot-refresh.timer
```

## Verify

```bash
# Both units active?
sudo systemctl status safetube-bridge safetube-pot-refresh.timer --no-pager

# Bridge sees the new env vars?
sudo journalctl -u safetube-bridge -n 50 --no-pager | grep -E 'po_token|visitor_data|listening on'
#   Expect:
#     [media-bridge] yt-dlp extractor-args will include: po_token, visitor_data
#     [media-bridge] listening on http://0.0.0.0:3001 ...

# When is the next rotation?
systemctl list-timers safetube-pot-refresh.timer
```

Hit `/health` through the Cloudflare Tunnel to confirm reachability:

```bash
curl -fsS https://<your-tunnel-host>.trycloudflare.com/health
```

## Common operations

```bash
# Force an immediate token rotation
sudo systemctl start safetube-pot-refresh

# Tail bridge logs in real time
sudo journalctl -u safetube-bridge -f

# Tail rotation logs
sudo journalctl -u safetube-pot-refresh -f

# Restart the bridge after editing the env file
sudo systemctl restart safetube-bridge

# Disable the auto-rotation (e.g. while debugging)
sudo systemctl disable --now safetube-pot-refresh.timer

# Pull new code and restart
cd <APP_DIR> && git pull
cd <APP_DIR>/server && npm install --omit=dev
sudo systemctl restart safetube-bridge
```

## Troubleshooting

**`safetube-bridge` won't start — `node: command not found`**
`which node` returns something other than `/usr/bin/node`. Edit
`/etc/systemd/system/safetube-bridge.service` and replace the `ExecStart=` path,
then `sudo systemctl daemon-reload && sudo systemctl restart safetube-bridge`.

**`safetube-pot-refresh` exits with `generator failed (network? rate-limit?)`**
YouTube rate-limited the BotGuard fetch from your IP. The timer will retry in 4h
automatically. To retry now: wait ~60 seconds, then
`sudo systemctl start safetube-pot-refresh`.

**Bridge logs show `[media-bridge] yt-dlp extractor-args will include: po_token` only (no visitor_data)**
Means `YOUTUBE_VISITOR_DATA` is empty or unset. Check
`sudo grep YOUTUBE /etc/safetube-bridge.env` and re-run the refresh.

**Frontend still hits CAPTCHA after a successful rotation**
Three things to try, in order:

1. Try `web` scope instead of `web.gvs` — edit `refresh-pot.sh` and change
   `web.gvs+%s` to `web+%s`, then rerun.
2. Try multi-client: also change the `printf` line to
   `printf 'YOUTUBE_PO_TOKEN=web.gvs+%s,web.player+%s,mweb.gvs+%s\n' "$PO" "$PO" "$PO"`.
3. Re-export `cookies.txt` from the same browser profile + Google account, in
   the same calendar day — stale cookies + fresh PO token is a common rejection
   pattern.

**Bridge keeps the SAME tokens after a refresh that "succeeded"**
The `npm install` in the generator dir failed silently. Run it manually:
`cd <APP_DIR>/deploy/germany-server && npm install` and re-trigger.
