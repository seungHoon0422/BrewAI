# ADR-0012 · 공용 UI = `packages/ui` (토큰 + 부품) · 기능 폴더 · 계층은 층마다 한 모듈

- 상태: 확정 · 2026-10-30 (사용자: "채팅 · 모델 관리 톤앤매너 통일" · "UI/UX 갈아엎을 때 빠르게" · "구조(계층)가 바뀔 수 있다")
- 맥락: 두 앱이 토큰을 각자 복사했고(관리자 굵기 650 · 선 진함 · 색 바탕 배지 · 초록 스위치 vs 데스크톱 600 · 옅은 선 · 단색 · 유리) 같은 아이콘 이름이 다른 모양이었다. 다시 그리면 두 곳 · 수십 클래스를 고쳐야 한다.
- 결정
  - `packages/ui` (`@brewai/ui`, 로컬 워크스페이스 · 레지스트리 의존성 0 · 빌드 없음 = Vite 가 소스를 읽음): `tokens.css` · `base.css` · 부품(그리기만, prop in · event out, 데이터 요청 없음) · 아이콘 · ProviderIcon. 클래스 = `ui-*` · 변형 = `data-variant|size|tone|state` · 불리언 = `data-x` 있음/없음.
  - 시각 언어 하나 (prototype 값): 회색 틀 위 흰 면 · 강조 = 잉크(`--accent`) · **색은 상태에만**(점 · 옅은 배지, 색 테두리 · 색 띠 없음) · 굵기 400/500/600 · 상자 = 1px `--border` + `--radius-lg` · 그림자는 떠 있는 층만 · **유리 = 팝오버 · 메뉴 · 알림 · 살아 있는 상태 줄만**(대화상자 · 서랍 = 불투명 + `--shadow-lg`).
  - 기능 폴더: `src/features/<이름>/{api.ts, hooks.ts, components/, copy.ts, <이름>.css}`. api = fetch 만 · hooks = 상태 · components = 부품 조합 · copy = 그 기능 한국어 문구 전부.
  - 규칙: **기능 CSS 는 토큰만** (`#hex` · `rgba` · 임의 px 글자 크기 · 둥글기 · 그림자 금지 — 배치용 폭은 예외). 부품으로 되는 것은 부품을 쓴다.
  - 계층(조직 > 스페이스 > 프로젝트 …)은 층마다 한 곳: 서버 = `conductor/scopes.py`(계층 정의 · 경로 계산) + `auth/policy.py`(판정) · API 는 `path: [{kind, id, name}]` 을 준다 · 화면 = `packages/ui/src/scope.ts`(층 표 · 층 이름 · 아이콘 · 경로 규칙, 두 앱 공용 · 서버 표와 같은지 `test_scopes.py`) + 앱 `features/scope/`(문맥 · 훅). 기능 문구는 층 이름을 `KIND_LABEL` 로만 쓴다. 화면은 `Breadcrumb` 로 경로를 그대로 그린다. 층을 넣거나 이름을 바꾸면 = scopes.py + 마이그레이션 + scope.ts 만.
- 다시 그리는 순서: ① `tokens.css` 값 · 부품 CSS 만 고친다 → ② 관리자 콘솔 `#/ui`(개발 서버 전용, 빌드에서 빠짐)에서 라이트 · 다크 확인 → ③ 앱 화면은 손대지 않아도 따라온다. 화면 구성(배치)을 바꿀 때만 `features/*/components` 를 고친다.
- 옮기기: 끝 (2026-10-30). 옛 토큰 이름(`--bg` `--fg` `--line2` …) 별칭은 지웠다 — 새 CSS 는 `--surface*` `--text*` `--border*` 만. 기능 CSS 의 여백(padding · margin · gap) · 줄 높이도 토큰(`--space-*` · `--lh-*`) — 정렬용 폭만 예외.
- 미룸: shadcn/ui · Radix 도입(ADR-0005 의 셸 후보) — 지금 부품으로 모자랄 때 다시 본다 · 문서 화면(`docs/*`)의 전용 그림 CSS.
