#!/bin/bash
# BrewAI: 게이트웨이(Docker 가 켜져 있으면 Docker LiteLLM · 없으면 venv) + conductor + 데스크톱 앱 + 관리자 콘솔을 한 번에 (Finder 에서 더블클릭).
# 끄기 = 이 창에서 Ctrl+C, 또는 데스크톱 앱 ⌘Q (맥은 창을 닫아도 앱이 남는다)
cd "$(dirname "$0")" || exit 1

# nvm 이 있으면 .nvmrc 의 Node(24.22.1) 로
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh"
  nvm use --silent >/dev/null 2>&1 || echo "[brewai] nvm 에 Node $(cat .nvmrc) 이 없어요 → nvm install $(cat .nvmrc)"
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "[brewai] Node/npm 을 찾지 못했어요 → README 1단계 (nvm install 24.22.1)"
  read -r -p "Enter 를 누르면 닫혀요 " _
  exit 1
fi

# exec 대신 기다림: 오류로 끝나면 창이 바로 닫히지 않게 멈춘다
npm run dev
code=$?
if [ "$code" -ne 0 ]; then
  echo
  read -r -p "[brewai] 오류로 멈췄어요. 위 메시지를 확인하세요. Enter 를 누르면 닫혀요 " _
fi
exit "$code"
