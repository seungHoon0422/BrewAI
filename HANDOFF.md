# HANDOFF — 두 PC 이어받기

> `/wrap` 이 갱신한다. 사람은 **📥 사용자 메모** 칸에만 쓴다. 다른 PC에서 시작하면 `/start`.

| 항목 | 내용 |
|---|---|
| 마지막 갱신 | 2026-10-30 · baegseunghun-ui-MacBookPro-2.local (회사) |
| 활성 브랜치 | `develop` (모든 작업을 여기로 · slice 브랜치 안 씀) → origin `github.com/seungHoon0422/BrewAI` |
| Phase | P0 셋업 2/3 (남은 것: P0-1 두 PC 확인) · P1 진행 중 — 메뉴 골격 · 문서 · 모델 연동 · 대화(멀티턴 · 추론 · 도구 5개 · 스킬 5개 · 진행 표시 · 모델 선택) · 모델 관리(LiteLLM 동기화 60초 + 수동 · 노출 · 이름 · 순서 · 기본 · 연결 시험) · 생각 표시 글라스 상태 줄 + 모델 메뉴·관리자 모델 화면 개편 · 로그인 · 조직 · 스페이스 · 프로젝트(slice 03 · 04 구현) · 공용 UI `packages/ui`(ADR-0012) — 맥 E2E 199/199 · pytest 470 · MCP 연결(slice 05) 구현 + 실제 서버 추천 목록 · 다음 = 에이전트 팀 (slice 06) |
| 다음 할 일 | 1) 회사 맥: `~/Desktop/git/BrewAI` 에서 `bash scripts/setup-pc.sh` → `/start`(→ slice/01) → README 4단계(`npm ci` …) → `/wrap` · 2) 집 윈도우: README 1·4단계 → `/start` 3줄 확인(P0-1) → `npm run e2e` → `npm run desktop` 으로 창 버튼·다크 눈 확인 → `/wrap` · 3) 금: P0 판정(증거) + slice 01 데모 → squash-merge → `/report` → 월 `/slice` = 02 대화 관통 |
| 👤 내가 할 일 | ① 아무 PC: `./run.sh`(맥 · = pull → npm ci(필요할 때만) → uv sync → dev) 또는 `start.cmd`(윈도우) → 로그인 `admin` / `admin`(테스트 단계 · 내 PC 에서만) ② 데스크톱: 스페이스 전환 · 새 프로젝트(지침) · 프로젝트 안 대화 · 설정 › 계정 닉네임 ③ 관리자 콘솔(같은 계정) › 사용자·조직: 초대 코드 만들기 → 데스크톱 '초대 코드가 있어요' 로 두 번째 계정 가입 ④ 관리자 › 모델: 표(노출·기본·연결 맨 오른쪽 · 줄마다 [테스트]) · 줄 누르면 상세 페이지 `#/models/<모델>` 확인 ⑤ Google 로그인은 Google Cloud OAuth 클라이언트(Web, redirect 2개 — `docs/slices/03-login.md`)를 만들어 `.env` `GOOGLE_CLIENT_ID/SECRET` 에 넣을 때 버튼이 생김 ⑥ 게이트웨이 서버(ADR-0014): README '게이트웨이 서버' 1~5단계(Oracle 가입 → A1 서버 → 80/443 열기 → bootstrap → 배포 키) → GitHub › Environments 'gateway'(develop 만) 에 DEPLOY_HOST · DEPLOY_USER · DEPLOY_SSH_KEY · DEPLOY_KNOWN_HOSTS → 두 PC `.env` 의 LLM_GATEWAY_URL · LITELLM_MASTER_KEY 를 서버 값으로 → /ui 에 모델 다시 등록 ⑦ 피드백은 📥 사용자 메모에 |
| 막힘 | 없음 |
| 결정 대기 | 없음 |
| 확정 | 게이트웨이 서버(ADR-0014): Oracle 무료 VM 1대 + 공개 https(sslip.io) · Tailscale, Cloud Run 안 씀 · MCP(ADR-0013): conductor 가 직접 연결 · 인증은 사용자마다 · 도구는 필요할 때만(use_app) · 자동 인증 알림 기본 꺼짐 · 조직 공유 owner·admin · 쓰기 도구 바로 허용 · 로드맵 05 MCP → 06 에이전트 팀 → 07 승인 → 08 trace · 로그인 · 조직 (2026-10-30): 조직 > 스페이스 > 프로젝트 > 대화 · 가입 = 초대 코드 + 조직별 Google 도메인 · 로그인 ID = 이메일 + 닉네임 · 비밀번호 15자 · 로그인(slice 03·04) 먼저 (ADR-0010 · 0011) · 이름 **BrewAI** (SaaS 아님, 잘되면 오픈소스) · **데스크톱(Electron) 먼저 — 웹은 당분간 랜딩 + 다운로드만** · 메뉴 골격 → 하나씩 구현 · 관리자 콘솔 '문서' 메뉴 · 다음 = 모델 연동, 모델은 LiteLLM 에서만 등록(config.yaml · 관리 화면) → 우리는 가져와서 노출 · 이름 · 순서 · provider 관리 (ADR-0008 · 0009) · 관리자 콘솔 골격 같이 (ADR-0007) · P0 은 증거로 판정 · 사용자 앱/관리자 콘솔 분리 · LLM GW = LiteLLM(모델은 게이트웨이에서만 등록) · trace = Langfuse (로컬 Docker self-host, Cloud 안 씀 · Compose: 기본 LiteLLM, trace 때 Langfuse 묶음) · E2E = Playwright, **기능 개발이 끝난 시점에** 실행 · 집 = 윈도우, 회사 = 맥 · uv 0.13.5 · Node 24.22.1 · UI 스펙 = `design/prototype.html` · 생각 깊이 보통 = LiteLLM effort medium (low 면 Claude 가 생각을 자주 건너뜀) · 깊게 = high |

## 📥 사용자 메모
- (아이디어·요청을 한 줄씩. 다음 `/start` 때 처리하고 지운다)

## 🕘 최근 기록
- 2026-11-01 · 회사 맥 · 게이트웨이 서버 배포 준비(ADR-0014): infra/deploy(LiteLLM + DB + Caddy https, sslip.io 주소) · bootstrap/backup/deploy 스크립트 · deploy-gateway.yml · 공개 경로는 4개만, 관리 화면은 /brewai-admin 비밀번호 → 쿠키 · dev-all 은 원격 주소면 로컬 게이트웨이 안 띄움 · 로컬 Docker 로 같은 구성 확인 · pytest 471
- 2026-11-01 · 회사 맥 · 실제 MCP 서버 70개 조사 → 추천 서버 목록(관리자 · 데스크톱 추가 창) · 바로 쓰는 54개(로그인 없음 18 = 대화에서 실제 호출 확인, OAuth 36 = 로그인 주소까지 확인) · 16개는 사유와 함께 막음(사전 등록 앱 필요, API 키만 등) · 실서버 호환 수정(issuer 끝 /, Google 401 → 로그인 전환, 결과 크기 상한) · 결과표 = docs/slices/05-mcp.md · E2E 199
- 2026-11-01 · 회사 맥 · MCP 연결(slice 05): 관리자 공통 서버 + 사용자 서버(조직 · 스페이스 공유 → 가져오기) · 사용자별 OAuth(암호화 저장, CONDUCTOR_SECRET_KEY) · 자동 인증 알림(기본 꺼짐, 한 번 승인하면 바로 로그인 창) · use_app 으로 필요할 때만 도구 4개 이하 — 실측 서버 10개 전부 17,866 → 845 토큰(-95%) · 쓰기 도구는 실행 전 카드 확인 · 실제 OAuth 제공자는 아직 미확인(mock) · E2E 197
- 2026-11-01 · 회사 맥 · 개요 Top 5(조직 · 사용자 · 모델 · 스페이스) + 상세보기 → 사용량 메뉴 바로 열기 · 비용 분해(토큰 종류별 · 모델별) · 호출 추이 작게 · 캐시 읽기/쓰기 토큰 기록 + 캐시 가격 · 모델 상세 사용량(캐시 적중률 · 종류별 비용) · 캐시 적중률 = 캐시 읽기 ÷ 입력(캐시 포함) · E2E 172
- 2026-11-01 · 회사 맥 · 도구 병렬 실행(최대 4개 · 20초 제한 · '동시에 N개' 묶음) · 시작 문구 누르면 바로 전송 + 도구 시험 문구 · 첫 전송 전환 효과 · 사용량 기록(usage_events) · 관리자 사용량 메뉴 · 사용자/조직/스페이스 상세 사용량 · 운영자 개요(그래프) · E2E 169
- 2026-11-01 · 회사 맥 · 공통 Select(`packages/ui`) · 관리자 표 왼쪽 정렬 + 전체 순서 1..N(기본 모델도 그 자리) · 데스크톱 모델 메뉴 최소화 · 대화 마크다운(`marked` 18.1.1, 스트리밍 중 원문 안 보임) · 부드러운 스트리밍 · 생각/도구 블록 구분 · UI 문구 가운뎃점 금지(AGENTS.md + `e2e/copy-rule.ts`) · E2E 155
- 2026-10-31 · 회사 맥 · 관리자 모델: 상태 칸 삭제 · 노출/기본/연결 오른쪽 · 줄마다 연결 [테스트](응답 시간 · 실패 원인) · 모델 상세 = 전용 페이지(서랍 삭제) · E2E 137
- 2026-10-30 · 회사 맥 · 테스트 관리자 admin/admin · `./run.sh` 한 번에 실행 · 관리자 모델 표 개편(제공사 칸 · 드롭다운 · 입력/출력 비용 · 기능 아이콘 · 목록/추가 탭) · 사용자 표 '로그인 방법' · 사이드바 문구 삭제
- 2026-10-30 · 회사 맥 · 구현: 로그인(이메일+비밀번호 · Google · 세션 회전) · 조직 · 스페이스 · 프로젝트 · 초대 · 닉네임 · 관리자 사용자·조직 + 공용 UI `packages/ui`(토큰 · 부품 · UI 키트 `#/ui`) · 계층은 `scopes.py` 한 곳 (ADR-0012) · E2E 134 · pytest 336
- 2026-10-30 · 회사 맥 · 설계: 로그인(이메일+비밀번호 · Google) · 조직 · 스페이스 — ADR-0010 · ADR-0011 · `docs/slices/03-login.md` · `04-orgs-spaces.md` · roadmap P1-6 · P1-7 (옛 slice 03·04 → 05·06)
- 2026-10-30 · 회사 맥 · 생각 표시 = 글라스 상태 줄(상황·도구별 문구, 누르면 생각 내용·도구 카드) · 생각 안 하면 '생각 없이 바로 답함' · 데스크톱 모델 메뉴(검색 · 능력 · 상세 · 이름 겹침 구분 · 실패 경고) · 관리자 모델(요약 카드 · 필터 · 일괄 · 상세 패널 · 모두 시험 · 출처)
- 2026-10-29 · 회사 맥 · 대화: 멀티턴(SQLite) · 추론 표시 · 도구 2개(시각 · 계산) · 진행 상황 · 모델 선택(provider별 · 아이콘) / 모델 관리: LiteLLM 등록 → 동기화(60초 + 버튼) → 노출 · 이름 · 순서 · 기본 · 후보
- 2026-10-29 · 집 윈도우 · `npm run dev` 로 Docker LiteLLM + conductor + 데스크톱 + 관리자 동작 확인 · 고침: docker.exe 위치 · .env 경로 · LiteLLM DB 모드(관리 화면 로그인)
- 2026-10-29 · 회사 맥 · 로컬 Docker 스택(ADR-0009): `npm run stack` = LiteLLM 만 · `stack:trace` = + Langfuse 4.67 묶음(메모리 상한 2.4GB) · `npm run dev` 가 Docker 우선, 없으면 venv · 브랜치는 develop 하나로
- 2026-10-29 · 회사 맥 · slice 02 모델 연동: LiteLLM 1.106.2(해시 고정 venv) · conductor(FastAPI + Pydantic AI, AG-UI SSE) · 데스크톱 대화 · 관리자 모델 목록 · 아키텍처 아이콘 그림 · 결정: 로컬 Docker(Compose), 쿠버네티스는 P2 검토
- 2026-10-29 · 회사 맥 · 문서 › 보드(칸반 카드 · 상세 · 👤 내가 할 일 / ❓ 컨펌 필요) · 한 번에 실행 `npm run dev` · `start.cmd` · `start.command`
- 2026-10-29 · 회사 맥 · 관리자 콘솔 '문서' 메뉴(진행 현황 · 아키텍처 · 구성 · 결정 기록 · 보고서, 레포 파일에서 읽음) · ADR-0008 · roadmap slice 02~04 재배치
- 2026-10-29 · 회사 맥 · slice 01 메뉴 골격: 데스크톱 6 · 관리자 7 · 랜딩 + Playwright 17건(보안 기본값 포함) green · CI `app` 추가
- 2026-10-29 · 회사 맥 · CI 더미 eval green([run](https://github.com/seungHoon0422/BrewAI/actions/runs/40821436200)) · 두 PC 안전장치(훅·/start·/wrap·/slice) · 결정: 집=윈도우·회사=맥, E2E=기능 완료 시점, 데스크톱 먼저
- 2026-10-29 · DESKTOP-GSJ7AIO · 이름 BrewAI 확정 · GitHub 연결 · 첫 커밋
- 2026-10-29 · DESKTOP-GSJ7AIO · UI 프로토타입(design/prototype.html) + ADR 0004~0006
- 2026-10-28 · DESKTOP-GSJ7AIO · 킥오프: 리서치 워크플로, 레포 골격, ADR 3개, REPORT.html v1
