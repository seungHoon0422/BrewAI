#!/usr/bin/env bash
# BrewAI 한 번에 켜기 (맥 · 리눅스): ./run.sh   (start.command 더블클릭도 이것을 부른다 · 윈도우 = start.cmd)
#   1/4 최신 코드      git pull --ff-only  — 브랜치에 upstream 이 있고 고친 파일이 없을 때만 (아니면 이유를 말하고 건너뜀 · 실패하면 경고만)
#   2/4 Node 의존성    npm ci              — package-lock.json 이 지난번 설치 뒤 바뀌었을 때만 (도장 = node_modules/.brewai-lock)
#   3/4 파이썬 의존성  uv sync --locked
#   4/4 실행           npm run dev [인자]  — 게이트웨이 + conductor + 데스크톱 + 관리자 콘솔 · 관리자 로그인 admin / admin (테스트 단계)
# 옵션 (환경변수): BREWAI_RUN_DRY=1 = 할 일만 찍고 아무것도 안 함 · BREWAI_RUN_NO_PULL=1 = 1단계 건너뜀
# 끄기 = 이 창에서 Ctrl+C. 2~4단계가 실패하면 이유를 말하고 멈춘다.
set -u
cd "$(dirname "$0")" || exit 1

DRY="${BREWAI_RUN_DRY:-0}"
STAMP="node_modules/.brewai-lock"
B=$'\033[1m'; Y=$'\033[33m'; R=$'\033[31;1m'; N=$'\033[0m'
[ -t 1 ] || { B=''; Y=''; R=''; N=''; }
say() { echo "${B}[brewai]${N} $*"; }
warn() { echo "${B}[brewai]${N} ${Y}$*${N}"; }
fail() {
  echo
  echo "${R}[brewai]${N} $1"
  shift
  for line in "$@"; do echo "          $line"; done
  exit 1
}
# 명령 하나 (DRY = 찍기만)
run() {
  if [ "$DRY" = "1" ]; then
    echo "          (dry) $*"
    return 0
  fi
  "$@"
}

# ── Node: nvm 이 있으면 .nvmrc 의 버전으로 ──
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm use --silent >/dev/null 2>&1 || warn "nvm 에 Node $(cat .nvmrc) 이 없어요 → nvm install $(cat .nvmrc)"
fi
command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 \
  || fail "Node/npm 을 찾지 못했어요." "README 1단계: nvm install $(cat .nvmrc 2>/dev/null || echo 24.22.1)"

# ── 1/4 최신 코드 ──
say "1/4 최신 코드 받기 (git pull --ff-only)"
pull_skip=""
if [ "${BREWAI_RUN_NO_PULL:-0}" = "1" ]; then
  pull_skip="BREWAI_RUN_NO_PULL=1"
elif ! command -v git >/dev/null 2>&1 || ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  pull_skip="git 폴더가 아니에요"
elif ! branch="$(git symbolic-ref -q --short HEAD)"; then
  pull_skip="브랜치가 아닌 커밋에 있어요 (detached HEAD)"
elif ! upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)"; then
  pull_skip="$branch 브랜치에 upstream 이 없어요 (로컬 전용 브랜치)"
elif [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  pull_skip="고친 파일이 있어요 (커밋하거나 정리한 뒤 다시)"
fi
if [ -n "$pull_skip" ]; then
  warn "          건너뜀: $pull_skip"
else
  say "          $branch ← $upstream"
  # 실패해도 멈추지 않는다 (오프라인 · VPN · 갈라진 커밋) — 지금 있는 코드로 켠다
  run git pull --ff-only \
    || warn "          git pull 이 실패했어요 (네트워크 · 서로 갈라진 커밋) → 지금 코드로 계속. 다음에 건너뛰기: BREWAI_RUN_NO_PULL=1 ./run.sh"
fi

# ── 2/4 Node 의존성 ──
say "2/4 Node 의존성 (npm ci · package-lock.json 이 바뀌었을 때만)"
lock_hash="$(node -e "process.stdout.write(require('crypto').createHash('sha256').update(require('fs').readFileSync('package-lock.json')).digest('hex'))")" \
  || fail "package-lock.json 을 읽지 못했어요."
old_hash="$(cat "$STAMP" 2>/dev/null || true)"
if [ "$lock_hash" = "$old_hash" ] && [ -d node_modules ]; then
  say "          그대로예요 (지난번 설치와 같은 lock)"
else
  [ -z "$old_hash" ] && say "          처음 설치하거나 도장이 없어요 → npm ci" || say "          lock 이 바뀌었어요 → npm ci"
  run npm ci || fail "npm ci 가 실패했어요." "위 npm 메시지를 확인하세요 (네트워크 · Node 버전 $(cat .nvmrc 2>/dev/null))."
  [ "$DRY" = "1" ] || printf '%s\n' "$lock_hash" > "$STAMP"
fi

# ── 3/4 파이썬 의존성 ──
say "3/4 파이썬 의존성 (uv sync --locked)"
if command -v uv >/dev/null 2>&1; then
  run uv sync --locked || fail "uv sync --locked 가 실패했어요." "uv.lock 과 pyproject.toml 이 어긋났거나 네트워크 문제예요 (느리면 UV_HTTP_TIMEOUT=300)."
else
  warn "          건너뜀: uv 가 없어요 → README 1단계 (uv 0.13.5). conductor 없이 데스크톱 · 관리자만 떠요"
fi

# ── 4/4 실행 ──
say "4/4 실행 (npm run dev $*)"
if [ "$DRY" = "1" ]; then
  run npm run dev -- "$@"
  say "dry run 끝 — 아무것도 바꾸지 않았어요"
  exit 0
fi
# exec: Ctrl+C 가 dev-all 로 바로 간다 (dev-all 이 모두 닫고 포트를 비운다)
exec npm run dev -- "$@"
