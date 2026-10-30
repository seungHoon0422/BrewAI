# ADR-0011 · 조직 > 스페이스(작업공간) > 대화 · 대화는 기본 '나만 보기'

- 상태: 제안 · 2026-10-30 · 계층 · 식별 키는 되돌리기 어려움 → 사용자 확인 대기 (HANDOFF)
- 맥락: 사용자: "space 와 조직 관리도 — 스페이스는 작업공간 같은 느낌". 데이터 소유 단위를 지금 정하지 않으면 P3 연결 · P5 Skill · P6 예산이 갈 곳이 없다.
- 결정
  - 계층: 설치본 > 조직(항상 있음, 1개면 UI 에서 숨김) > 스페이스 > 대화 > 실행. 프로젝트 층은 없다.
  - 스페이스: 사용자마다 못 지우는 '내 스페이스'(personal) 1개 + 공유(shared · open = 조직 누구나 참여 / private = 초대한 사람만). threads · runs 에 `space_id`. 옛 대화는 첫 관리자의 내 스페이스로.
  - 대화: 기본 private(만든 사람만) → [공유] = 스페이스 멤버에게. private 은 조직 owner · instance admin 도 UI · API 로 못 본다.
  - 역할: instance admin · 조직 owner|admin|member · 스페이스 admin|member. 조직 owner·admin = shared 스페이스의 암묵 admin(personal 엔 절대 없음). 판정은 `auth/policy.py` 한 곳, 기본 거부.
  - 식별: `users.id` = uuid · Google = identities(issuer, sub). 이메일로 식별 안 함. 같은 이메일 자동 연결은 `email_verified` 참 + Google 이 그 이메일에 권위 있을 때만(@gmail.com · hd 있는 Workspace). 도메인 판단 = id_token `hd`.
  - 가입: 초대 코드 `BREW-XXXX-XXXX`(7일 · 횟수) 기본 · 조직별 domain_auto(hd = org.google_hd). open 가입 없음 → 계정 선점 경로 없음. 메일 서버 없음 → 코드는 메신저로.
  - 관리 위치: 스페이스 만들기 · 멤버(조직 사람만) = 데스크톱(협업 기능) · 조직 · 사용자 · 초대 · 가입 정책 · 재설정 코드 = 관리자 콘솔 '사용자·조직', 당분간 instance admin 만.
  - 응답: 못 보는 자원 = 404(존재 숨김) · 같은 범위에서 행동 권한만 없음 = 403. `/api/chat` 의 space = 기존 대화는 DB(thread) · 새 대화만 요청 값(멤버십 검사).
  - 범위: 모델 노출 = 설치본 · 기본 스킬 = 설치본 읽기 전용 · P3 연결 = user(space 공유 연결은 space admin) · P5 Skill = user|space|org.
  - trace: 모든 span 에 `user.id`(uuid) · `session.id`(thread) · `brewai.org.id` · `brewai.space.id`. 인증 이벤트는 Langfuse 가 아니라 `audit_events`(append-only).
- 주의: instance admin 은 SQLite · Langfuse 를 직접 볼 수 있다 — 'UI 에 없다' ≠ '볼 수 없다'.
- 미룸: viewer 역할 · 조직 admin 범위 콘솔 · space → LiteLLM team 예산(P6, Organizations 는 엔터프라이즈 전용) · 두 PC 는 DB 가 따로 = 계정도 따로.
