# ADR-0004 · 표면: 웹 · 데스크톱(Electron) + 사용자 앱 / 관리자 콘솔 분리

- 상태: 제안 · 2026-10-28 · 만드는 순서는 ADR-0007(데스크톱 먼저) · **데스크톱 로그인은 ADR-0010 (시스템 브라우저 → loopback · 딥링크·테스트 토큰 주입 아님)**
- 맥락: 일반 사용자가 웹과 데스크톱 두 경로로 쓴다. 사용자 설정과 관리자 확인은 분리해야 한다. E2E는 Playwright 하나로 전부 검수.
- 결정

  | 앱 | 누가 | 무엇 | 기술 |
  |---|---|---|---|
  | `apps/web` | 방문자 | 지금은 랜딩 + 다운로드만. 사용자 웹 앱은 데스크톱 다음 (ADR-0007) | 정적 HTML |
  | `apps/desktop` | 사용자 | 채팅 · 팀 활동 패널 · 내 연결(OAuth) · 내 Skill · 개인 설정 + 트레이·딥링크 OAuth — **먼저 만든다** | **Electron** + Vite + React, shadcn/ui, assistant-ui, React Flow |
  | `apps/admin` | 관리자 | 모델 노출 · 카탈로그 등급/허용목록 · 사용자·예산 · Langfuse trace 링크 · 승인 감사 | 별도 SPA, 별도 배포·인증 |
  | `services/conductor` | — | API(사용자/관리자 라우트 분리) + 에이전트 런타임 | Python (ADR-0002) |

- 데스크톱 = 얇은 클라이언트: 백엔드 API만 호출. 게이트웨이·Langfuse 키를 앱에 넣지 않는다.
- Electron 이유: Chromium 내장(웹과 렌더링 동일) · Playwright `_electron` 으로 같은 스위트 실행 · Rust 불필요 · Codex 앱도 Electron.
  Tauri 탈락: Playwright 연결이 Windows CDP뿐(공식 근거 없음), macOS/Linux는 별도 WebDriver 스택.
- E2E: `e2e/` 에 `@playwright/test`(TypeScript), projects = `web` · `admin` · `desktop`. 공통 스펙은 surface fixture로 재사용.
  LLM 게이트웨이는 mock, Langfuse는 끔. 금요일 데모 스크립트 = Playwright 스펙.
- 리스크: `_electron` 은 아직 experimental → Playwright 버전 고정. E2E 빌드만 `nodeCliInspect` fuse 허용(프로덕션은 끔).
  데스크톱 OAuth는 시스템 브라우저라 Playwright가 못 누름 → 테스트 전용 토큰 주입(프로덕션 비활성). Windows 코드서명 필요(SmartScreen).
