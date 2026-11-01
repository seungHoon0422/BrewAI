#!/usr/bin/env bash
# infra/deploy/bootstrap.sh - first-time setup of the BrewAI gateway server (ADR-0014).
# Target: Oracle Cloud Always Free, Ampere A1 (arm64), Ubuntu 24.04. Run as root, from a Mac or Git Bash in the repo:
#   ssh ubuntu@<IP> 'sudo bash -s' < infra/deploy/bootstrap.sh
#   ssh ubuntu@<IP> 'sudo bash -s -- my.domain.example' < infra/deploy/bootstrap.sh   # own domain instead of <ip>.sslip.io
# Re-running is safe: packages/rules are only added when missing, and existing secrets in /opt/brewai/.env are NEVER replaced.
# It does not start containers: the first deploy (GitHub Actions deploy-gateway.yml) copies compose files and runs deploy.sh.
set -euo pipefail

BREWAI_HOME=/opt/brewai
ENV_FILE="$BREWAI_HOME/.env"
DB_VOLUME=brewai-gateway_litellm_db_data
DOCKER_GPG_FPR=9DC858229FC7DD38854AE2D88D81803C0EBFCD88   # Docker Release (CE deb), docs.docker.com
SWAP_SIZE=2G
DOMAIN_ARG="${1:-}"
if [ -n "$DOMAIN_ARG" ] && ! [[ "$DOMAIN_ARG" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]]; then
  echo "[bootstrap] 도메인 모양이 아니에요: $DOMAIN_ARG" >&2
  exit 1
fi

say() { printf '[bootstrap] %s\n' "$*"; }
die() { printf '[bootstrap] %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "root 로 실행하세요: ssh ubuntu@<IP> 'sudo bash -s' < infra/deploy/bootstrap.sh"
# shellcheck disable=SC1091
. /etc/os-release
[ "${ID:-}" = ubuntu ] || die "Ubuntu 전용이에요 (지금: ${ID:-?})"
[ "${VERSION_ID:-}" = 24.04 ] || say "주의: Ubuntu 24.04 에서 시험했어요 (지금: ${VERSION_ID:-?})"

export DEBIAN_FRONTEND=noninteractive

# ---------- 1. packages ----------
say "패키지 (curl, rsync, htpasswd, iptables-persistent, unattended-upgrades)"
echo 'iptables-persistent iptables-persistent/autosave_v4 boolean false' | debconf-set-selections
echo 'iptables-persistent iptables-persistent/autosave_v6 boolean false' | debconf-set-selections
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg rsync openssl apache2-utils iptables-persistent unattended-upgrades
# Ubuntu security updates stay automatic (Ubuntu default; written only if missing). Docker apt + kernel reboot = by hand (README '서버 명령')
[ -f /etc/apt/apt.conf.d/20auto-upgrades ] || printf '%s\n' 'APT::Periodic::Update-Package-Lists "1";' 'APT::Periodic::Unattended-Upgrade "1";' \
  > /etc/apt/apt.conf.d/20auto-upgrades

# ---------- 2. Docker Engine (official apt repo, key fingerprint checked) ----------
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  say "Docker Engine 설치 (download.docker.com)"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc.new
  if ! gpg --show-keys --with-colons /etc/apt/keyrings/docker.asc.new | grep -q "^fpr:::::::::$DOCKER_GPG_FPR:"; then
    rm -f /etc/apt/keyrings/docker.asc.new
    die "Docker apt 키 지문이 달라요 - 설치를 멈춰요"
  fi
  mv /etc/apt/keyrings/docker.asc.new /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${UBUNTU_CODENAME:-$VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
if [ ! -f /etc/docker/daemon.json ]; then
  install -m 0755 -d /etc/docker
  printf '%s\n' '{ "log-driver": "local", "log-opts": { "max-size": "10m", "max-file": "3" }, "live-restore": true }' > /etc/docker/daemon.json
  systemctl restart docker 2>/dev/null || true
fi
systemctl enable --now docker >/dev/null
say "Docker $(docker version --format '{{.Server.Version}}') + compose $(docker compose version --short)"

# ---------- 3. swap (A1 has 12 GB; swap only absorbs first-boot peaks) ----------
if ! swapon --show=NAME --noheadings | grep -q '^/swapfile$'; then
  if [ ! -f /swapfile ]; then
    say "swap $SWAP_SIZE"
    fallocate -l "$SWAP_SIZE" /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
  fi
  swapon /swapfile
fi
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
echo 'vm.swappiness=10' > /etc/sysctl.d/90-brewai-swap.conf
sysctl -q -p /etc/sysctl.d/90-brewai-swap.conf

# ---------- 4. firewall: Oracle Ubuntu images REJECT everything but 22 in iptables ----------
# Edit the saved rules file (not netfilter-persistent save: that would also freeze Docker's own chains), then apply live.
RULES=/etc/iptables/rules.v4
for port in 80 443; do
  rule=(-p tcp -m state --state NEW -m tcp --dport "$port" -j ACCEPT)
  if [ -f "$RULES" ] && ! grep -q -- "--dport $port -j ACCEPT" "$RULES"; then
    if grep -q '^-A INPUT -j REJECT' "$RULES"; then
      sed -i "0,/^-A INPUT -j REJECT/s//-A INPUT ${rule[*]}\n&/" "$RULES"
    else
      sed -i "0,/^COMMIT/s//-A INPUT ${rule[*]}\n&/" "$RULES"
    fi
  fi
  if ! iptables -C INPUT "${rule[@]}" 2>/dev/null; then
    pos="$(iptables -L INPUT --line-numbers -n | awk '$2 == "REJECT" { print $1; exit }')"
    if [ -n "$pos" ]; then iptables -I INPUT "$pos" "${rule[@]}"; else iptables -A INPUT "${rule[@]}"; fi
  fi
done
say "방화벽 80, 443 열림 (OS). Oracle 콘솔 VCN 보안 목록에도 80, 443 ingress 가 있어야 해요"

# ---------- 5. /opt/brewai + secrets (only the missing ones) ----------
install -d -m 0750 -o root -g root "$BREWAI_HOME" "$BREWAI_HOME/app"
install -d -m 0700 -o root -g root "$BREWAI_HOME/backups"
umask 077
touch "$ENV_FILE"
chown root:root "$ENV_FILE"
chmod 600 "$ENV_FILE"

has() { grep -Eq "^$1=.+" "$ENV_FILE"; }
put() { # put KEY VALUE: append only when KEY has no value yet (an empty KEY= line is replaced)
  if has "$1"; then return 0; fi
  sed -i "/^$1=/d" "$ENV_FILE"
  printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"
  say "  $1 만듦"
}

# A DB that was encrypted with a salt key we no longer have cannot be read: stop instead of making a new one.
if ! has LITELLM_SALT_KEY && docker volume inspect "$DB_VOLUME" >/dev/null 2>&1; then
  die "DB 볼륨($DB_VOLUME)이 있는데 .env 에 LITELLM_SALT_KEY 가 없어요. 예전 값을 되살리세요 (새로 만들면 저장된 키를 못 읽어요)"
fi

if [ -n "$DOMAIN_ARG" ]; then
  if has DOMAIN && ! grep -qx "DOMAIN=$DOMAIN_ARG" "$ENV_FILE"; then sed -i "/^DOMAIN=/d" "$ENV_FILE"; fi
  put DOMAIN "$DOMAIN_ARG"
elif ! has DOMAIN; then
  ip="$(curl -fsS --max-time 10 https://checkip.amazonaws.com | tr -d '[:space:]')"
  [[ "$ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || die "공인 IP 를 못 읽었어요 → 도메인을 직접: sudo bash -s -- <도메인>"
  put DOMAIN "${ip//./-}.sslip.io"
fi
put LITELLM_MASTER_KEY "sk-$(openssl rand -hex 32)"
put LITELLM_SALT_KEY "sk-$(openssl rand -hex 32)"
put LITELLM_DB_PASSWORD "$(openssl rand -hex 24)"
put ADMIN_GATE_TOKEN "$(openssl rand -hex 32)"
put ADMIN_UI_USER admin
if ! has ADMIN_UI_PASSWORD_HASH; then
  pw="$(openssl rand -base64 24 | tr -d '/+=\n' | cut -c1-24)"
  # cost 10: the password is 24 random chars, so guessing stays infeasible, and each /brewai-admin try costs less CPU
  hash="$(printf '%s\n' "$pw" | htpasswd -niBC 10 admin | cut -d: -f2-)"
  printf '%s\n' "$pw" > "$BREWAI_HOME/admin-ui-password"
  chmod 600 "$BREWAI_HOME/admin-ui-password"
  # single quotes: compose reads the bcrypt $ signs literally
  put ADMIN_UI_PASSWORD_HASH "'$hash'"
  unset pw hash
fi
if grep -qi '^LITELLM_LICENSE=' "$ENV_FILE"; then die ".env 에 LITELLM_LICENSE 가 있어요 → 지우세요 (GHSA-w4c7)"; fi

domain="$(sed -n 's/^DOMAIN=//p' "$ENV_FILE")"
say "끝. 비밀값은 $ENV_FILE (root 만 읽음) 에만 있어요. 화면에는 안 찍어요."
say "주소         https://$domain   (첫 배포 뒤 인증서가 자동으로 붙어요)"
say "PC .env 에   LLM_GATEWAY_URL=https://$domain"
say "master key   ssh ubuntu@<IP> sudo grep ^LITELLM_MASTER_KEY= $ENV_FILE"
say "관리 화면    https://$domain/ui   1차 admin / \$(sudo cat $BREWAI_HOME/admin-ui-password)   2차 admin / master key"
say "다음: GitHub Secrets 4개 등록 → Actions 의 deploy-gateway 실행 (README '게이트웨이 서버')"
