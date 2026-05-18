#!/usr/bin/env bash
# Configure bgutil-pot on the Germany server for Render:
#   - listen on 0.0.0.0:26148
#   - ufw allow 26148/tcp
#   - systemd unit (replaces PM2 / localhost-only instances)
#
# Run on the Germany VPS as root:
#   cd ~/kids-youtube-app
#   git pull
#   sudo bash deploy/germany-server/configure-bgutil-pot-external.sh

set -euo pipefail

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  echo "configure-bgutil-pot-external.sh: run as root (sudo)" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BGUTIL_BIN="${BGUTIL_BIN:-/usr/local/bin/bgutil-pot}"
POT_PORT="${POT_PORT:-26148}"
POT_HOST="${POT_HOST:-0.0.0.0}"

if [ ! -x "$BGUTIL_BIN" ]; then
  echo "configure-bgutil-pot-external.sh: bgutil-pot not found at $BGUTIL_BIN" >&2
  echo "  Install from https://github.com/jim60105/bgutil-ytdlp-pot-provider-rs/releases" >&2
  echo "  Example: sudo install -m 755 ./bgutil-pot /usr/local/bin/bgutil-pot" >&2
  exit 1
fi

echo "[pot] Stopping PM2 bgutil-pot (if any) ..."
if command -v pm2 >/dev/null 2>&1; then
  pm2 delete bgutil-pot 2>/dev/null || true
  pm2 delete bgutil 2>/dev/null || true
  pm2 save 2>/dev/null || true
fi

echo "[pot] Stopping legacy systemd units on 127.0.0.1:4416 ..."
systemctl stop bgutil-pot.service 2>/dev/null || true

echo "[pot] Installing systemd unit (listen ${POT_HOST}:${POT_PORT}) ..."
cp "$SCRIPT_DIR/bgutil-pot.service" /etc/systemd/system/bgutil-pot.service
# Allow override binary path in unit if not /usr/local/bin/bgutil-pot
if [ "$BGUTIL_BIN" != "/usr/local/bin/bgutil-pot" ]; then
  sed -i "s|/usr/local/bin/bgutil-pot|$BGUTIL_BIN|g" /etc/systemd/system/bgutil-pot.service
fi
systemctl daemon-reload
systemctl enable bgutil-pot.service

echo "[pot] Opening firewall tcp/${POT_PORT} (ufw) ..."
if command -v ufw >/dev/null 2>&1; then
  ufw allow "${POT_PORT}/tcp" comment 'SafeTube bgutil POT for Render' || true
  ufw status numbered | grep -E "${POT_PORT}|Status" || ufw status || true
else
  echo "  ufw not installed — open port ${POT_PORT}/tcp in Hetzner/cloud firewall manually."
fi

echo "[pot] Starting bgutil-pot.service ..."
systemctl restart bgutil-pot.service
sleep 2

if ! systemctl is-active --quiet bgutil-pot.service; then
  echo "configure-bgutil-pot-external.sh: bgutil-pot.service failed to start" >&2
  journalctl -u bgutil-pot.service -n 30 --no-pager >&2 || true
  exit 1
fi

echo "[pot] Local health check ..."
curl -fsS "http://127.0.0.1:${POT_PORT}/ping" && echo " OK (127.0.0.1:${POT_PORT}/ping)"

if command -v ss >/dev/null 2>&1; then
  echo "[pot] Listening sockets:"
  ss -tlnp | grep ":${POT_PORT} " || ss -tlnp | grep bgutil || true
fi

PUBLIC_IP="$(curl -fsS -m 5 https://api.ipify.org 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')"
if [ -n "$PUBLIC_IP" ]; then
  echo "[pot] Render should use: POT_URL=http://${PUBLIC_IP}:${POT_PORT}"
fi

echo "[pot] Done. Verify from Render health: pot.reachable should be true."
