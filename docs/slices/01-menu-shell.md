# slice 01 · 메뉴 골격 (데스크톱 · 관리자 · 랜딩)

- 목표: 메뉴마다 화면이 열리는 데스크톱 앱 · 관리자 콘솔 · 랜딩을 두 PC에서 띄운다 (ADR-0007).
- 연결된 exit criteria: **P1-5**
- 시작: 2026-10-29 (목) — 사용자 OK 로 `/slice` 인터뷰 없이 시작. P0 판정은 금요일 그대로.

## 데모 스크립트 (금요일 그대로)
1. `npm ci` → `npm run e2e` → desktop · admin · web 전부 green
2. `npm run desktop` → 레일 6개 메뉴를 차례로 눌러 화면 확인 (맥 신호등·윈도우 창 버튼과 안 겹침)
3. `npm run admin` → 8개 메뉴 확인 (문서에서 진행 현황 · 아키텍처) · 랜딩 `apps/web/index.html` 에서 이 PC 버튼이 앞

## 메뉴
| 앱 | 메뉴 (주소) |
|---|---|
| 데스크톱 | 대화 `#/chat` · 진행 상황 `#/activity` · 예약 작업 `#/scheduled` · 스킬 `#/skills` · 연결된 앱 `#/connections` · 설정 `#/settings` |
| 관리자 | 개요 · 모델 · 카탈로그 · 승인 기록 · 트레이스 · 사용자·예산 · 문서 `#/docs` · 설정 (ADR-0008) |

프로토타입 레일 맨 아래 '더 보기' 자리는 '설정'으로 바꿨다.

## done
- [x] 데스크톱: 6개 메뉴 화면 + 보안 기본값(app:// · CSP · sandbox · 원격 차단)을 E2E 로 확인
- [x] 관리자: 8개 메뉴 화면(문서 = 진행 현황 · 아키텍처 · 구성 · 결정 기록 · 보고서) · 폰 폭에서 가로 스크롤 없음
- [x] 랜딩: OS별 다운로드 버튼 (설치본 전엔 비활성)
- [ ] 집 윈도우에서 `npm ci` · `npm run e2e` green
- [ ] 버전 고정 · `package-lock.json` · 7일 규칙 · CI(app) green

## 범위 밖
대화 연결(slice 02) · 승인 카드·CI E2E(slice 03) · 설치본·호스팅(P2) · 로그인 · 실제 모델 목록

## 함정
- `file://` 대신 `app://` — ES 모듈·CSP·경로 이탈 차단
- 윈도우 `titleBarOverlay` 오른쪽 여백 · 다크/라이트 색 맞춤 (집 PC에서 눈으로 확인)
- `_electron` 은 experimental → Playwright 정확히 고정. `npm ci` 는 나이 검사를 안 하므로 lock 은 `min-release-age=7` 로 만든다
- E2E 는 진짜 사용자 데이터 폴더(BrewAI)로 뜬다 → 앱이 상태를 저장하기 시작하면 임시 폴더로 띄운다
- 맥: E2E 에서 마이크·카메라(getUserMedia) 부르지 않기 — 앱이 막아도 OS 권한 팝업이 먼저 뜬다
