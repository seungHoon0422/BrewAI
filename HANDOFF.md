# HANDOFF — 두 PC 이어받기

> `/wrap` 이 갱신한다. 사람은 **📥 사용자 메모** 칸에만 쓴다. 다른 PC에서 시작하면 `/start`.

| 항목 | 내용 |
|---|---|
| 마지막 갱신 | 2026-10-29 · baegseunghun-ui-MacBookPro-2.local (회사) |
| 활성 브랜치 | main → origin `github.com/seungHoon0422/BrewAI` |
| Phase | P0 셋업 · 진행 중 (완료 기준 2/3 — 남은 것: P0-1 두 PC 확인) |
| 다음 할 일 | 1) 회사 맥: `~/Desktop/git/BrewAI` 에서 `bash scripts/setup-pc.sh` → `/start` → `/wrap` · 2) 집 윈도우: README 1단계(uv 0.13.5·Node 24.22.1·`uv python upgrade 3.13`) → `/start` 3줄 확인(P0-1) → `/wrap` · 3) ③ 답 → roadmap·ADR 개편 → `/report` → 금 P0 판정 → 월 `/slice` |
| 막힘 | 없음 |
| 결정 대기 | ① P1 모델 키: Anthropic / OpenAI / 회사 제공 ② Langfuse Cloud 리전: JP(추천) / EU ③ 로드맵 개편 OK? — P1 = 데스크톱(Electron) 관통 · 웹 = 랜딩+다운로드 · P0 은 기능이 없으니 Playwright 대신 증거(CI run·/start 3줄)로 판정 |
| 확정 | 이름 **BrewAI** (SaaS 아님, 잘되면 오픈소스) · **데스크톱(Electron) 먼저 — 웹은 당분간 랜딩 + 다운로드만** · 사용자 앱/관리자 콘솔 분리 · LLM GW = LiteLLM(모델은 게이트웨이에서만 등록) · trace = Langfuse · E2E = Playwright, **기능 개발이 끝난 시점에** 실행 · 집 = 윈도우, 회사 = 맥 · uv 0.13.5 · Node 24.22.1 · UI 스펙 = `design/prototype.html` |

## 📥 사용자 메모
- (아이디어·요청을 한 줄씩. 다음 `/start` 때 처리하고 지운다)

## 🕘 최근 기록
- 2026-10-29 · 회사 맥 · CI 더미 eval green([run](https://github.com/seungHoon0422/BrewAI/actions/runs/40821436200)) · 두 PC 안전장치(훅·/start·/wrap·/slice) · 결정: 집=윈도우·회사=맥, E2E=기능 완료 시점, 데스크톱 먼저
- 2026-10-29 · DESKTOP-GSJ7AIO · 이름 BrewAI 확정 · GitHub 연결 · 첫 커밋
- 2026-10-29 · DESKTOP-GSJ7AIO · UI 프로토타입(design/prototype.html) + ADR 0004~0006
- 2026-10-28 · DESKTOP-GSJ7AIO · 킥오프: 리서치 워크플로, 레포 골격, ADR 3개, REPORT.html v1
