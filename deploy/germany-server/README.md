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

## One-time install (turn-key)

`install.sh` auto-detects:

- `APP_DIR`  — canonical path to your `kids-youtube-app` clone
- `RUN_USER` — owner of that directory (so the bridge runs as your SSH user, not root)
- `NODE_BIN` — the `node` binary visible to `RUN_USER` (handles nvm / non-standard paths)

```bash
# 0. Pull the latest code on the Germany server
cd ~/kids-youtube-app                  # or wherever you cloned it
git pull

# 1. Strip Windows CRLF line endings (only matters if your git on Linux has
#    core.autocrlf=true — harmless otherwise)
sed -i 's/\r$//' \
  deploy/germany-server/install.sh \
  deploy/germany-server/refresh-pot.sh \
  deploy/germany-server/*.service \
  deploy/germany-server/*.timer

# 2. Run the installer (does npm install, systemd unit substitution,
#    /etc/safetube-bridge.env template copy, and daemon-reload)
sudo bash deploy/germany-server/install.sh
```

When `install.sh` finishes it prints the next-step commands; the canonical
sequence is reproduced below.

## Fill in the env file

```bash
sudo nano /etc/safetube-bridge.env
```

Set every line that says `FIXME`:

- `PUBLIC_BASE_URL`             — your Cloudflare Tunnel URL, no trailing slash
- `SUPABASE_URL`                — `https://YOUR_PROJECT_REF.supabase.co`
- `SUPABASE_ANON_KEY`           — Supabase anon key
- `MEDIA_BRIDGE_GRANT_SECRET`   — `openssl rand -hex 32`
- `MEDIA_BRIDGE_CORS_ORIGINS`   — production frontend origin(s), comma-separated

Leave `YOUTUBE_PO_TOKEN=` and `YOUTUBE_VISITOR_DATA=` **empty** — the rotation
timer populates them on first run.

## Go live

```bash
sudo systemctl enable --now safetube-bridge          # bridge starts, runs without tokens
sudo systemctl start  safetube-pot-refresh           # fire the first rotation NOW
sudo systemctl enable --now safetube-pot-refresh.timer   # 4-hour rotation cycle
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

## bgutil POT for Render (port 26148, public)

Render’s bridge calls `POT_URL=http://<germany-ip>:26148` (no shared secret — plain HTTP).

On the Germany VPS, after `git pull`:

```bash
sudo bash deploy/germany-server/configure-bgutil-pot-external.sh
```

This script:

- Installs `bgutil-pot.service` with `--host 0.0.0.0 --port 26148`
- Runs `ufw allow 26148/tcp` when `ufw` is present
- Stops a conflicting PM2 or localhost-only `4416` instance
- Restarts `bgutil-pot.service`

Verify:

```bash
curl -fsS http://127.0.0.1:26148/ping
curl -fsS http://176.9.82.81:26148/ping   # from another machine
sudo systemctl status bgutil-pot --no-pager
```

On Render set: `POT_URL=http://176.9.82.81:26148` (not `POT_SERVER_URL`).

## Troubleshooting

**Render health: `pot.reachable: false`, `Connection was reset`**

1. Run `configure-bgutil-pot-external.sh` (see above).
2. Confirm listen: `ss -tlnp | grep 26148` shows `0.0.0.0:26148`.
3. Hetzner/cloud firewall: allow inbound TCP 26148.
4. `curl http://176.9.82.81:26148/ping` from outside the VPS.

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
3. Regenerate the PO token + visitor_data pair (same session) and restart the bridge — mismatched or stale pairs are a common rejection pattern.

**Bridge keeps the SAME tokens after a refresh that "succeeded"**
The `npm install` in the generator dir failed silently. Run it manually:
`cd <APP_DIR>/deploy/germany-server && npm install` and re-trigger.
