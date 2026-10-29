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
   - **Docker Desktop** (로컬 게이트웨이 · Langfuse, ADR-0009). 메모리: 기본(LiteLLM 만)은 기본값으로 충분 · trace 묶음은 4~6 GB 권장
     - 맥(회사): Docker Desktop › Settings › Resources › Memory → Apply & restart
     - 윈도우(집, WSL2): `%UserProfile%\.wslconfig` 에 `[wsl2]` 다음 줄 `memory=6GB` → `wsl --shutdown` → Docker Desktop 다시 켜기
2. `git clone <repo-url>` (GitHub 로그인은 브라우저에서 직접)
3. clone 한 폴더(worktree 아님)에서 `bash scripts/setup-pc.sh` — git 설정 + `.env` 생성 (`git config user.name/user.email` 은 따로)
4. `npm ci` → `npx --no install-electron` — 데스크톱·관리자·E2E 의존성 (`package-lock.json` 그대로) + Electron 실행 파일(~130MB, 고정 해시로 확인)
5. `.env` 에 모델 키만 입력 (채팅에 붙여 넣지 말 것) · `LLM_GATEWAY_URL=http://127.0.0.1:4000`. `LITELLM_MASTER_KEY` · Langfuse 비밀값은 비워 두면 `npm run stack` 이 `.env` 에 만든다 (값은 안 찍음 · 두 PC 는 각자 다른 값)
   - 파이썬 의존성 (conductor): `uv sync --locked` (`uv.lock` 그대로, 해시 검증 · 회사망은 `UV_HTTP_TIMEOUT=300`)
   - Docker Desktop 을 켜고 `npm run stack` 한 번 → 이미지 받기(LiteLLM ~640 MB · PC 마다 한 번) → `[stack] 준비됐어요`. trace 도 쓸 거면 `npm run stack:trace` (+ ~0.9 GB) → http://localhost:3000 로그인 `dev@brewai.local` / `.env` 의 `LANGFUSE_INIT_USER_PASSWORD`
   - **Docker 를 못 쓰는 PC 만 — 게이트웨이 설치 1회** (LiteLLM 1.106.2 전용 venv · 해시 고정 · `LITELLM_MASTER_KEY` 는 `node -e "console.log('sk-'+require('crypto').randomBytes(32).toString('hex'))"` 로 직접). `--only-binary :all:` 를 빼지 않는다:
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
| `npm run dev` · 더블클릭 `start.cmd`(윈도우) · `start.command`(맥) | **게이트웨이 + conductor + 데스크톱 + 관리자 한 번에** (관리자는 브라우저로 열림 · 끄기 = Ctrl+C 또는 데스크톱 앱 종료). 게이트웨이 = Docker 가 켜져 있으면 스택 LiteLLM (`.env` 에 `BREWAI_TRACE=1` 이면 Langfuse 도) · Docker 가 없거나 꺼져 있으면 venv 게이트웨이 · `BREWAI_STACK=0`(셸 또는 `.env`) = 일부러 venv. Ctrl+C 로는 스택이 안 꺼진다 (다음 실행이 빠름 · Docker Desktop 을 다시 켜도 뜬다 → 끄기 = `npm run stack:down`). 이미 8787 에 떠 있으면 그대로 쓴다 |
| `npm run stack` | 로컬 Docker 스택 = **LiteLLM 만** → http://127.0.0.1:4000 (가볍게 · 비밀값이 없으면 `.env` 에 만든다) |
| `npm run stack:trace` (= `npm run stack -- trace`) | + Langfuse 묶음 (web · worker · Postgres · ClickHouse · Redis · MinIO, 한도 합 ~2.4 GiB) → http://localhost:3000 (`dev@brewai.local` / `.env` 비번) · trace 받는 곳 `/api/public/otel` |
| `npm run stack:down` | 스택 전부 끄기 (데이터는 남음) · `stack:status` = 상태 + 메모리 · `stack:logs -- <서비스>` · `stack:reset -- --yes` = 볼륨까지 삭제 |
| `npm run desktop` | 데스크톱 앱 (Electron, 고치면 바로 반영) |
| `npm run admin` | 관리자 콘솔 → http://localhost:5174 |
| `npm run gateway` | (대체) venv LiteLLM → http://127.0.0.1:4000 (모델 = `infra/litellm/config.yaml`, 키 없는 `brewai-mock` 포함). 스택이 4000 을 쓰고 있으면 거부 → 먼저 `npm run stack:down` |
| `npm run api` | conductor → http://127.0.0.1:8787 (`/healthz` · `/api/models` · `/api/admin/models` · `/api/chat`) |
| `npm run e2e` | 빌드 + Playwright desktop · admin · web (mock 게이트웨이 4010 · conductor 8787 · 관리자 preview 4174 를 스스로 띄운다 → 먼저 `npm run api`·`npm run dev` 를 끈다 · Docker 스택은 그대로 둬도 됨) |
| `apps/web/index.html` | 랜딩 (브라우저로 열기) |

스택은 `npm run stack:down` 으로 끈다 (`docker compose` 를 직접 쓸 땐 `docker compose -p brewai -f infra/compose.yaml --env-file .env --profile trace …`). 포트가 이미 쓰이면 `.env` 의 `LITELLM_PORT` · `LANGFUSE_PORT` · `LANGFUSE_MEDIA_PORT` 로 바꾼다 (`LITELLM_PORT` 를 바꾸면 `LLM_GATEWAY_URL` 도).
venv 게이트웨이·conductor 는 Ctrl+C 로 끈다. 래퍼만 `kill -9` 하면 uv·python 이 남아 포트를 잡는다 → `lsof -i :4000` / `:8787` 로 찾아 끈다.
