"""MCP 연결 = conductor 가 직접 (ADR-0002 · ADR-0013). '코어 4개' 중 ① 능력 찾기 · 설치 의 바닥. Pydantic AI import 없음 (agent.py 만).

  vault.py    인증정보 AES-GCM (키 = CONDUCTOR_SECRET_KEY · key_id 로 교체 · AAD = 누구 | 어느 주소 | 어느 issuer)
  ssrf.py     나가는 주소 검사 (https 만 · 사설 · link-local · 메타데이터 막기 · 풀어 본 IP 로만 접속 · 리다이렉트마다 다시)
  client.py   Streamable HTTP (공식 mcp SDK) — tools/list(페이지 · 캐시) · tools/call · 스키마 다듬기 · 결과 12KB · 이름 <handle>__<tool>
  oauth.py    OAuth 2.1 (RFC 9728 → 8414/OIDC → 사전 등록 > DCR · PKCE S256 · resource · iss · 만료 60초 전 refresh · scope 올리기)
  catalog.py  사람마다 보이는 서버 (전체 공통 + 내가 추가 + 가져옴) · 프롬프트 앱 목록 한 줄씩 (합계 900토큰)
  rank.py     need → 도구 순위 (BM25 + 한글 bigram · 이름 쪼개기 · 별칭 · 읽기 도구 먼저, 쓰기도 허용)
권한 판정 = auth/policy.py (McpServerFacts) · 표 = store.py v4. 토큰 값은 로그 · trace · 데스크톱 · 프롬프트에 0.
서버 설명 · 도구 설명 · 도구 결과는 데이터로만 다룬다 (공유 서버 = 프롬프트 주입 경로).

여기 __init__ 은 아무것도 import 하지 않는다 (store.py → scopes 와 순환 없이 하위 모듈을 따로 불러 쓴다).
"""
