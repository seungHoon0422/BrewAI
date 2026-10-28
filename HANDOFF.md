# HANDOFF — 두 PC 이어받기

> `/wrap` 이 갱신한다. 사람은 **📥 사용자 메모** 칸에만 쓴다. 다른 PC에서 시작하면 `/start`.

| 항목 | 내용 |
|---|---|
| 마지막 갱신 | 2026-10-29 · DESKTOP-GSJ7AIO (집/회사 미정) |
| 활성 브랜치 | main → origin `github.com/seungHoon0422/BrewAI` |
| Phase | P0 셋업 · 진행 중 (완료 기준 1/3) |
| 다음 할 일 | 1) 다른 PC: README "새 PC 처음 1회" → `/start` 3줄 확인 · 2) Node LTS 설치(두 PC) · 3) CI 더미 eval 1건 |
| 막힘 | 없음 |
| 결정 대기 | ① P1 모델 키: Anthropic / OpenAI / 회사 제공 · Node 설치 OK? ② Langfuse Cloud 리전: JP(추천) / EU ③ 이 PC(DESKTOP-GSJ7AIO) = 집/회사? |
| 확정 | 이름 **BrewAI** (SaaS 아님, 잘되면 오픈소스) · 웹+데스크톱(Electron) · 사용자 앱/관리자 콘솔 분리 · LLM GW = LiteLLM(모델은 게이트웨이에서만 등록) · trace = Langfuse · E2E = Playwright · UI 스펙 = `design/prototype.html` |

## 📥 사용자 메모
- (아이디어·요청을 한 줄씩. 다음 `/start` 때 처리하고 지운다)

## 🕘 최근 기록
- 2026-10-29 · DESKTOP-GSJ7AIO · 이름 BrewAI 확정 · GitHub 연결 · 첫 커밋
- 2026-10-29 · DESKTOP-GSJ7AIO · UI 프로토타입(design/prototype.html) + ADR 0004~0006
- 2026-10-28 · DESKTOP-GSJ7AIO · 킥오프: 리서치 워크플로, 레포 골격, ADR 3개, REPORT.html v1
