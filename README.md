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
     - PowerShell 이 `npm.ps1` 을 막으면 `npm.cmd` · `npx.cmd` 를 쓰거나 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` 한 번
   - macOS: `curl -LsSf https://astral.sh/uv/0.13.5/install.sh | sh` (brew·pip 로 깐 uv 는 버전 고정·`uv self update` 불가) · `nvm install 24.22.1 && nvm alias default 24.22.1` · Claude Code (hook은 기본 `/bin/bash`)
   - 공통: `uv python install 3.13` (이미 있으면 `uv python upgrade 3.13`)
2. `git clone <repo-url>` (GitHub 로그인은 브라우저에서 직접)
3. clone 한 폴더(worktree 아님)에서 `bash scripts/setup-pc.sh` — git 설정 + `.env` 생성 (`git config user.name/user.email` 은 따로)
4. `npm ci` → `npx --no install-electron` — 데스크톱·관리자·E2E 의존성 (`package-lock.json` 그대로) + Electron 실행 파일(~130MB, 고정 해시로 확인)
5. `.env` 에 키 입력 (채팅에 붙여 넣지 말 것). `LITELLM_MASTER_KEY` 는 새로 만든다: `node -e "console.log('sk-'+require('crypto').randomBytes(32).toString('hex'))"` · `LLM_GATEWAY_URL=http://127.0.0.1:4000`
   - 파이썬 의존성 (conductor): `uv sync --locked` (`uv.lock` 그대로, 해시 검증 · 회사망은 `UV_HTTP_TIMEOUT=300`)
   - **게이트웨이 설치 1회** (LiteLLM 1.106.2 전용 venv · 해시 고정). `--only-binary :all:` 를 빼지 않는다:
     ```bash
     uv venv infra/litellm/.venv --python 3.13
     uv pip sync --require-hashes --only-binary :all: --python infra/litellm/.venv infra/litellm/requirements.txt
     ```
     윈도우는 먼저 `PYTHONUTF8=1` · `PYTHONIOENCODING=utf-8` (PowerShell: `$env:PYTHONUTF8='1'; $env:PYTHONIOENCODING='utf-8'`).
     lock 다시 만들기(버전 올릴 때만, `infra/litellm` 안): `uv pip compile requirements.in -c constraints.txt --universal --python-version 3.13 --generate-hashes --exclude-newer <오늘-7일> --no-config -o requirements.txt`
6. Claude Code로 폴더 열기 → 폴더 신뢰 허용 → `/start`
7. `AGENTS.md` "PC 이름표"에 이 PC의 `hostname` 과 집/회사 추가

## 실행

| 명령 | 무엇 |
|---|---|
| `npm run dev` · 더블클릭 `start.cmd`(윈도우) · `start.command`(맥) | **게이트웨이 + conductor + 데스크톱 + 관리자 한 번에** (관리자는 브라우저로 열림 · 끄기 = Ctrl+C 또는 데스크톱 앱 종료). 게이트웨이·conductor 는 설치돼 있고 `.env` 가 있을 때만 — 아니면 이유를 말하고 데스크톱·관리자만. 이미 4000·8787 에 떠 있으면 그대로 쓴다 |
| `npm run desktop` | 데스크톱 앱 (Electron, 고치면 바로 반영) |
| `npm run admin` | 관리자 콘솔 → http://localhost:5174 |
| `npm run gateway` | LiteLLM 게이트웨이 → http://127.0.0.1:4000 (모델 = `infra/litellm/config.yaml`, 키 없는 `brewai-mock` 포함) |
| `npm run api` | conductor → http://127.0.0.1:8787 (`/healthz` · `/api/models` · `/api/admin/models` · `/api/chat`) |
| `npm run e2e` | 빌드 + Playwright desktop · admin · web (mock 게이트웨이 4010 · conductor 8787 · 관리자 preview 4174 를 스스로 띄운다 → 먼저 `npm run api`·`npm run dev` 를 끈다) |
| `apps/web/index.html` | 랜딩 (브라우저로 열기) |

게이트웨이·conductor 는 Ctrl+C 로 끈다. 래퍼만 `kill -9` 하면 uv·python 이 남아 포트를 잡는다 → `lsof -i :4000` / `:8787` 로 찾아 끈다.
