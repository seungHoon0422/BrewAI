---
name: start
description: 세션 시작 루틴. 최신 작업 브랜치로 맞추고 HANDOFF.md를 읽어 지금 상태를 3줄로 보고한다. 사용자가 /start 를 입력했을 때만 실행.
disable-model-invocation: true
---

1. 최신화 (원격이 없으면 건너뛴다)
   - `git fetch --prune`
   - 다른 PC가 마지막으로 작업한 브랜치:
     `git for-each-ref --sort=-committerdate --format='%(refname:lstrip=3)' refs/remotes/origin | grep -vx HEAD | head -n 1`
   - 지금 브랜치와 다르면 `git switch <그 브랜치>` (커밋 안 된 변경이 있으면 멈추고 보고)
   - `git pull --rebase`. 충돌이 나면 멈추고 보고한다.
2. `HANDOFF.md` 를 읽는다. "📥 사용자 메모" 칸에 항목이 있으면 이번 세션 작업 후보로 잡는다.
3. 아래 3줄로만 보고한다. 다른 설명은 붙이지 않는다.
   - 📍 지금: <Phase / 브랜치 / 마지막으로 한 일>
   - ▶ 다음: <이번 세션에서 할 한 가지>
   - ⛔ 막힘·결정 대기: <없으면 "없음">
4. 사용자가 OK 하면 작업을 시작한다.
