# ADR-0017 · API 키 = conductor 가 발급하는 사람별 키 (`bwk_`) · 첫 표면은 OpenAI 호환

- 상태: 제안 · 2026-11-05 (사용자: 외부에서도 쓰게 키 관리 설계 · 첫 표면 = OpenAI 호환). 구현 = slice 12 (`docs/slices/12-api-keys.md`)
- 맥락: 키 관리가 없다. 스크립트 · CI · 다른 도구(Cursor · LangChain · curl)에서 BrewAI 의 모델 · 정책 · 사용량 기록을 그대로 쓰고 싶다. 게이트웨이(LiteLLM) 키는 conductor 밖으로 내보내지 않는다 (AGENTS.md 제품 경계).
- 결정
  - 키 = conductor 가 발급하는 불투명 토큰 `bwk_` + 32바이트 무작위 (tokens.py 와 같은 모양). DB 엔 sha256 만 · 화면엔 만들 때 한 번만 전체, 그 뒤엔 `bwk_abcd…wxyz` (앞 4 · 뒤 4).
  - 주인 = 사람 한 명 (그 사람 권한 이상은 못 한다) · 조직 하나에 묶임. 범위(scope) = `models:read` · `chat` · `usage:read` 중 골라서. 만료 기본 90일 · 최대 1년 · 없음 불가.
  - 받는 곳 = 외부 표면 `/v1/*` 만 (`/api/*` 데스크톱 · 관리자 표면은 `bwk_` 를 거절). `Authorization: Bearer bwk_…`.
  - 1단계 표면 = OpenAI 호환 `GET /v1/models` (노출 모델만) · `POST /v1/chat/completions` (스트림 포함 · 도구 · 스킬 · MCP · 팀 · 로컬 폴더 없음 = 모델 호출만). conductor → LiteLLM (서비스 키 · `user` = users.id · metadata key_id).
  - 2단계 = 에이전트 실행 API (`/v1/agent/runs`, AG-UI SSE) — 승인 카드(slice 10) 뒤. 쓰기 도구는 승인 없이는 안 돈다.
  - 한도 = 키마다 분당 요청 · 하루 토큰 · 월 추정 비용 (conductor 가 usage_events 로 셈 · 넘으면 429 `key_limit`). 조직 정책이 상한.
  - 사용량 = usage_events 에 `key_id` · `source` (app | api) → 사용량 '키별' 분류 · 관리자 '키' 표.
  - 관리 = 사용자: 데스크톱 설정 › API 키 (만들기 · 이름 · 범위 · 만료 · 폐기 · 마지막 사용). 관리자: 콘솔 › 사용자와 조직 › 키 (전체 목록 · 강제 폐기 · 조직 정책: 허용 여부 · 최대 기간 · 기본 한도).
  - 감사 = 만들기 · 폐기 · 한도 초과 · 거절을 audit_events 에 (키 값 · 해시는 안 남김, 앞 4 · 뒤 4 만).
- 탈락: LiteLLM virtual key 를 사람에게 직접 (게이트웨이 노출 · 우리 정책 · 사용량 우회) · JWT 서명 키 (폐기가 즉시 안 됨) · 조직 공용 키만 (누가 썼는지 모름 → 2단계에서 '서비스 키' 따로 검토).
- 재검토: conductor 를 PC 밖(서버)에 둘 때 (지금은 127.0.0.1 = 같은 PC 스크립트만) · 2단계 에이전트 API · 서비스 키 · GitHub secret scanning 등록.
