# ADR-0013 · MCP 서버 = conductor 가 직접 연결 · 인증은 사용자마다 · 도구는 필요할 때만 꺼낸다

- 상태: 확정 · 2026-11-01 (사용자: 조직 공유 = owner·admin 만 · 쓰기 도구 지금 바로 허용 · 공유·가져오기 05 포함)
- 맥락: 사용자: "관리자랑 사용자가 동시에 MCP 서버를 추가" · "인증정보는 사용자 레벨, 이미 인증한 서버는 자동으로" · "모든 서버목록을 다 던지면 토큰이 너무 많이". 서버 10개 × 도구 15개를 매번 보내면 요청마다 약 10만 토큰.
- 결정
  - 연결: conductor 가 MCP 클라이언트(ADR-0002). 새 의존성 `mcp==2.3.0`(2026-10-02, 공식 SDK) + 직접 고정 `cryptography==50.0.2`(2026-09-30) · Streamable HTTP 만. 연결 코드 = `conductor/connectors/` · pydantic_ai 는 여전히 `agent.py` 한 파일.
  - 범위: `mcp_servers` + `mcp_server_shares(scope_kind install|org|space, auto_include)`. 관리자 추가 = install + auto_include = **지금은 전체 공통**. 조직 · 스페이스 한정은 나중에 share 줄만 더한다(스키마 그대로 · scope_kind = `scopes.LEVELS`). 사용자 추가 = 본인만 → 스페이스 · 조직에 공유하면 멤버가 [가져오기] 후 **자기 계정으로** 로그인. 공유되는 건 서버 정의뿐, 인증정보는 절대 안 나눈다. 판정 = `auth/policy.py`.
  - 인증정보: `mcp_credentials(user_id, resource)` = 같은 서버 주소면 로그인 한 번으로 모든 항목 · 대화가 자동으로 쓴다. AES-GCM(키 = `.env` `CONDUCTOR_SECRET_KEY`, stack.mjs 생성 · key_id 로 교체) · 만료 60초 전 조용히 refresh. 토큰은 데스크톱 · 로그 · trace 에 0. OAuth 2.1 + PKCE + `resource`(RFC 8707) + `iss` 검사(RFC 9207) · 데스크톱 복귀 = ADR-0010 loopback handoff 그대로. 클라이언트 등록 = 사전 등록 > DCR (CIMD 는 공개 https 주소 뒤). issuer 비교 = 글자 그대로(RFC 8414 §3.3), 의도적 예외 하나 = 경로 없는 issuer 의 끝 '/' 차이(같은 scheme · host 만 · 저장 · `iss` 검사는 메타데이터의 issuer 값 · Box 메타데이터에서 발견, 지금 이 예외가 필요한 추천 서버는 없음 = `oauth.same_issuer`).
  - 토큰 다이어트 (2026-11-01 개정): 프롬프트엔 바로 쓸 수 있는 앱의 handle 한 줄(설명 없음 · 300 상한) + 메타 도구 하나 `use_app(app?, need)`(search_tools 를 합침 · app 을 비우면 서버가 검색). MCP 도구는 공개 전엔 목록에 없다(defer_loading 안 씀 = 자동 search_tools · 공개 알림 system 글 없음) → `use_app` 이 서버에서(LLM 없이) 4개만 꺼내 그 대화에 고정(`ToolReturn.tools` · 도구 배열 맨 뒤). 결과 8KB(이번 턴) · 지난 턴은 앞부분 + '줄임' · Claude 는 LiteLLM cache_control (캐시는 한 턴의 도구 루프 안이 주 · 공개 · '줄임'이 앞부분을 바꾼다). hello = 1,389 → 223 토큰 · 큰 결과 다음 턴 9,937 → 1,089 (slice 05 '토큰').
  - 자동 인증 알림: `users.mcp_auto_auth` = unset(기본, 꺼짐으로 셈) | on | off. unset = 처음 한 번 묻는 카드 → 승인 = on(다음부턴 묻지 않고 바로 로그인 화면) · 거절 = off(설정에서 직접 연결). 연결 없음 = deferred 호출로 실행을 멈추고, 연결 뒤 같은 대화에서 서버가 다시 계산해 잇는다(UI 는 권한 근거 아님). 자동 열기 = 실행당 1번 · 시간당 3번 · 내 목록에 있는 서버만.
  - 쓰기 도구: **지금 바로 허용**(사용자 결정). 도구 카드에 쓰기 표시만 · 승인 카드(slice 07)가 생기면 관리자 도구별 '승인 필요' 로 옮긴다. 조직 공유 = 조직 owner·admin 만, 스페이스 공유 = 그 스페이스 멤버.
- 탈락: 모든 도구를 매번 보내기(10만+ 토큰 · 서버 50개면 컨텍스트 초과) · `pydantic-ai-slim[mcp]`(fastmcp 트리 · 최신이 7일 안 됨) · 데스크톱이 토큰 보관 · 기본 `search_tools` 그대로(`[a-z0-9]+` 라 한글 무시) · 사용자끼리 인증 공유(남의 계정으로 실행) · authlib · keyring · 시작 때 첫 요청 하나에 모든 서버 도구 미리 싣기.
- 주의: `CONDUCTOR_SECRET_KEY` = 첫 서버 쪽 비밀. 잃으면 모두 다시 연결 · DB 와 같이 새면 전원 토큰 노출. 서버 설명 · 도구 설명은 데이터로만 다룬다(공유 서버 = 프롬프트 주입 경로).
- 재검토: 앱 목록이 300토큰을 넘을 만큼 많아질 때(임베딩 검색) · P3 레지스트리 설치 · MCP 게이트웨이(agentgateway) 도입 · 키 관리를 KMS 로 옮길 때.
