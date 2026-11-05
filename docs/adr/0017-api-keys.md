# ADR-0017 · API 키 = conductor 가 발급하는 사람별 키 (`bwk_`) · 첫 표면은 OpenAI 호환

- 상태: 확정 · 2026-11-05 (사용자: 외부에서도 쓰게 · 첫 표면 = OpenAI 호환 · 사용자 각자 만들고 관리자가 켜고 끔 · 서버 배포 전제 · 한도는 관리자가 정하고 기본값은 적절히). 구현 = slice 12 (`docs/slices/12-api-keys.md`)
- 맥락: 키 관리가 없다. 스크립트 · CI · 다른 도구(Cursor · LangChain · curl)에서 BrewAI 의 모델 · 정책 · 사용량 기록을 그대로 쓰고 싶다. 게이트웨이(LiteLLM) 키는 conductor 밖으로 내보내지 않는다 (AGENTS.md 제품 경계).
- 결정
  - 키 = conductor 가 발급하는 불투명 토큰 `bwk_` + 32바이트 무작위 (tokens.py 와 같은 모양). DB 엔 sha256 만 · 화면엔 만들 때 한 번만 전체, 그 뒤엔 `bwk_abcd…wxyz` (앞 4 · 뒤 4).
  - 주인 = 사람 한 명 (그 사람 권한 이상은 못 한다) · 조직 하나에 묶임. 범위(scope) = `models:read` · `chat` · `usage:read` 중 골라서. 만료 기본 90일 · 최대 1년 · 없음 불가.
  - 받는 곳 = 외부 표면 `/v1/*` 만 (`/api/*` 데스크톱 · 관리자 표면은 `bwk_` 를 거절). `Authorization: Bearer bwk_…`.
  - 1단계 표면 = OpenAI 호환 `GET /v1/models` (노출 모델만) · `POST /v1/chat/completions` (스트림 포함 · 도구 · 스킬 · MCP · 팀 · 로컬 폴더 없음 = 모델 호출만). conductor → LiteLLM (서비스 키 · `user` = users.id · metadata key_id).
  - 2단계 = 에이전트 실행 API (`/v1/agent/runs`, AG-UI SSE) — 승인 카드(slice 10) 뒤. 쓰기 도구는 승인 없이는 안 돈다.
  - 한도 = 키마다 분당 요청 · 하루 토큰 · 월 추정 비용 (conductor 가 usage_events 로 셈 · 넘으면 429 `key_limit_*`). 기본값 = 관리자 정책 (처음 60/분 · 100만 토큰/일 · $20/월) · 관리자만 키마다 덮어씀 (사용자는 못 바꿈). 분당 창은 conductor 프로세스 메모리 (여러 대로 늘리면 공용 저장소로).
  - 사용량 = usage_events 에 `key_id` · `source` (app | api) → 사용량 '키별' 분류 · 관리자 '키' 표.
  - 관리 = 사용자: 데스크톱 설정 › API 키 (만들기 · 이름 · 범위 · 만료 · 폐기 · 마지막 사용). 관리자: 콘솔 › 사용자와 조직 › API 키 (전체 목록 · 강제 폐기 · 키마다 한도 · 정책: 허용 여부 · 기본 / 최대 기간 · 기본 한도 — 지금은 인스턴스 하나, 조직마다 다른 정책은 나중).
  - 감사 = 만들기 · 폐기 · 키 한도 바꾸기 · 정책 바꾸기를 audit_events 에 (키 값 · 해시는 안 남김, 앞 4 · 뒤 4 만). 한도 초과 · 거절 기록은 trace(slice 11) 때.
- 탈락: LiteLLM virtual key 를 사람에게 직접 (게이트웨이 노출 · 우리 정책 · 사용량 우회) · JWT 서명 키 (폐기가 즉시 안 됨) · 조직 공용 키만 (누가 썼는지 모름 → 2단계에서 '서비스 키' 따로 검토).
- 배포: 서버에 올릴 것을 전제로 /v1 은 같은 PC 제한이 없다 (데스크톱의 로컬 폴더와 다름). 올릴 때 = CONDUCTOR_PUBLIC_URL 을 그 도메인으로 (TrustedHost) · https · 분당 창을 공용 저장소로.
- 재검토: 2단계 에이전트 API · 서비스 키 · GitHub secret scanning 등록 · 여러 conductor.
