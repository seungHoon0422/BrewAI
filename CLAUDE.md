@AGENTS.md

# Claude Code 전용

- 세션 시작은 `/start`, 끝낼 때는 `/wrap`. 보고서 갱신은 `/report`.
- 파일 3개 이상 바뀌는 작업은 계획부터 보여주고 OK 받은 뒤 실행.
- 병렬 실험은 git worktree에서. main 작업 트리와 섞지 않는다.
- `~/.claude` 개인 메모리는 PC마다 다르다. 두 PC가 알아야 하는 사실은 HANDOFF.md 또는 docs/adr/ 에 남긴다.
