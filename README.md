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
   - **Docker Desktop** (로컬 게이트웨이 · Langfuse, ADR-0009). 메모리: 기본(LiteLLM + DB, 한도 합 ~1 GiB)은 기본값으로 충분 · trace 묶음은 4~6 GB 권장
     - 맥(회사): Docker Desktop › Settings › Resources › Memory → Apply & restart
     - 윈도우(집, WSL2): `%UserProfile%\.wslconfig` 에 `[wsl2]` 다음 줄 `memory=6GB` → `wsl --shutdown` → Docker Desktop 다시 켜기
2. `git clone <repo-url>` (GitHub 로그인은 브라우저에서 직접)
3. clone 한 폴더(worktree 아님)에서 `bash scripts/setup-pc.sh` — git 설정 + `.env` 생성 (`git config user.name/user.email` 은 따로)
4. `npm ci` → `npx --no install-electron` — 데스크톱·관리자·E2E 의존성 (`package-lock.json` 그대로) + Electron 실행 파일(~130MB, 고정 해시로 확인)
5. `.env` 에 모델 키만 입력 (채팅에 붙여 넣지 말 것) · `LLM_GATEWAY_URL=http://127.0.0.1:4000`. `LITELLM_MASTER_KEY` · `LITELLM_DB_PASSWORD` · `LITELLM_SALT_KEY` · Langfuse 비밀값은 비워 두면 `npm run stack` 이 `.env` 에 만든다 (값은 안 찍음 · 두 PC 는 각자 다른 값). **`LITELLM_SALT_KEY` 는 처음 쓴 뒤 바꾸거나 지우지 않는다** (UI 로 저장한 provider 키를 이 값으로 암호화 → 바꾸면 못 읽음 · 바꿔야 하면 `npm run stack:reset -- --yes` 먼저)
   - 파이썬 의존성 (conductor): `uv sync --locked` (`uv.lock` 그대로, 해시 검증 · 회사망은 `UV_HTTP_TIMEOUT=300`)
   - Docker Desktop 을 켜고 `npm run stack` 한 번 → 이미지 받기(LiteLLM + Postgres ~800 MB · PC 마다 한 번) → `[stack] 준비됐어요` (첫 기동은 DB 테이블 만들기로 +몇 초) → 관리 화면 http://127.0.0.1:4000/ui 로그인 `admin` / `.env` 의 `LITELLM_MASTER_KEY` ("Not connected to DB!" 가 뜨면 예전 config-only 스택 → `git pull` 후 `npm run stack` 다시). trace 도 쓸 거면 `npm run stack:trace` (+ ~0.9 GB) → http://localhost:3000 로그인 `dev@brewai.local` / `.env` 의 `LANGFUSE_INIT_USER_PASSWORD`
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

**한 번에 켜기 = `./run.sh`** (맥 · 더블클릭 `start.command` 도 같음) · 윈도우 = 더블클릭 `start.cmd`. 차례: ① `git pull --ff-only` (upstream 있는 브랜치 · 고친 파일 없을 때만, 아니면 이유를 말하고 건너뜀) ② `npm ci` (`package-lock.json` 이 지난번 설치 뒤 바뀌었을 때만) ③ `uv sync --locked` ④ `npm run dev`. 실패하면 이유를 말하고 멈춘다. 미리 보기 = `BREWAI_RUN_DRY=1 ./run.sh` · pull 건너뛰기 = `BREWAI_RUN_NO_PULL=1`.
**관리자 로그인 = `admin` / `admin`** (지금은 테스트 단계 · `npm run dev` 가 켜는 테스트 관리자 · conductor 가 이 PC 주소일 때만 · 데스크톱 앱도 같은 계정 · 끄기 = `.env` 에 `BREWAI_TEST_ADMIN=0` → 그 계정은 잠긴다).

| 명령 | 무엇 |
|---|---|
| `./run.sh` · 더블클릭 `start.cmd`(윈도우) · `start.command`(맥) | 위 4단계 후 `npm run dev` |
| `npm run dev` | **게이트웨이 + conductor + 데스크톱 + 관리자 한 번에** (관리자는 브라우저로 열림 · 끄기 = Ctrl+C 또는 데스크톱 앱 종료). 게이트웨이 = Docker 가 켜져 있으면 스택 LiteLLM (`.env` 에 `BREWAI_TRACE=1` 이면 Langfuse 도) · Docker 가 없거나 꺼져 있으면 venv 게이트웨이 · `BREWAI_STACK=0`(셸 또는 `.env`) = 일부러 venv. Ctrl+C 로는 스택이 안 꺼진다 (다음 실행이 빠름 · Docker Desktop 을 다시 켜도 뜬다 → 끄기 = `npm run stack:down`). 이미 8787 에 떠 있으면 그대로 쓴다 |
| `npm run stack` | 로컬 Docker 스택 = **LiteLLM + 그 전용 Postgres**(DB 모드 · 호스트에 안 열림) → http://127.0.0.1:4000 · 관리 화면 `/ui` (`admin` / `LITELLM_MASTER_KEY` · 모델 추가 = Models + Endpoints → `config.yaml` 모델과 함께 conductor 가 `/model_group/info` 로 가져감) · 비밀값이 없으면 `.env` 에 만든다 |
| `npm run stack:trace` (= `npm run stack -- trace`) | + Langfuse 묶음 (web · worker · Postgres · ClickHouse · Redis · MinIO, 한도 합 ~2.4 GiB) → http://localhost:3000 (`dev@brewai.local` / `.env` 비번) · trace 받는 곳 `/api/public/otel` |
| `npm run stack:down` | 스택 전부 끄기 (데이터는 남음) · `stack:status` = 상태 + 메모리 · `stack:logs -- <서비스>` · `stack:reset -- --yes` = 볼륨까지 삭제 (UI 로 넣은 모델·키도) |
| `npm run desktop` | 데스크톱 앱 (Electron, 고치면 바로 반영) |
| `npm run admin` | 관리자 콘솔 → http://localhost:5174 |
| `npm run gateway` | (대체) venv LiteLLM → http://127.0.0.1:4000 (config-only · 모델 = `infra/litellm/config.yaml` 만, 키 없는 `brewai-mock` 포함 · 관리 화면 로그인 안 됨). 스택이 4000 을 쓰고 있으면 거부 → 먼저 `npm run stack:down` |
| `npm run api` | conductor → http://127.0.0.1:8787 (`/healthz` · `/api/models` · `/api/admin/models` · `/api/chat`) |
| `npm run e2e` | 빌드 + Playwright desktop · admin · web (mock 게이트웨이 4010 · conductor 8787 · 관리자 preview 4174 를 스스로 띄운다 → 먼저 `npm run api`·`npm run dev` 를 끈다 · Docker 스택은 그대로 둬도 됨) |
| `apps/web/index.html` | 랜딩 (브라우저로 열기) |

스택은 `npm run stack:down` 으로 끈다 (`docker compose` 를 직접 쓸 땐 `docker compose -p brewai -f infra/compose.yaml --env-file .env --profile trace …`). 포트가 이미 쓰이면 `.env` 의 `LITELLM_PORT` · `LANGFUSE_PORT` · `LANGFUSE_MEDIA_PORT` 로 바꾼다 (`LITELLM_PORT` 를 바꾸면 `LLM_GATEWAY_URL` 도).
venv 게이트웨이·conductor 는 Ctrl+C 로 끈다. 래퍼만 `kill -9` 하면 uv·python 이 남아 포트를 잡는다 → `lsof -i :4000` / `:8787` 로 찾아 끈다.

## 게이트웨이 서버 (Oracle 무료)

두 PC 가 **같은 게이트웨이**(모델 · provider 키 한 곳)를 쓴다. 요금 0 (Always Free) · 주소 = `https://<IP 의 . 을 - 로>.sslip.io` (무료 · 자동 https) · 결정 = [ADR-0014](docs/adr/0014-gateway-server-oracle-free.md). 한 번만, 한 PC 에서 (맥 터미널 또는 Git Bash, 레포 폴더):

1. **Oracle Cloud 가입** (cloud.oracle.com · 카드 = 본인 확인, Always Free 만 쓰면 청구 없음). 홈 리전은 나중에 못 바꾼다 → A1 여유가 있는 리전으로
2. **VM 만들기**: Compute › Instances › Create — 이미지 **Ubuntu 24.04** (aarch64) · Shape **VM.Standard.A1.Flex 2 OCPU / 12 GB** · 공인 IPv4 자동 할당 · SSH 키 = 내 공개키 업로드 (`~/.ssh/id_ed25519.pub`, 없으면 `ssh-keygen -t ed25519`). "Out of capacity" 면 다른 AD 를 고르거나 몇 시간 뒤 다시
3. **포트 열기**: Networking › Virtual cloud networks › (그 VCN) › Security Lists › Default › Add Ingress Rules — Source `0.0.0.0/0` · TCP · 포트 `80` 한 줄, `443` 한 줄 (22 는 이미 있음)
4. **서버 준비**: `ssh ubuntu@<IP>` 로 한 번 접속(지문 yes) 후 `ssh ubuntu@<IP> 'sudo bash -s' < infra/deploy/bootstrap.sh` → Docker · swap · 방화벽 · `/opt/brewai/.env`(master key · salt · DB 비번 = 서버에서 만들고 화면에 안 찍음). 다시 돌려도 있는 값은 안 바뀐다
5. **배포 키** (GitHub 전용): `ssh-keygen -t ed25519 -f ~/.ssh/brewai_deploy -N "" -C brewai-deploy` → `ssh ubuntu@<IP> 'cat >> ~/.ssh/authorized_keys' < ~/.ssh/brewai_deploy.pub`
6. **GitHub Secrets 4개**: 레포 › Settings › Environments › New environment `gateway` → Deployment branches = Selected › `develop` 만 → 그 Environment 의 Environment secrets 에 (레포 Actions secrets 아님 · 배포 키 = 서버 root 라 다른 브랜치가 못 읽게): `DEPLOY_HOST` = IP · `DEPLOY_USER` = `ubuntu` · `DEPLOY_SSH_KEY` = `~/.ssh/brewai_deploy` 파일 내용 전체 · `DEPLOY_KNOWN_HOSTS` = `ssh-keygen -F <IP> | grep -v '^#'` 출력. (gh: `gh secret set DEPLOY_SSH_KEY --env gateway < ~/.ssh/brewai_deploy`) — 게이트웨이 비밀값은 GitHub 에 넣지 않는다
7. **배포**: develop 에 `infra/deploy/**` · `infra/litellm/**` 가 push 되면 자동 (시크릿 없으면 건너뜀). 시크릿 등록 전 실행이었다면 Actions › deploy-gateway › 그 실행 › **Re-run all jobs**. 초록 + "게이트웨이 https://… 정상" 이면 끝 (첫 배포는 인증서 발급으로 1~2분)
8. **두 PC `.env`**: `LLM_GATEWAY_URL=https://<IP-대시>.sslip.io` · `LITELLM_MASTER_KEY=<서버 값>` (`ssh ubuntu@<IP> sudo grep ^LITELLM_MASTER_KEY= /opt/brewai/.env` · 채팅에 붙여 넣지 말 것) → `npm run dev` 가 "게이트웨이 = 원격 서버" 라고 말하고 로컬 Docker 게이트웨이는 안 띄운다
9. **모델 다시 등록**: `https://<도메인>/ui` → 브라우저 창 `admin` / `ssh ubuntu@<IP> sudo cat /opt/brewai/admin-ui-password` → LiteLLM 로그인 `admin` / master key → Models + Endpoints 에서 provider 키와 함께 추가 (로컬 스택에 넣은 모델은 안 옮겨진다)

| 알아 둘 것 | |
|---|---|
| 공개 범위 | 밖에서 되는 건 conductor 가 쓰는 4개(`/v1/chat/completions` · `/model_group/info` · `/v1/model/info` · `/health/liveliness`)뿐, 그것도 master key 필요. 관리 화면 · 관리 API = 1차 basic auth 뒤 · docs · metrics = 404 |
| 백업 | 매일 03:30 KST `pg_dump` 7개 (`/opt/brewai/backups`, 같은 VM 안). 매주 또는 모델을 추가한 뒤 PC 로 꺼내기: `ssh ubuntu@<IP> 'sudo cat /opt/brewai/backups/latest.dump' > brewai-litellm.dump`. `/opt/brewai/.env` 도 비밀번호 관리자에 한 부 (SALT 없으면 덤프 속 키를 못 읽음) |
| `LITELLM_SALT_KEY` | **절대 안 바꾼다.** 서버를 새로 만들면 = 새 DB → 모델 다시 등록, 또는 아래 **복원** |
| 내 도메인 | DNS A 레코드 → IP, `ssh ubuntu@<IP> 'sudo bash -s -- gw.example.com' < infra/deploy/bootstrap.sh` → Re-run → `.env` 주소도 바꿈 |
| 회수 주의 | Oracle 은 7일 내내 거의 안 쓰는 Always Free VM 을 회수할 수 있다 → 계정을 Pay As You Go 로 올리면 대상 아님 (Always Free 한도 안이면 여전히 0원) |
| 서버 명령 | `sudo docker compose -p brewai-gateway --env-file /opt/brewai/.env -f /opt/brewai/app/infra/deploy/compose.yaml ps` (`logs litellm` · `restart`) |
| 업데이트 (매달) | 자동은 Ubuntu 보안 패키지뿐. Docker 엔진 · 커널은 `ssh -t ubuntu@<IP> 'sudo apt-get update && sudo apt-get upgrade -y && sudo reboot'` (컨테이너는 재부팅 뒤 저절로 다시 뜬다) |
| 게이트 쿠키 바꾸기 | 쿠키가 샜으면 (공용 브라우저 등): `ssh ubuntu@<IP> "sudo sed -i '/^ADMIN_GATE_TOKEN=/d' /opt/brewai/.env"` → bootstrap 다시 (빠진 값만 만듦) → deploy-gateway Re-run (`.env` 가 바뀌면 caddy 를 새로 띄운다) |
| 복원 | 새 서버나 DB 를 되돌릴 때, 순서대로. ① bootstrap ② **첫 배포 전에** `ssh -t ubuntu@<IP> sudoedit /opt/brewai/.env` 로 `LITELLM_SALT_KEY=` 를 예전 값으로 (배포 뒤엔 바꾸지 않는다) ③ deploy-gateway Re-run ④ PC 에서 `ssh ubuntu@<IP> 'sudo docker compose -p brewai-gateway --env-file /opt/brewai/.env -f /opt/brewai/app/infra/deploy/compose.yaml stop litellm'` ⑤ `ssh ubuntu@<IP> 'sudo docker compose -p brewai-gateway --env-file /opt/brewai/.env -f /opt/brewai/app/infra/deploy/compose.yaml exec -T litellm-db pg_restore --clean --if-exists --no-owner -U litellm -d litellm' < brewai-litellm.dump` ⑥ `ssh ubuntu@<IP> 'sudo docker compose -p brewai-gateway --env-file /opt/brewai/.env -f /opt/brewai/app/infra/deploy/compose.yaml start litellm'` |
