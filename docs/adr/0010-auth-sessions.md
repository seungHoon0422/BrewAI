# ADR-0010 · 로그인 · 세션 = conductor 안에서 (이메일+비밀번호 · Google)

- 상태: 확정 · 2026-10-30 · **ADR-0004 의 데스크톱 OAuth 리스크 줄(딥링크 · 테스트 전용 토큰 주입)을 로그인에 한해 대체**
- 맥락: 사용자: "로그인부터 — id·password 도, Google 로그인도". 데스크톱엔 키를 못 넣는다(AGENTS). E2E 는 Docker 없이 돈다(ADR-0009).
- 결정
  - 위치: `services/conductor/src/conductor/auth/` = 테이블 · 토큰 발급·폐기 · 권한 판정만. 암호·서명은 직접 안 만든다 → 새 의존성 **`argon2-cffi==25.1.0` 1개**(해시 고정). '코어 4개' 밖의 얇은 접착층.
  - Google OIDC = 이미 있는 `httpx2` 로 code 교환 + claim 검사(iss · aud · exp · iat · nonce · email_verified · hd). 서명 검증(Authlib) 생략 = 서버가 token endpoint 에서 TLS 로 직접 받을 때 OIDC Core §3.1.3.7 이 허용. 다른 경로로 받게 되면 Authlib.
  - 토큰 = 불투명 32B + 접두사, DB 엔 sha256 만 (서명 키 · SESSION_SECRET 없음). 역할은 토큰에 안 넣고 요청마다 DB.

    | 표면 | 보관 | 수명 |
    |---|---|---|
    | 데스크톱 | access `bwa_` = main 메모리 · refresh `bwr_` = safeStorage 암호화 파일 · renderer 는 토큰을 못 봄 · refresh 는 쓸 때마다 회전, 재사용 = 세션 통째 폐기 (RFC 9700 §2.2.2) | 15분 · idle 30일 / 최대 90일 |
    | 관리자 콘솔 | HttpOnly · SameSite=Strict 쿠키(Vite proxy 로 같은 출처) + `X-CSRF-Token` + Sec-Fetch-Site | idle 30분 / 최대 8시간 |

  - Google: 'Web application' client · conductor 가 secret 으로 교환 → 데스크톱엔 127.0.0.1 임의 포트 loopback 으로 60초 1회용 handoff code(PKCE S256 에 묶음). 설정 › 계정 › Google 연결도 code 로 받아 앱이 로그인한 채 `POST /api/me/google/link/complete` (남이 보낸 시작 주소로는 안 붙는다 = 연결 CSRF). 딥링크(Google custom scheme 중단) · polling(피싱 경로) 안 씀. 키 없으면 버튼 숨김.
  - 비밀번호: argon2id m=19456 · t=2 · p=1 · 15~128자(`CONDUCTOR_PASSWORD_MIN`) · 조합 규칙 없음 · 실패 응답 하나 + 더미 해시 · 계정 지수 지연(하루 창) + IP 상한(50번 · 15분 창 · 관리자 Vite proxy 는 `xfwd`).
  - 첫 관리자: `stack.mjs` 가 `.env` 에 `BREWAI_ADMIN_EMAIL` + 무작위 `BREWAI_ADMIN_PASSWORD` → users 0명일 때만 시드. E2E 도 같은 길로 진짜 로그인 (서버 뒷문 0).
- 탈락: Keycloak · Zitadel · authentik · Logto 컨테이너(RAM 0.5~1.4 GiB + Postgres · E2E 에 Docker · 조직 모델 이중) · fastapi-users(maintenance mode) · JWT(즉시 폐기 어려움).
- 순서: 로그인 = slice 03 · 04 (사용자: "지금부터 로그인부터"). 옛 03 툴·trace → 05 · 04 승인 → 06.
- 재검토: SAML · SCIM · 고객사 IdP 요구 → Keycloak 을 OIDC issuer 로 (identities 키 = (issuer, sub) 라 그대로 붙음).
