# slice 02 · 모델 연동 (게이트웨이 → conductor → 관리자 '모델' · 데스크톱 대화)

- 목표: LiteLLM 게이트웨이(모델은 `infra/litellm/config.yaml` 에만 등록) → conductor(Pydantic AI) → 관리자 '모델' 읽기 전용 표 · 데스크톱 '대화' 답이 조각으로 흘러 들어온다 (ADR-0006 · 0008).
- 연결된 exit criteria: **P1-1 앞부분** (툴·결과 카드는 slice 03). 이 slice 로 roadmap passes 는 안 바뀐다.
- 시작: 2026-10-29 (목) — slice 01 위에 쌓는다. assistant-ui 는 slice 03 (지금은 손으로 쓴 SSE 리더).

## 연결 (127.0.0.1 만)
| 누가 | 주소 | 무엇 |
|---|---|---|
| 게이트웨이 `npm run stack` (Docker · 대체 `npm run gateway` venv) | :4000 | LiteLLM 1.106.2 · Docker = DB 모드(`litellm-db` · 관리 화면 `/ui`) · venv = config-only · config 에는 `brewai-mock`(키 없음)만, 실제 모델은 관리 화면에서 추가 |
| Langfuse `npm run stack:trace` (선택) | :3000 | 셀프호스트 4.67.0 · OTLP `/api/public/otel` · conductor 연결은 slice 03 (ADR-0009) |
| conductor `npm run api` | :8787 | `GET /healthz` · `GET /api/models` · `GET /api/admin/models` · `POST /api/chat`(AG-UI SSE) |
| 관리자 · 데스크톱 | 5174 · app:// | conductor 만 부른다 (키 없음) |

## 데모 스크립트 (금요일 — 두 PC 각각)
1. `npm run e2e` → desktop · admin · web 전부 green. `uv run --locked pytest` (evals + conductor) green.
   한 번에: `npm run dev` (또는 start 파일) = 아래 2~5 를 한 창에서.
2. 터미널 1 `npm run stack` → `[stack] 준비됐어요` (Docker LiteLLM + DB · `npm run stack:status` 로 메모리). `config.yaml` 을 열어 "모델 등록 = 여기 + 관리 화면 `/ui`(admin / 마스터 키)".
   trace 도 보여 줄 때: `npm run stack:trace` → http://localhost:3000 로그인 `dev@brewai.local` / `.env` 비번 → 프로젝트 `brewai-dev` (대화 trace 는 slice 03 부터).
   Docker 가 없는 PC: `npm run gateway` (venv) → `Uvicorn running on http://127.0.0.1:4000`.
3. 터미널 2 `npm run api` → `curl -s http://127.0.0.1:8787/api/models` → `brewai-mock` 이 첫 항목.
4. 터미널 3 `npm run admin` → '모델': 4행 모두 노출 1~4, 입력칸 없음.
5. 터미널 4 `npm run desktop` → 모델 버튼 `brewai-mock` → "안녕" → "Hello from the BrewAI mock model." (LiteLLM mock 은 조각을 몇 ms 안에 다 보내서 한 번에 뜬 것처럼 보임 · 조각 흐름은 E2E `chat.spec` 또는 키 있는 모델로) → 하나 더 물어 쌓임.
6. 키가 있는 PC: LiteLLM 관리 화면에서 Claude 를 추가(Credential = Anthropic 키) → 관리자 › 모델에서 노출 → 데스크톱에서 골라 한국어 답. 키가 없으면 "이 모델을 지금 쓸 수 없어요. 관리자에게 알려 주세요" = 정상(`provider_auth_failed` · OpenAI 키 없음은 LiteLLM 이 500 "Missing credentials" 로 줘서 conductor 가 같은 코드로 바꾼다).
7. 실패 보기: 터미널 2 Ctrl+C → 보내기 → "서버에 연결할 수 없어요" → `npm run api` → 다시 시도 → 답. 게이트웨이를 끄면(`npm run stack:down`) 관리자 '모델' 이 "게이트웨이에 연결할 수 없어요".
8. 끝: `npm run stack:down` (데이터는 남음).

## done
- [x] 게이트웨이: hash lock 121개(다이제스트 `760700c6…`) · `--only-binary :all:` sync · 회사 맥에서 1.106.2 기동 · mock 스트림
- [x] conductor: 4개 경로 · RUN_ERROR 코드 정리(키·본문 안 실림) · 단위 테스트 23 + eval 1 green · eval CI 에 한 단계
- [x] `npm run gateway` 가 `LITELLM_LICENSE` · 약한/예시 마스터 키 · 차 있는 포트를 거부
- [x] 관리자 '모델' 표 · 개요 게이트웨이 카드 · 데스크톱 대화 화면 · E2E 42 green (chat 6 · admin-models 6 · desktop API 출처 1) · `npm run dev` 가 게이트웨이·conductor 도 띄움
- [x] 로컬 Docker 스택 (ADR-0009): `infra/compose.yaml` 기본 LiteLLM · profile `trace` = Langfuse 묶음(한도 합 ~2.4 GiB) · `npm run stack[:trace|:down]` · `npm run dev` 가 Docker LiteLLM 을 쓰고 Docker 가 없으면 venv 로 · 회사 맥에서 확인
- [x] 집 윈도우에서 찾음: 관리 화면 `/ui` 마스터 키 로그인 = "Authentication Error, Not connected to DB!" (config-only) → 기본 스택에 LiteLLM 전용 Postgres(DB 모드, ADR-0009) · 회사 맥 scratch 확인: 첫 기동 ~10초(마이그레이션 213개) · 로그인 · `/model/new` 로 넣은 모델이 `/model_group/info` 에 provider 와 함께 · 재기동 뒤 유지 · reset 으로 정리
- [ ] 회사 맥: `.env` 의 Langfuse Cloud 줄을 `.env.example` 의 로컬 구역으로 (사람이 직접) → `npm run stack` 이 비밀값을 채움 → 데모 1~8
- [ ] 집 윈도우: Docker Desktop(WSL2 메모리 6 GB) → `npm run stack` 첫 실행(amd64 이미지) · `npm run stack:trace` 한 번 · `.env` 의 `LLM_GATEWAY_URL` 을 127.0.0.1 로 · 데모 1~8 · `git pull` 뒤 `npm run stack` → `/ui` 로그인 admin + 마스터 키 · Docker 를 끄고 `npm run dev` → venv 대체 안내 · 창 버튼과 대화 제목 줄 안 겹침(눈으로)
- [ ] 금요일 전 `uv` 로 OSV 재확인 (2026-10-21 게시 핀이 많음)

## 범위 밖
MCP 툴·결과 카드·Langfuse trace(slice 03) · 승인 카드·CI E2E(slice 04) · 모델 노출·이름·순서 편집 · `model_exposure` DB · virtual key(P2) · 모델 선택 메뉴(버튼만, disabled) · assistant-ui(slice 03)

## 함정
- **GHSA-w4c7-34wj-hqm8** (CVSS 10): 1.106.2 + Enterprise 라이선스 = 인증 없이 env(키) 유출 → `LITELLM_LICENSE` 절대 금지 · 127.0.0.1 바인드. **2026-11-03 부터 1.106.5**(수정판, 2026-10-27 게시) 로 cool-down 에서 올린다 — lock 다시 만들고 다이제스트 새로 적기 · `scripts/gateway.mjs` 의 `LITELLM_VERSION` 도
- `--only-binary :all:` 없이 sync 하면 해시가 틀려도 sdist·캐시 wheel 로 조용히 깔린다. 1.82.7 · 1.82.8 · 1.107.0 은 `constraints.txt` 로 막음
- `config.yaml` 은 ASCII 만 (윈도우 cp949 에서 한글 주석이 기동을 깬다) · 래퍼가 `PYTHONUTF8=1` + `PYTHONIOENCODING=utf-8`
- LiteLLM 이 레포 `.env` 를 스스로 찾는다 → `PYTHON_DOTENV_DISABLED=1`, `.env` 는 uv `--env-file` 로 한 번만. 다른 파일로 띄우기 = `BREWAI_ENV_FILE=<경로>`
- config-only 모드(venv): 키 없음 = 500 평문 · 틀린 키 = 400 `no_db_connection` (401 아님) → conductor 는 `gateway_auth_failed`. Docker 스택(DB 모드)은 틀린·없는 키 = 401
- 카탈로그 30초 캐시: 게이트웨이를 끈 직후 `/api/models` 는 그대로, 대화만 `gateway_unreachable`
- 윈도우 `localhost` → ::1 → 모든 기본값 127.0.0.1. 관리자는 `http://localhost:5174` 로 열어야 CORS 통과
- 래퍼만 `kill -9` 하면 uv·python 이 고아로 포트를 잡는다 → Ctrl+C 로 끈다
