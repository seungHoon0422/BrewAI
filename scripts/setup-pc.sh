#!/usr/bin/env bash
# 새 PC에서 clone 직후 한 번만: bash scripts/setup-pc.sh
set -e
cd "$(git rev-parse --show-toplevel)"

git config pull.rebase true
git config rebase.autoStash true
git config push.autoSetupRemote true
git config fetch.prune true
git config core.autocrlf false

if [ ! -f .env ]; then
  cp .env.example .env
  echo "✔ .env 생성 → 키를 채우세요"
fi
command -v uv >/dev/null 2>&1 || echo "⚠ uv 없음 → https://docs.astral.sh/uv/ 에서 설치"
echo "✔ 완료. Claude Code에서 /start"
