---
name: slice
description: 월요일 슬라이스 정하기. 짧은 객관식 인터뷰 후 docs/slices/NN-이름.md 1쪽을 만들고 slice 브랜치를 판다. 사용자가 /slice 를 입력했을 때만 실행.
disable-model-invocation: true
argument-hint: "[이번 주에 하고 싶은 것 한 줄]"
---

0. worktree(`.git` 이 파일)면 인터뷰·파일 쓰기 전에 멈춘다 → main 체크아웃 경로(`git worktree list` 첫 줄)를 알린다.
1. `docs/roadmap.json` 에서 `passes: false` 인 첫 Phase와 그 exit criteria, `slice_hint` 를 확인한다.
2. 객관식 질문 최대 3개로 범위를 좁힌다. 입력: $ARGUMENTS
3. `docs/slices/NN-<kebab>.md` 를 1쪽으로 쓴다 (NN = docs/slices/ 의 최대 번호 + 1, 없으면 01):
   - 목표 (1줄)
   - 연결된 exit criteria ID (예: P1-2)
   - 데모 스크립트 (3단계 — 금요일에 그대로 실행)
   - done 체크 (5개 이하)
   - 범위 밖
   - 함정 (rabbit hole)
4. 브랜치: `git switch main` → `git pull --rebase`(원격 있을 때) → `git switch -c slice/NN-<kebab>` → 원격이 있으면 `git push -u origin slice/NN-<kebab>`.
   `HANDOFF.md` 의 활성 브랜치를 갱신한다.
5. 보고는 1줄: "이번 주 금요일 데모: …"
