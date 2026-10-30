#!/bin/bash
# BrewAI: Finder 에서 더블클릭 = ./run.sh (최신 코드 · 의존성 · 게이트웨이 + conductor + 데스크톱 앱 + 관리자 콘솔). 단계는 run.sh 머리말.
# 끄기 = 이 창에서 Ctrl+C, 또는 데스크톱 앱 ⌘Q (맥은 창을 닫아도 앱이 남는다)
cd "$(dirname "$0")" || exit 1

# exec 대신 기다림: 오류로 끝나면 창이 바로 닫히지 않게 멈춘다
bash ./run.sh "$@"
code=$?
if [ "$code" -ne 0 ]; then
  echo
  read -r -p "[brewai] 오류로 멈췄어요. 위 메시지를 확인하세요. Enter 를 누르면 닫혀요 " _
fi
exit "$code"
