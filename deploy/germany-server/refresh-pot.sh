#!/usr/bin/env bash
# /usr/local/bin/refresh-yt-pot.sh
#
# Generates a fresh { poToken, visitorData } pair via youtube-po-token-generator,
# atomically swaps the two relevant lines in /etc/safetube-bridge.env, and
# restarts safetube-bridge so the new tokens take effect.
#
# Lives at /usr/local/bin/refresh-yt-pot.sh on the server; the canonical copy
# is here in the repo so it stays in sync. Triggered by safetube-pot-refresh.timer.

set -euo pipefail

# ┌──────────────────── FILL THIS IN ──────────────────────────────────────────┐
# Absolute path to the kids-youtube-app clone (no trailing slash).
# e.g. /home/elad/kids-youtube-app
APP_DIR="APP_DIR"
# └────────────────────────────────────────────────────────────────────────────┘

ENV_FILE=/etc/safetube-bridge.env
GENERATOR_DIR="${APP_DIR}/deploy/germany-server"
BRIDGE_UNIT=safetube-bridge.service

log() { printf '[refresh-pot] %s\n' "$*"; }
die() { printf '[refresh-pot] ERROR: %s\n' "$*" >&2; exit 1; }

[ "$APP_DIR" != "APP_DIR" ] || die "APP_DIR placeholder not filled in (edit /usr/local/bin/refresh-yt-pot.sh)"
[ -f "$ENV_FILE" ]          || die "$ENV_FILE not found — install safetube-bridge.env first"
[ -d "$GENERATOR_DIR" ]     || die "$GENERATOR_DIR not found — run \`git pull\` in $APP_DIR first"

cd "$GENERATOR_DIR"

# Install the generator on first run; reinstall if package.json changed in the repo.
if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  log "installing youtube-po-token-generator..."
  npm install --silent --no-audit --no-fund --no-progress
fi

# CLI prints JSON to stdout: {"visitorData":"...","poToken":"..."}
JSON=$(node_modules/.bin/youtube-po-token-generator) || die "generator failed (network? rate-limit?)"

# Parse with node so we don't take a hard dep on jq.
PO=$(printf '%s' "$JSON" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(JSON.parse(d).poToken||""))')
VD=$(printf '%s' "$JSON" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(JSON.parse(d).visitorData||""))')

[ -n "$PO" ] || die "generator returned empty poToken"
[ -n "$VD" ] || die "generator returned empty visitorData"

log "generated pair (poToken len=${#PO}, visitorData len=${#VD})"

# Atomic env-file rewrite: build new contents in a tmp file, then rename into place.
TMP=$(mktemp --tmpdir safetube-bridge.env.XXXXXX)
chmod 600 "$TMP"
{
  grep -vE '^(YOUTUBE_PO_TOKEN|YOUTUBE_VISITOR_DATA)=' "$ENV_FILE" || true
  printf 'YOUTUBE_PO_TOKEN=web.gvs+%s\n'     "$PO"
  printf 'YOUTUBE_VISITOR_DATA=%s\n'         "$VD"
} > "$TMP"
mv "$TMP" "$ENV_FILE"
chmod 600 "$ENV_FILE"
chown root:root "$ENV_FILE"

systemctl restart "$BRIDGE_UNIT"
log "rotated tokens and restarted $BRIDGE_UNIT"
