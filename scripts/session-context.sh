#!/usr/bin/env bash
# SessionStart hook. stdout 이 그대로 Claude 컨텍스트에 들어가므로 짧게 유지한다.
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" || exit 0

echo "## 세션 컨텍스트 · $(hostname)"
if git rev-parse --git-dir >/dev/null 2>&1; then
  command -v timeout >/dev/null 2>&1 || timeout() { perl -e '$t=shift; $p=fork // exit 125; if (!$p) { setpgrp(0,0); exec @ARGV or exit 127 } $SIG{ALRM}=sub { kill "TERM", -$p; kill "CONT", -$p; exit 124 }; alarm $t; waitpid $p, 0; exit($? & 127 ? 128+($? & 127) : $? >> 8)' "$@"; }  # macOS: GNU timeout 없음 → 같은 동작(그룹에 TERM, 124)
  { GIT_TERMINAL_PROMPT=0 timeout 15 git fetch -q --prune; } >/dev/null 2>&1 || echo "⚠ fetch 실패 → 원격 상태 모름"
  git status -sb 2>/dev/null | head -n 12
  behind=$(git rev-list --count 'HEAD..@{u}' 2>/dev/null)
  if [ -n "$behind" ] && [ "$behind" != "0" ]; then
    echo "⚠ 원격보다 ${behind}커밋 뒤처짐 → /start 로 pull"
  fi
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    echo "⚠ 커밋 안 된 변경 있음"
  fi
  # 다른 PC가 마지막으로 작업한 브랜치 (main·slice/* 만 — orca·exp 브랜치 제외)
  latest=$(git for-each-ref --sort=-refname --sort=-committerdate --count=1 --format='%(refname:lstrip=3)' refs/remotes/origin/main refs/remotes/origin/slice 2>/dev/null)
  current=$(git branch --show-current 2>/dev/null)
  if [ -f .git ]; then  # linked worktree(orca·exp): 이어받기 루틴은 main 체크아웃에서
    echo "ℹ worktree($current) → /start·/wrap·/slice 는 $(git worktree list --porcelain | sed -n '1s/^worktree //p') 에서 · 아래 HANDOFF = origin/$latest"
    [ -n "$latest" ] && git show "origin/$latest:HANDOFF.md" 2>/dev/null | sed '/최근 기록/,$d' | head -n 30
    exit 0
  fi
  if [ -n "$latest" ] && [ "$latest" != "$current" ]; then
    echo "⚠ 최신 작업 브랜치 = $latest (지금 $current) → /start 가 전환"
  fi
fi
# 표 + 📥 사용자 메모까지 (최근 기록은 생략)
[ -f HANDOFF.md ] && sed '/최근 기록/,$d' HANDOFF.md | head -n 30
exit 0
