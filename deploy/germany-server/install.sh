#!/usr/bin/env bash
# deploy/germany-server/install.sh
#
# Turn-key installer for the SafeTube Media Bridge on a Linux server. Run as root.
#
#   cd <APP_DIR>/deploy/germany-server
#   sudo bash install.sh
#
# Auto-detects:
#   - APP_DIR   = canonical path to the repo root (this script lives two dirs deep)
#   - RUN_USER  = owner of the repo dir (so the bridge runs as your SSH user, not root)
#   - NODE_BIN  = `command -v node` as RUN_USER
#
# What it does:
#   1. npm install --omit=dev   in <APP_DIR>/server                  (bridge deps)
#   2. npm install              in <APP_DIR>/deploy/germany-server   (generator dep)
#   3. Substitutes APP_DIR / RUN_USER / NODE_BIN placeholders in the three unit
#      files and refresh-pot.sh, and installs them under /etc/systemd/system/
#      and /usr/local/bin/.
#   4. Installs /etc/safetube-bridge.env from the template (only if missing).
#   5. systemctl daemon-reload.
#
# Does NOT start anything — that's a separate step after you edit the env file.

set -euo pipefail

# ---- preflight --------------------------------------------------------------
if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  echo "install.sh: must be run as root (use sudo)" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [ ! -f "$APP_DIR/server/index.js" ]; then
  echo "install.sh: did not find $APP_DIR/server/index.js — is this the right repo?" >&2
  exit 1
fi

# The user that should own + run the bridge. Falls back to root only if the repo is root-owned.
RUN_USER="$(stat -c '%U' "$APP_DIR")"
if ! id "$RUN_USER" >/dev/null 2>&1; then
  echo "install.sh: detected RUN_USER=$RUN_USER but that user does not exist" >&2
  exit 1
fi

# Node binary visible to RUN_USER (handles nvm / non-standard paths).
NODE_BIN="$(sudo -u "$RUN_USER" bash -lc 'command -v node' 2>/dev/null || true)"
[ -n "$NODE_BIN" ] || NODE_BIN="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  echo "install.sh: node not found in PATH for $RUN_USER or root — install Node 18+ first" >&2
  exit 1
fi

NODE_VERSION="$("$NODE_BIN" --version 2>/dev/null || echo unknown)"

cat <<EOF
install.sh: detected configuration
  APP_DIR  = $APP_DIR
  RUN_USER = $RUN_USER
  NODE_BIN = $NODE_BIN  ($NODE_VERSION)

Proceeding in 3 seconds — Ctrl+C to abort.
EOF
sleep 3

# ---- 1. install npm deps as RUN_USER ----------------------------------------
echo
echo "install.sh: installing bridge dependencies in $APP_DIR/server ..."
sudo -u "$RUN_USER" bash -lc "cd '$APP_DIR/server' && npm install --omit=dev --no-audit --no-fund --no-progress"

echo
echo "install.sh: installing PO-token generator in $APP_DIR/deploy/germany-server ..."
sudo -u "$RUN_USER" bash -lc "cd '$APP_DIR/deploy/germany-server' && npm install --no-audit --no-fund --no-progress"

# ---- 2. substitute placeholders and install unit files ----------------------
SED_EXPR=(
  -e "s|RUN_USER|$RUN_USER|g"
  -e "s|APP_DIR|$APP_DIR|g"
  -e "s|/usr/bin/node index.js|$NODE_BIN index.js|g"
)

echo
echo "install.sh: installing systemd units ..."
sed "${SED_EXPR[@]}" "$SCRIPT_DIR/safetube-bridge.service"      > /etc/systemd/system/safetube-bridge.service
sed "${SED_EXPR[@]}" "$SCRIPT_DIR/safetube-pot-refresh.service" > /etc/systemd/system/safetube-pot-refresh.service
sed "${SED_EXPR[@]}" "$SCRIPT_DIR/safetube-pot-refresh.timer"   > /etc/systemd/system/safetube-pot-refresh.timer
chmod 644 /etc/systemd/system/safetube-bridge.service \
          /etc/systemd/system/safetube-pot-refresh.service \
          /etc/systemd/system/safetube-pot-refresh.timer

echo "install.sh: installing /usr/local/bin/refresh-yt-pot.sh ..."
sed "${SED_EXPR[@]}" "$SCRIPT_DIR/refresh-pot.sh" > /usr/local/bin/refresh-yt-pot.sh
chmod 755 /usr/local/bin/refresh-yt-pot.sh
chown root:root /usr/local/bin/refresh-yt-pot.sh

# ---- 3. env file (only if missing) ------------------------------------------
ENV_FILE=/etc/safetube-bridge.env
if [ ! -f "$ENV_FILE" ]; then
  echo "install.sh: creating $ENV_FILE from template ..."
  cp "$SCRIPT_DIR/safetube-bridge.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  chown root:root "$ENV_FILE"
  CREATED_ENV=1
else
  echo "install.sh: $ENV_FILE already exists — leaving it alone."
  CREATED_ENV=0
fi

# ---- 4. daemon-reload --------------------------------------------------------
systemctl daemon-reload

echo
echo "================================================================="
echo " install.sh: DONE."
echo "================================================================="
if [ "$CREATED_ENV" = "1" ]; then
  cat <<EOF

The env file was just created from the template. EDIT IT before starting the bridge:

  sudo nano $ENV_FILE

Fill in every line that says FIXME:
  - PUBLIC_BASE_URL          (your Cloudflare Tunnel URL, no trailing slash)
  - YOUTUBE_COOKIES_FILE     (absolute path to your Netscape cookies.txt)
  - SUPABASE_URL             (https://YOUR_PROJECT_REF.supabase.co)
  - SUPABASE_ANON_KEY        (Supabase anon key)
  - MEDIA_BRIDGE_GRANT_SECRET    (generate with: openssl rand -hex 32)
  - MEDIA_BRIDGE_CORS_ORIGINS    (your production frontend origin(s))

Leave YOUTUBE_PO_TOKEN= and YOUTUBE_VISITOR_DATA= empty — the timer fills them.

EOF
fi

cat <<EOF
Then go live with these four commands:

  sudo systemctl enable --now safetube-bridge
  sudo systemctl start  safetube-pot-refresh        # fire the first rotation NOW
  sudo systemctl enable --now safetube-pot-refresh.timer
  sudo journalctl -u safetube-bridge -n 50 --no-pager

You should see:
  [media-bridge] yt-dlp extractor-args will include: po_token, visitor_data
  [media-bridge] listening on http://0.0.0.0:3001 ...

Useful commands later:
  sudo systemctl restart safetube-bridge            # after editing env
  sudo systemctl start   safetube-pot-refresh       # force token rotation
  sudo journalctl -u safetube-bridge -f             # tail logs
  systemctl list-timers safetube-pot-refresh.timer  # when's the next rotation
EOF
