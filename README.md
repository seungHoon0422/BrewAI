# BrewAI

채팅 중에 에이전트가 필요한 Skill·MCP를 스스로 찾고·만들어 쓰고, 사람은 **인증·승인만** 하는 에이전트 플랫폼.

| 보고 싶은 것 | 파일 |
|---|---|
| 구조·흐름·로드맵 (그림) | [REPORT.html](REPORT.html) — 브라우저로 열기 |
| 지금 어디까지 / 다음 할 일 | [HANDOFF.md](HANDOFF.md) |
| Phase별 완료 기준 | [docs/roadmap.json](docs/roadmap.json) |
| 결정 기록 | [docs/adr/](docs/adr/) |
| 에이전트 작업 규칙 | [AGENTS.md](AGENTS.md) |

## 새 PC 처음 1회

1. 설치: Git for Windows (hook이 bash 사용) · `winget install astral-sh.uv` · `uv python install 3.13` · Claude Code
2. `git clone <repo-url>` (GitHub 로그인은 브라우저에서 직접)
3. 레포 안에서 `bash scripts/setup-pc.sh` — git 설정 + `.env` 생성 (`git config user.name/user.email` 은 따로)
4. `.env` 에 키 입력 (채팅에 붙여 넣지 말 것)
5. Claude Code로 폴더 열기 → 폴더 신뢰 허용 → `/start`
6. `AGENTS.md` "PC 이름표"에 이 PC의 `hostname` 과 집/회사 추가
