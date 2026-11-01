#!/usr/bin/env bash
# infra/deploy/deploy.sh - install staged deploy files into /opt/brewai/app and (re)start the gateway (ADR-0014). Root on the server.
#   GitHub Actions (deploy-gateway.yml) rsyncs infra/deploy + infra/litellm/config.yaml to ~/brewai-staging, then:
#   sudo bash ~/brewai-staging/infra/deploy/deploy.sh
# Reads secrets only from /opt/brewai/.env (bootstrap.sh). Prints no secret. Safe to re-run.
# Test overrides: BREWAI_HOME (default /opt/brewai) . BREWAI_PROJECT . BREWAI_SKIP_SYSTEMD=1
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BREWAI_HOME="${BREWAI_HOME:-/opt/brewai}"
PROJECT="${BREWAI_PROJECT:-brewai-gateway}"
ENV_FILE="$BREWAI_HOME/.env"
APP="$BREWAI_HOME/app"
REQUIRED="DOMAIN LITELLM_MASTER_KEY LITELLM_SALT_KEY LITELLM_DB_PASSWORD ADMIN_GATE_TOKEN ADMIN_UI_USER ADMIN_UI_PASSWORD_HASH"

say() { printf '[deploy] %s\n' "$*"; }
die() { printf '[deploy] %s\n' "$*" >&2; exit 1; }

if [ "$BREWAI_HOME" = /opt/brewai ] && [ "$(id -u)" -ne 0 ]; then die "sudo 로 실행하세요"; fi
[ -f "$ENV_FILE" ] || die "$ENV_FILE 이 없어요 → 먼저 bootstrap.sh (README '게이트웨이 서버')"
for k in $REQUIRED; do
  grep -Eq "^$k=.+" "$ENV_FILE" || die "$ENV_FILE 에 $k 가 없어요 → bootstrap.sh 를 다시 실행하세요 (있는 값은 안 바뀌어요)"
done
if grep -qi '^LITELLM_LICENSE=' "$ENV_FILE"; then die ".env 에 LITELLM_LICENSE 가 있어요 → 지우세요 (GHSA-w4c7)"; fi
[ -f "$SRC/infra/deploy/compose.yaml" ] && [ -f "$SRC/infra/deploy/Caddyfile" ] && [ -f "$SRC/infra/litellm/config.yaml" ] \
  || die "올릴 파일이 없어요 ($SRC/infra/deploy, $SRC/infra/litellm/config.yaml)"

# Bind-mounted single files keep the old inode after a swap -> recreate the service whose file changed.
# The list is kept in a file until the recreate succeeded, so a run that fails after the swap is finished by the next one.
sum() { if [ -f "$1" ]; then cksum < "$1"; else echo none; fi; }
mkdir -p "$APP"
PENDING="$APP/.pending-recreate"
changed() { # changed INSTALLED NEW SERVICE: the running SERVICE still sees INSTALLED
  local old; old="$(sum "$1")"
  if [ "$old" != none ] && [ "$old" != "$(sum "$2")" ]; then echo "$3" >> "$PENDING"; fi
}
changed "$APP/infra/deploy/Caddyfile" "$SRC/infra/deploy/Caddyfile" caddy
changed "$APP/infra/litellm/config.yaml" "$SRC/infra/litellm/config.yaml" litellm

say "파일 설치 → $APP/infra"
stage="$APP/.next"
rm -rf "$stage" "$APP/.prev"
mkdir -p "$stage/infra/litellm"
cp -R "$SRC/infra/deploy" "$stage/infra/deploy"
cp "$SRC/infra/litellm/config.yaml" "$stage/infra/litellm/config.yaml"
# a+r: the LiteLLM container runs as a non-root user and must read config.yaml (staged copies arrive as 0600)
chmod -R u=rwX,go=rX "$stage"
if [ "$(id -u)" -eq 0 ]; then chown -R root:root "$stage"; fi
if [ -d "$APP/infra" ]; then mv "$APP/infra" "$APP/.prev"; fi
mv "$stage/infra" "$APP/infra"
rm -rf "$stage" "$APP/.prev"

compose() { docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f "$APP/infra/deploy/compose.yaml" "$@"; }
compose config -q
say "이미지 받기 (고정 digest)"
compose pull -q
say "올리는 중 (모두 healthy 까지 최대 300초)"
compose up -d --wait --wait-timeout 300 --remove-orphans

recreate="$(if [ -f "$PENDING" ]; then sort -u "$PENDING" | tr '\n' ' '; fi)"
if [ -n "$recreate" ]; then
  say "바뀐 설정 다시 읽기: $recreate"
  # shellcheck disable=SC2086
  compose up -d --wait --wait-timeout 300 --no-deps --force-recreate $recreate
fi
rm -f "$PENDING"
docker image prune -f >/dev/null

if [ -z "${BREWAI_SKIP_SYSTEMD:-}" ] && command -v systemctl >/dev/null 2>&1; then
  install -m 0644 "$APP/infra/deploy/systemd/brewai-backup.service" "$APP/infra/deploy/systemd/brewai-backup.timer" /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable --now brewai-backup.timer >/dev/null 2>&1
  say "DB 백업 = 매일 03:30 KST (brewai-backup.timer, 7개 보관)"
fi

compose ps --format 'table {{.Service}}\t{{.Status}}'
say "끝"
echo "BREWAI_DOMAIN=$(sed -n 's/^DOMAIN=//p' "$ENV_FILE")"
