#!/usr/bin/env bash
# infra/deploy/backup.sh - daily pg_dump of the gateway DB (models and keys added in /ui). Keeps the newest 7.
# Runs on the server as root from brewai-backup.timer (deploy.sh installs it). By hand: sudo bash /opt/brewai/app/infra/deploy/backup.sh
# A dump is only useful together with the SAME LITELLM_SALT_KEY (provider keys inside are encrypted with it).
# Copy one off the box (Mac / Git Bash):  ssh ubuntu@<IP> 'sudo cat /opt/brewai/backups/latest.dump' > brewai-litellm.dump
# New server / restore = README '게이트웨이 서버' > '복원' (bootstrap -> old SALT into .env BEFORE the first deploy -> deploy
#   -> stop litellm -> pg_restore --clean --if-exists --no-owner from the Mac over ssh -> start litellm).
set -euo pipefail

BREWAI_HOME="${BREWAI_HOME:-/opt/brewai}"
PROJECT="${BREWAI_PROJECT:-brewai-gateway}"
ENV_FILE="${BREWAI_ENV_FILE:-$BREWAI_HOME/.env}"
COMPOSE_FILE="${BREWAI_COMPOSE_FILE:-$BREWAI_HOME/app/infra/deploy/compose.yaml}"
DIR="${BREWAI_BACKUP_DIR:-$BREWAI_HOME/backups}"
KEEP="${BREWAI_BACKUP_KEEP:-7}"

umask 077
mkdir -p "$DIR"
chmod 700 "$DIR"

ts="$(date -u +%Y%m%dT%H%M%SZ)"
out="$DIR/litellm-$ts.dump"
tmp="$DIR/.litellm-$ts.dump.part"
trap 'rm -f "$tmp"' EXIT

docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
  exec -T litellm-db pg_dump -U litellm -d litellm -Fc > "$tmp"
# pg_dump custom format starts with PGDMP; an empty or broken file must not replace a good backup.
if [ "$(head -c 5 "$tmp")" != "PGDMP" ]; then
  echo "[backup] dump looks broken, kept the old ones" >&2
  exit 1
fi
mv "$tmp" "$out"
ln -sfn "$(basename "$out")" "$DIR/latest.dump"

# Names sort by time (UTC stamp) -> delete all but the newest $KEEP.
count="$(find "$DIR" -maxdepth 1 -type f -name 'litellm-*.dump' | wc -l | tr -d ' ')"
if [ "$count" -gt "$KEEP" ]; then
  find "$DIR" -maxdepth 1 -type f -name 'litellm-*.dump' | sort | head -n "$((count - KEEP))" |
    while IFS= read -r old; do rm -f -- "$old"; done
fi
echo "[backup] $(basename "$out") ($(du -h "$out" | cut -f1)), keeping $KEEP"
