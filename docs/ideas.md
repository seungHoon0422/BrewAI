# 아이디어 (백로그 아님)

> 떠오르면 한 줄만. 4주마다 cool-down 때 뽑히지 않은 줄은 지운다.

- agentgateway 하나로 LLM + MCP 게이트웨이 통합 (P2 PoC 후보)
- 회사 PC Docker 가능하면 Langfuse self-host 전환
- Codex 병행 시 `.agents/skills` 미러 자동 생성
- P4 sandbox 후보: 제한 venv 로컬 프로세스 vs 호스티드(E2B 등) vs 회사 PC Docker — P3 끝날 때 ADR
- gh CLI 설치(`winget install GitHub.cli` → `gh auth login`)하면 PR·CI 확인을 Claude가 대신
- P2 배포 결정 때 k3d/쿠버네티스 검토 (지금은 Compose: 기본 LiteLLM 만, trace 때 Langfuse 묶음)
- conductor CORS 기본값의 Vite 개발 출처(localhost:5173 · 5174)는 개발 전용 → P2 배포 때 기본값에서 빼고 dev-all·E2E 가 넘기게
- 메일(SMTP · 개발은 Mailpit)로 초대 · 재설정 코드 보내기 (지금은 관리자가 코드를 메신저로)
- MFA · passkey (넣으면 비밀번호 최소 15자 재검토) · 유출 비밀번호 목록 검사
- open 가입 · 도메인 가입 승인 대기(domain_request) (지금은 초대 코드 + domain_auto 만, ADR-0011)
- 첫 관리자 setup code 화면 (지금은 `.env` 부트스트랩, ADR-0010)
- brewai:// 딥링크 로그인 — 설치본 · 서명 뒤 (지금은 loopback)
- 계정 보안 마무리 slice: 로그인된 기기 목록 · 다른 기기 모두 로그아웃 · 관리자 민감 작업 10분 재인증 · 감사(audit) 탭 · 복구 CLI `npm run auth -- reset-code <email>`
- 스페이스 viewer 역할 · 조직 owner·admin 범위의 관리자 콘솔 · 스페이스별 기본 모델
- 스페이스 → LiteLLM team 예산 매핑 (P6 · Organizations 는 엔터프라이즈 전용이라 안 씀)
- SSO: Keycloak 을 OIDC issuer 로 붙여 SAML · SCIM · 고객사 IdP (IdP 교체 = identities(issuer, sub) 그대로)
- 범위 일반화: 대화 범위를 `space_id · project_id` 대신 `path` + 가장 가까운 묶음 `{kind, id}` 로 (chat api · hooks · ChatScreen 공유 판정 · `/api/chat` 의 `scope` · 서버 `Scopes.resolve_container`) — 층을 끼울 때
- 데스크톱 창 틀 색(`main.js` frame) = renderer 가 `--surface-app` · `--text` 를 읽어 preload 로 넘기기 (지금은 tokens.css 와 같은 값 + 주석)
- 모델 메뉴를 `Popover`(surface=glass) 부품으로 · 복사 알림 `.copied` → `Tooltip` · 사이드바 줄 `NavItem` · 입력창 `Composer` 부품 (packages/ui)
- 대화상자 · 서랍의 바쁨/오류 반복을 공용 `useAction()` {busy, error, run} 하나로 (ProjectDialog · SpaceDialog · SpaceSheet · NicknameDialog · PasswordDialog · AccountSection)
- 기능 CSS 짧은 전역 이름(`.nm` `.sub` `.v` …)을 기능 접두사로 · 또는 CSS Modules (E2E 고리 클래스 같이)
- MCP 미리 공개(pre-reveal): 사용자 말에 연결된 앱 이름 · 별칭이 있으면 그 앱 상위 4개 도구를 처음부터 실어 use_app 왕복 0 (ADR-0013)
- MCP 앱 목록이 900토큰을 넘으면 임베딩 검색 · 서버별 자동 인증 알림 설정 · 창이 가려졌을 때 OS 알림
- MCP CIMD(공개 https `CONDUCTOR_PUBLIC_URL` 생긴 뒤) · scope step-up(403 insufficient_scope) · listChanged 구독 · 연결 끊기 때 RFC 7009 revoke
- 관리자 MCP 서버를 조직 · 스페이스로 한정 = `mcp_server_shares` 줄만 추가 (지금은 install = 전체 공통)
- stdio 로컬 MCP 서버(데스크톱 안 실행) · elicitation(MRTR input_required) 카드
