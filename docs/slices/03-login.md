# slice 03 · 로그인 (이메일+비밀번호 · Google · 세션 · 내 스페이스)

- 목표: 데스크톱 · 관리자 콘솔 모두 로그인해야 쓴다. 이메일+비밀번호와 Google. 사용자마다 '내 스페이스'에 대화가 쌓인다 (ADR-0010 · ADR-0011).
- 연결된 exit criteria: **P1-6**
- 시작: 2026-10-30 (금) — 설계 문서만. 구현은 HANDOFF '결정 대기' 답을 받은 뒤 · 파일 10개 이상 → 계획 먼저 승인.

## 구성 한눈에 (자세히 = slice 04)
| 층 | 무엇 | 예 |
|---|---|---|
| 설치본 | conductor 1개 + SQLite · instance admin(설치 관리자) | 두 PC 는 DB 가 따로 = 계정도 따로 |
| 조직 | 사람 묶음. 항상 1개 이상, 1개면 UI 에서 숨김 | 첫 실행 때 '우리 팀' |
| 스페이스 | 작업공간. 내 스페이스(personal, 사용자마다 1개) + 공유(shared) | 이 slice 는 내 스페이스만 |
| 대화 · 실행 | 스페이스 안. 대화는 기본 '나만 보기' | 옛 대화 = 첫 관리자의 내 스페이스 |

## 로그인 방법
| 방법 | 데스크톱 | 관리자 콘솔 |
|---|---|---|
| 이메일(= 로그인 ID) + 비밀번호 | 로그인 게이트 → main 이 `POST /api/auth/login` | `POST /api/admin/auth/login` → 쿠키 |
| Google | 시스템 브라우저 → conductor 콜백 → 127.0.0.1 loopback handoff → `POST /api/auth/token` | `localhost:5174` proxy 콜백에서 바로 쿠키 |
| 첫 관리자 | `.env` `BREWAI_ADMIN_EMAIL`(dev@brewai.local) · `BREWAI_ADMIN_PASSWORD`(stack.mjs 가 무작위 24자) | 같은 계정 |

## 토큰 · 세션
| 종류 | 수명 | 어디에 |
|---|---|---|
| access `bwa_` | 15분 | 데스크톱 main 메모리 · renderer 는 못 봄 (webRequest 가 conductor 출처에만 헤더를 붙임) |
| refresh `bwr_` | idle 30일 · 최대 90일 · 쓸 때마다 회전 | safeStorage 로 암호화한 `userData/session.bin` · 이미 쓴 값이 오면 세션 통째 폐기 |
| 관리자 쿠키 `bwc_` | idle 30분 · 최대 8시간 | HttpOnly · SameSite=Strict · 운영(https) = Secure + `__Host-` · `X-CSRF-Token` + Sec-Fetch-Site |
| handoff `bwh_` | 60초 · 1회 | PKCE S256 에 묶음 |

DB 엔 sha256 만. `/api/*` = Bearer 만 · `/api/admin/*` = 쿠키만 (표면이 섞이면 401). 401 → refresh 1번 → 실패면 게이트(쓰던 글 유지). 비밀번호 변경 = 다른 세션 폐기 · 재설정 · 비활성화 = 전부 폐기.

## Google 로그인 (데스크톱)
| # | 누가 | 무엇 |
|---|---|---|
| 1 | main | verifier · ds 를 만들고 `127.0.0.1:0/cb` 1회용 리스너 (5분) |
| 2 | main | 시스템 브라우저로 `/api/auth/google/start?client=desktop&cc&port&ds` |
| 3 | conductor | state · nonce · PKCE 를 DB 에 + 바인딩 쿠키 → Google (openid email profile) |
| 4 | conductor | `/api/auth/google/callback`: state·쿠키 확인 → httpx2 로 code 교환 → claim 검사 → 사용자 결정(아래) |
| 5 | conductor | `302 http://127.0.0.1:{port}/cb?code&ds` (host 고정 · port 숫자만) |
| 6 | main | ds 확인 → 'BrewAI 로 돌아가세요' → handoff code + verifier 로 세션 → 창 포커스 |

Google 토큰은 데스크톱에 안 오고 서버에도 저장하지 않는다. 아래 2~4 는 `email_verified` 참일 때만.

| 순서 | Google 계정 → 사용자 | 결과 |
|---|---|---|
| 1 | identities(issuer, sub) 있음 | 그 사람 (이메일로 찾지 않음) |
| 2 | 유효한 초대 (이메일 지정이면 같아야) | 가입 (slice 04) |
| 3 | 같은 이메일 + Google 이 권위 (@gmail.com · hd 있음) | 자동 연결 + audit · 아니면 '비밀번호로 로그인 후 설정 › 계정에서 연결' |
| 4 | 조직 domain_auto · `hd` = google_hd | member 로 가입 (slice 04) |
| 5 | 그 밖 | '이 Google 계정은 아직 초대받지 않았어요' (계정 안 만듦) |

## 테이블 (SQLite v1 → v2 · 이 slice 에서 전부 만든다)
| 테이블 | 핵심 |
|---|---|
| users | uuid · email_norm UNIQUE · instance_role(admin\|user) · status · last_space_id |
| identities | provider(password\|google) · UNIQUE(issuer, subject) · argon2id 해시(password 만) · hd |
| sessions · refresh_tokens | client(desktop\|admin) · access_hash · idle/abs 만료 · revoked_at · family = session_id |
| one_time_tokens · login_attempts | handoff · reset · oauth_flow / 시도 제한 카운터 |
| orgs · org_members · spaces · space_members · invites · audit_events | 쓰는 건 slice 04 (두 번째 마이그레이션을 피하려고 지금 만든다) |
| threads · runs (+) | space_id · created_by · visibility / user_id · space_id · org_id |

## API
| 묶음 | 경로 | 인증 |
|---|---|---|
| 공개 | `GET /healthz` · `GET /api/auth/state`(needs_bootstrap · providers) · `POST /api/auth/login` · `/api/auth/token`(refresh · handoff) | 시도 제한 |
| 브라우저 | `GET /api/auth/google/start` · `/api/auth/google/callback` | oauth_flow + 바인딩 쿠키 |
| 사용자 | `POST /api/auth/logout` · `GET/PATCH /api/me` · Google 연결/해제 · 기존 `/api/chat` · `/api/threads` · `/api/runs` · `/api/models` · `/api/tools` · `/api/skills` | Bearer · 내 스페이스만 |
| 관리자 | `POST /api/admin/auth/login` · `/logout` · `GET /api/admin/auth/me` · 기존 `/api/admin/*` | 쿠키 + CSRF + instance admin |

## 화면 · 문구
| 어디 | 무엇 |
|---|---|
| 데스크톱 로그인 게이트 (셸보다 먼저) | 'BrewAI에 로그인' · [Google로 계속](키 있을 때만) · 이메일 · 비밀번호 · [로그인] · '초대 코드가 있어요 · 비밀번호를 잊었어요' · '서버 127.0.0.1:8787 ●연결됨' |
| 데스크톱 사이드바 아래 · 설정 › 계정 | 계정 칩(이름 ▾ 설정 › 계정 · 로그아웃) · 이름 · 이메일 · 로그인 방법(비밀번호 · Google 연결/해제, 마지막 방법은 해제 불가) |
| 관리자 콘솔 | 미로그인 = 전체 화면 로그인 · 헤더 '관리자 로그인 (P2)' → 계정 칩 |
| 틀림 · 없는 계정 · 비활성 | 이메일 또는 비밀번호가 맞지 않아요 |
| 429 · 서버 꺼짐 · 만료 | 잠시 후 다시 시도해 주세요 · n초 / 서버에 연결할 수 없어요 [다시 시도] / 다시 로그인해 주세요 |
| 잊음 | 메일 서버가 없어서 관리자에게 재설정 코드를 받아야 해요 [재설정 코드 입력] |

## 사람이 할 일
| 언제 | 무엇 |
|---|---|
| 기본 (할 일 없음) | `npm run dev` 가 `.env` 에 관리자 이메일 · 무작위 비번을 만든다 → 그걸로 로그인 |
| Google 쓸 때 (~10분) | console.cloud.google.com → 프로젝트 'BrewAI-dev' → Branding · Audience(Internal 또는 External + Testing 사용자) · 범위 openid email profile → Client **Web application** → redirect URI `http://127.0.0.1:8787/api/auth/google/callback` · `http://localhost:5174/api/auth/google/callback` → `.env` 에 `GOOGLE_CLIENT_ID` · `GOOGLE_CLIENT_SECRET` (두 PC 같은 값 · 커밋 금지) |
| 운영 | https 도메인 필수 → `CONDUCTOR_PUBLIC_URL` · redirect URI 를 그 도메인으로 · Audience 를 In production 으로 |

## 데모 스크립트 (금요일 — 두 PC 각각)
1. 새 DB 로 `npm run dev` → 로그 '첫 관리자 dev@brewai.local · 비밀번호는 .env BREWAI_ADMIN_PASSWORD'
2. 데스크톱: 틀린 비번 → '이메일 또는 비밀번호가 맞지 않아요' → 맞는 비번 → 옛 대화가 '내 스페이스'에 그대로
3. 앱 재시작 → 로그인 유지 · 계정 칩 › 로그아웃 → 게이트
4. `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/api/threads` → `401`
5. Google 키가 있는 PC: 설정 › 계정 › Google [연결] → 로그아웃 → [Google로 계속] → 시스템 브라우저 → 앱이 로그인 상태로
6. 관리자 http://localhost:5174 → 로그인 화면 → `.env` 계정 → '모델' → 로그아웃
7. `npm run e2e` · `uv run --locked pytest` green

## done
- [ ] `argon2-cffi==25.1.0` 해시 고정 (`uv lock` · 전이 cffi · pycparser 도 2026-10-23 이전 게시 확인)
- [ ] store v1 → v2: `.data/conductor.sqlite3.v1.bak` 백업 · 모든 auth · 조직 · 스페이스 테이블 · threads · runs 컬럼 · 마이그레이션 테스트
- [ ] `.env` 부트스트랩: 첫 관리자 · 기본 조직 · 내 스페이스 · 옛 대화 귀속 (값 없으면 `needs_bootstrap` 안내 화면)
- [ ] 비밀번호 로그인 · refresh 회전 · 재사용 감지 · 시도 제한 · 열거 방지 (`test_auth.py`)
- [ ] 모든 `/api` 인증 + 내 스페이스 필터 · 라우트 인증 누락 pytest · access log 의 `?code=` 가림
- [ ] 데스크톱: auth 전용 sandbox preload · safeStorage · 헤더 주입 · single-flight refresh · 로그인 게이트 · 계정 칩 (`desktop.spec` sandbox 검사 그대로)
- [ ] Google: start · callback · loopback handoff + PKCE · claim 검사 · 설정 › 계정 연결/해제 (`test_oidc.py` · `auth-google.spec` + `e2e/mock/oidc.mjs`)
- [ ] 관리자: Vite proxy · 쿠키 + CSRF · 로그인 화면 · `/api/admin/*` 에 instance admin (`admin-auth.spec`)
- [ ] 기존 E2E · pytest green (launch 마다 로그인 헬퍼 · `test_api.py` 의 Origin 없는 admin POST 기대값을 쿠키 + CSRF 로)
- [ ] 두 PC(회사 맥 · 집 윈도우)에서 데모 1~7

## 범위 밖
조직 · 공유 스페이스 · 초대 · 재설정 코드 · 관리자 '사용자·조직'(slice 04) · 로그인된 기기 목록 · 관리자 재인증 · 감사 탭 · 복구 CLI · MFA · 메일 · SAML(`docs/ideas.md`) · MCP 툴 · trace(slice 05) · 승인(slice 06)

## 함정
- id_token 서명 검증 생략은 서버가 Google token endpoint 에서 TLS 로 직접 받을 때만. issuer 는 https 만 (`BREWAI_E2E=1` + `CONDUCTOR_PUBLIC_URL` 이 loopback 일 때만 http mock 허용 — 그게 E2E 의 유일한 예외)
- refresh 하나를 여러 Electron launch 가 나눠 쓰면 회전 → 재사용 감지 오탐 → E2E 는 launch 마다 로그인해 `BREWAI_E2E_REFRESH` + `BREWAI_TOKEN_STORE=memory` (`!app.isPackaged` 일 때만)
- 관리자 `localhost:5174` ↔ conductor `127.0.0.1:8787` 은 다른 site → 쿠키가 안 붙음 → admin `API_URL` = '' + Vite `server.proxy` · `preview.proxy`. 관리자 경로의 'Origin 없으면 통과' 규칙은 없앤다
- Google 은 localhost · 127.0.0.1 밖의 http · IP redirect 를 거부 → 운영은 https 도메인. 키가 없으면 버튼을 숨기고 나머지는 동작
- 개발용(미서명) Electron = macOS 키체인 팝업('항상 허용') · Windows 방화벽이 loopback 리스너에 경고할 수 있음(미확인) · Linux basic_text 면 refresh 저장 안 함
- 비밀번호 최소 15자 = OWASP(MFA 없을 때) · 12자로 할지는 결정 대기
- 목요일까지 데모가 안 되면 관리자 로그인을 slice 04 앞부분으로 미룬다
