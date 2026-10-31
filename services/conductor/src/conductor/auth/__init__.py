"""로그인 · 세션 · 조직 · 스페이스 · 권한 (ADR-0010 · 0011). '코어 4개' 밖의 얇은 접착층 — 암호 · 서명은 직접 안 만든다.

  tokens.py     불투명 토큰 · 해시 · PKCE S256 · 초대 코드
  passwords.py  argon2id (명시 매개변수)
  accounts.py   사용자 · 로그인 수단 · 세션 · 1회용 토큰 · 시도 제한 · 감사 기록
  directory.py  조직 · 스페이스 · 프로젝트 · 초대 · 계정 만들기 · 첫 관리자
  google.py     Google OIDC (code 교환 · claim 검사)
  policy.py     권한 판정 한 곳 (기본 거부 · 404 숨김 / 403 · MCP 서버 추가 · 공유 · 가져오기 · 쓰기 포함)
  guard.py      id → 사실 → 판정 → 줄 (경로가 자원을 꺼내는 유일한 길)
  http.py       FastAPI 의존성 (Bearer · 관리자 쿠키 + CSRF)
범위 계층(층 순서 · 부모 칸) = conductor/scopes.py. 경로(라우트)는 conductor/api_auth.py · api_spaces.py · api_admin.py · app.py.
"""
