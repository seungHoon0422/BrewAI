# BrewAI

채팅 중에 에이전트가 필요한 Skill·MCP를 스스로 찾고·만들어 쓰고, 사람은 **인증·승인만** 하는 에이전트 플랫폼.

| 보고 싶은 것 | 파일 |
|---|---|
| 구조·흐름·로드맵 (그림) | [REPORT.html](REPORT.html) — 브라우저로 열기 |
| 지금 어디까지 / 다음 할 일 | [HANDOFF.md](HANDOFF.md) |
| Phase별 완료 기준 | [docs/roadmap.json](docs/roadmap.json) |
| 결정 기록 | [docs/adr/](docs/adr/) |
| 이번 슬라이스 (목표·데모·done) | [docs/slices/](docs/slices/) |
| 에이전트 작업 규칙 | [AGENTS.md](AGENTS.md) |

## 새 PC 처음 1회

1. 설치 — 두 PC 같은 버전: uv **0.13.5** · Node **24.22.1** · Python 3.13
   - Windows: Git for Windows (hook이 bash 사용) · `winget install -e --id astral-sh.uv --version 0.13.5` · `winget install -e --id OpenJS.NodeJS.LTS --version 24.22.1` · Claude Code
   - macOS: `curl -LsSf https://astral.sh/uv/0.13.5/install.sh | sh` (brew·pip 로 깐 uv 는 버전 고정·`uv self update` 불가) · `nvm install 24.22.1 && nvm alias default 24.22.1` · Claude Code (hook은 기본 `/bin/bash`)
   - 공통: `uv python install 3.13` (이미 있으면 `uv python upgrade 3.13`)
2. `git clone <repo-url>` (GitHub 로그인은 브라우저에서 직접)
3. clone 한 폴더(worktree 아님)에서 `bash scripts/setup-pc.sh` — git 설정 + `.env` 생성 (`git config user.name/user.email` 은 따로)
4. `npm ci` → `npx --no install-electron` — 데스크톱·관리자·E2E 의존성 (`package-lock.json` 그대로) + Electron 실행 파일(~130MB, 고정 해시로 확인)
5. `.env` 에 키 입력 (채팅에 붙여 넣지 말 것)
6. Claude Code로 폴더 열기 → 폴더 신뢰 허용 → `/start`
7. `AGENTS.md` "PC 이름표"에 이 PC의 `hostname` 과 집/회사 추가

## 실행

| 명령 | 무엇 |
|---|---|
| `npm run desktop` | 데스크톱 앱 (Electron, 고치면 바로 반영) |
| `npm run admin` | 관리자 콘솔 → http://localhost:5174 |
| `npm run e2e` | 빌드 + Playwright desktop · admin · web |
| `apps/web/index.html` | 랜딩 (브라우저로 열기) |
