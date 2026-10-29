# HANDOFF — 두 PC 이어받기

> `/wrap` 이 갱신한다. 사람은 **📥 사용자 메모** 칸에만 쓴다. 다른 PC에서 시작하면 `/start`.

| 항목 | 내용 |
|---|---|
| 마지막 갱신 | 2026-10-29 · baegseunghun-ui-MacBookPro-2.local (회사) |
| 활성 브랜치 | `develop` (모든 작업을 여기로 · slice 브랜치 안 씀) → origin `github.com/seungHoon0422/BrewAI` |
| Phase | P0 셋업 2/3 (남은 것: P0-1 두 PC 확인) · P1 slice 01 메뉴 골격 + 문서(보드·아키텍처) · slice 02 모델 연동 — 맥에서 LiteLLM mock → conductor → 데스크톱 대화 답 · 관리자 모델 목록 동작, E2E 45/45 · pytest 26 · 다음 = 로컬 Docker 스택(ADR-0009) |
| 다음 할 일 | 1) 회사 맥: `~/Desktop/git/BrewAI` 에서 `bash scripts/setup-pc.sh` → `/start`(→ slice/01) → README 4단계(`npm ci` …) → `/wrap` · 2) 집 윈도우: README 1·4단계 → `/start` 3줄 확인(P0-1) → `npm run e2e` → `npm run desktop` 으로 창 버튼·다크 눈 확인 → `/wrap` · 3) 금: P0 판정(증거) + slice 01 데모 → squash-merge → `/report` → 월 `/slice` = 02 대화 관통 |
| 👤 내가 할 일 | ① 집 윈도우: `git fetch` → `git switch slice/02-model-gateway` → `npm ci` → `uv sync` ② 집 윈도우: `.env` 의 `LITELLM_MASTER_KEY` 를 예시 말고 긴 임의 값으로 · `LLM_GATEWAY_URL=http://127.0.0.1:4000` (README 게이트웨이 설치 1회) ③ 집 윈도우: `start.cmd` → 데스크톱에서 질문 → mock 답이 오는지 · 창 버튼 · 다크 모드 눈 확인 ④ 집 윈도우: `npm.cmd run e2e` → 45 passed ⑤ 집 윈도우: Claude Code `/start` 3줄 → `/wrap` (P0-1) |
| 막힘 | 없음 |
| 결정 대기 | 없음 |
| 확정 | 이름 **BrewAI** (SaaS 아님, 잘되면 오픈소스) · **데스크톱(Electron) 먼저 — 웹은 당분간 랜딩 + 다운로드만** · 메뉴 골격 → 하나씩 구현 · 관리자 콘솔 '문서' 메뉴 · 다음 = 모델 연동, 모델은 LiteLLM 에서만 등록(config.yaml · 관리 화면) → 우리는 가져와서 노출 · 이름 · 순서 · provider 관리 (ADR-0008 · 0009) · 관리자 콘솔 골격 같이 (ADR-0007) · P0 은 증거로 판정 · 사용자 앱/관리자 콘솔 분리 · LLM GW = LiteLLM(모델은 게이트웨이에서만 등록) · trace = Langfuse (로컬 Docker self-host, Cloud 안 씀 · Compose: 기본 LiteLLM, trace 때 Langfuse 묶음) · E2E = Playwright, **기능 개발이 끝난 시점에** 실행 · 집 = 윈도우, 회사 = 맥 · uv 0.13.5 · Node 24.22.1 · UI 스펙 = `design/prototype.html` |

## 📥 사용자 메모
- (아이디어·요청을 한 줄씩. 다음 `/start` 때 처리하고 지운다)

## 🕘 최근 기록
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
