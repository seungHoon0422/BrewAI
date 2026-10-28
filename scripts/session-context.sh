#!/usr/bin/env bash
# SessionStart hook. stdout 이 그대로 Claude 컨텍스트에 들어가므로 짧게 유지한다.
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" || exit 0

echo "## 세션 컨텍스트 · $(hostname)"
if git rev-parse --git-dir >/dev/null 2>&1; then
  GIT_TERMINAL_PROMPT=0 timeout 15 git fetch -q --prune 2>/dev/null
  git status -sb 2>/dev/null | head -n 12
  behind=$(git rev-list --count 'HEAD..@{u}' 2>/dev/null)
  if [ -n "$behind" ] && [ "$behind" != "0" ]; then
    echo "⚠ 원격보다 ${behind}커밋 뒤처짐 → /start 로 pull"
  fi
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    echo "⚠ 커밋 안 된 변경 있음"
  fi
  # 다른 PC가 마지막으로 작업한 브랜치 (HANDOFF 최신본이 있는 곳)
  latest=$(git for-each-ref --sort=-committerdate --format='%(refname:lstrip=3)' refs/remotes/origin 2>/dev/null | grep -vx HEAD | head -n 1)
  current=$(git branch --show-current 2>/dev/null)
  if [ -n "$latest" ] && [ "$latest" != "$current" ]; then
    echo "⚠ 최신 작업 브랜치 = $latest (지금 $current) → /start 가 전환"
  fi
fi
# 표 + 📥 사용자 메모까지 (최근 기록은 생략)
[ -f HANDOFF.md ] && sed '/최근 기록/,$d' HANDOFF.md | head -n 30
exit 0
