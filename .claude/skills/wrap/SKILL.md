---
name: wrap
description: 세션 종료 루틴. HANDOFF.md를 갱신하고 커밋·push 해서 다른 PC(회사↔집)에서 바로 이어받게 한다. 사용자가 /wrap 을 입력했을 때만 실행.
disable-model-invocation: true
---

0. worktree(`.git` 이 파일)이거나 브랜치가 main·`slice/*` 가 아니면 HANDOFF·REPORT 는 고치지 않는다 → 이 브랜치에 `git add -A` → `git commit` 까지만(push 금지) → "main 체크아웃(`git worktree list` 첫 줄)에서 `git merge --squash <이 브랜치>`(코드면 slice 브랜치로) → /wrap" 이라고 알리고 멈춘다.
1. 이번 세션에서 한 일과 남은 일을 정리한다.
2. `HANDOFF.md` 갱신
   - 상단 표: 마지막 갱신(날짜 · `hostname` · AGENTS.md "PC 이름표"의 집/회사), 활성 브랜치, Phase, 다음 할 일(최대 3개, 1번 = 다음 PC에서 할 첫 작업), 👤 내가 할 일(사람만 할 수 있는 확인·실행, 끝난 건 지운다), 막힘, 결정 대기(= Claude 가 컨펌받을 것).
   - "🕘 최근 기록" 맨 위에 한 줄 추가. 5줄이 넘으면 가장 오래된 줄을 지운다.
   - 처리한 "📥 사용자 메모" 항목은 지운다.
3. Phase가 바뀌었거나 사용자 결정이 새로 생겼으면 `/report` 스킬도 실행한다.
4. 커밋
   - slice 브랜치: 미완성이면 `wip(<scope>): <요약>`, 완성이면 `<type>(<scope>): <요약>`.
   - main: `docs` 또는 `chore` 만. 코드 변경이 main에 있으면 먼저 `git switch -c slice/NN-<이름>`.
   - `git add -A` → `git commit` → upstream 이 있으면 `git pull --rebase` → `git push` (새 브랜치는 `git push -u origin HEAD`). 원격이 없으면 커밋까지만 하고 그렇다고 알린다.
   - `pull --rebase` 충돌: rebase 중엔 `<<<<<<< HEAD`(= --ours)가 다른 PC, `>>>>>>>`(= --theirs)가 이 PC. HANDOFF.md 는 손으로 합친다 — 표는 이 PC 판 + 다른 PC의 확정·결정 대기 변경, "🕘 최근 기록"은 양쪽 줄 모두 → `git add HANDOFF.md` → `git -c core.editor=true rebase --continue`. 다른 파일이 충돌하면 `git rebase --abort` 후 멈추고 보고한다.
5. 보고는 2줄: 커밋 해시 · 다음 PC에서 할 첫 작업.
