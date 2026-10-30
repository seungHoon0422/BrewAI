# slice 04 · 조직 · 스페이스 · 프로젝트 (작업공간 · 초대 · 관리자 '사용자·조직')

- 목표: 조직 안에서 공유 스페이스를 만들어 함께 쓰고, 스페이스 안을 프로젝트(지침 포함)로 나누고, 초대 코드로 사람을 들인다. 남의 '나만 보기' 대화는 아무도 못 본다 (ADR-0011).
- 연결된 exit criteria: **P1-7**
- 시작: slice 03 다음 — 테이블은 slice 03 마이그레이션에서 이미 만든다.

## 구성
| 층 | 무엇 | 규칙 |
|---|---|---|
| 설치본 | conductor 1개 + SQLite · instance admin | 모델 노출 · 카탈로그 · 조직 만들기 |
| 조직 | 사람 묶음 · 가입 정책 invite(기본) \| domain_auto · google_hd | 항상 1개 이상 · 1개면 UI 에서 조직 이름 숨김 |
| 스페이스 | 작업공간. personal(사용자마다 1개, 못 지움) · shared(open \| private) | 대화 · 실행 · (P3) 연결 · (P5) Skill 의 범위 |
| 프로젝트 | 스페이스 안 묶음 + 지침(그 프로젝트 대화의 시스템 프롬프트 뒤에 붙음) · 내 스페이스에도 됨 | 멤버 · 역할 없음 = 스페이스 것 |
| 대화 | 기본 private(만든 사람만) · [공유] = 스페이스 멤버에게(보기만) · 프로젝트 없음도 됨 | 내 스페이스에선 [공유] 숨김 · 옮기기 = 같은 스페이스 프로젝트끼리만 |
| 실행 | user_id · space_id · org_id 를 같이 저장 | trace · 예산용 |

## 테이블 (slice 03 에서 만든 것)
| 테이블 | 핵심 |
|---|---|
| orgs | name · slug UNIQUE · join_policy · google_hd · members_can_create_spaces(기본 켬) |
| org_members | (org, user) · role owner\|admin\|member · owner 1명 이상 |
| spaces | org_id · kind personal\|shared · owner_user_id(personal 만) · name · description · visibility open\|private · archived_at |
| space_members | (space, user) · role admin\|member (viewer 는 이름만 예약) · 조직 멤버만 |
| projects | space_id · name · description · instructions(시스템 프롬프트 뒤) · created_by · sort_order · archived_at |
| threads (+) | space_id · project_id(NULL = 프로젝트 없음) · user_id · visibility private\|shared |
| invites | code_hash · email? · org_role · space_ids · max_uses · 만료 7일 · revoked_at |
| audit_events | 누가 · 무엇 · 대상 · 결과 · append-only (UPDATE · DELETE 코드 없음) |

## 역할 — 조직 (기본 거부 · 판정은 `auth/policy.py` 한 곳)
| 행동 | instance admin | owner | admin | member |
|---|---|---|---|---|
| 모델 노출 · 카탈로그 · 서버 설정 · 조직 만들기 | O | X | X | X |
| 조직 삭제 · owner 지정 | O | O* | X | X |
| 초대 · 제거 · 역할 변경 (자기 역할 이하) | O | O* | O* | X |
| 가입 정책 · google_hd | O | O* | O* | X |
| 공유 스페이스 만들기 | O | O | O | 설정 켜지면 O |
| 모든 shared 스페이스의 암묵 admin | — | O | O | X |
| 남의 내 스페이스 · private 대화 | X (API 없음) | X | X | X |

\* 당분간 관리자 콘솔은 instance admin 만 → instance admin 이 대신 처리.

## 역할 — 스페이스 · 프로젝트
| 행동 | space admin | member |
|---|---|---|
| 대화 · 실행 · 내 대화 [공유] · 공유된 대화 보기 · 내 대화 프로젝트 옮기기 | O | O |
| 프로젝트 만들기 | O | O |
| 프로젝트 이름 · 설명 · 지침 · 보관 | O (모두) | 내가 만든 것만 |
| 스페이스 이름 · 설명 · 공개 범위 · 멤버(조직 사람만) · 보관 | O | X |
| 나가기 | O (마지막 admin 이면 조직 admin 이 이어받음) | O |

- 실효 역할 = max(직접, 암묵) · 암묵은 shared 만 · open 은 조직 member 가 스스로 참여 · 마지막 owner 는 탈퇴 · 강등 불가 · 정책은 설치본 → 조직 → 스페이스로 강화만.
- 못 보는 자원 = 404(존재 숨김) · 보이지만 행동 권한만 없음 = 403 (예: 공유된 남의 대화에 이어 쓰기 · 남의 프로젝트 지침 고치기).
- `/api/chat` 의 space · project = 기존 대화는 thread 에서(클라이언트 값 무시) · 새 대화만 forwardedProps.spaceId · projectId 를 멤버십 검사 (없으면 내 스페이스).

## 흐름
| 흐름 | 단계 |
|---|---|
| 초대 | 관리자 콘솔: 이메일(선택) · 역할 · 스페이스 · 7일 · 횟수 → `BREW-XXXX-XXXX` 1회 표시 → [안내문 복사] → 메신저 → 데스크톱 '초대 코드가 있어요' → 미리보기(조직 · 초대한 사람 · 역할 · 가린 이메일) → [Google로 가입] 또는 이메일 · 닉네임 · 비밀번호 |
| 재설정 | 관리자: 사용자 행 [재설정 코드] → `bwp_` 1회 표시(30분 · audit) → 데스크톱 '재설정 코드 입력' → 새 비밀번호 → 모든 세션 폐기 → 로그인 화면 |
| 스페이스 만들기 | 데스크톱 전환기 [+ 만들기] → 이름 · 설명 · 공개 범위 · 멤버(조직 사람 검색 · 역할) |
| 프로젝트 | 사이드바 '프로젝트' [+ 새 프로젝트] → 이름 · 설명 · 지침 → 프로젝트를 열면 그 대화들 + [새 대화](이 프로젝트에) · 설정 시트(이름 · 설명 · 지침 · 보관) |
| 대화 공유 · 옮기기 | 대화 머리 [공유] → '이 스페이스 멤버에게 보이기' · [프로젝트로 옮기기] = 같은 스페이스의 프로젝트 · 프로젝트 없음 |
| 제거됨 | 토스트 → 내 스페이스로 이동 |

## API (요청 · 응답 JSON = snake_case · 오류 = `{detail: code}` · 자원마다 `path` = [{kind, id, name}] 위 → 아래)
| 묶음 | 경로 | 인증 |
|---|---|---|
| 사용자 · 계층 | `GET /api/scopes` = 층 표 [{kind, parent, optional, membership, tenant, item}] (`conductor/scopes.py` · 화면 사본 `packages/ui/src/scope.ts` 와 같은지 `test_scopes.py`) | Bearer |
| 공개 | `POST /api/auth/invite/preview` · `/api/auth/signup` · `/api/auth/reset` | 시도 제한 |
| 사용자 · 스페이스 | `GET/POST /api/spaces` · `GET/PATCH /api/spaces/{id}` · `POST …/join` · `…/leave` · `GET …/members` · `PUT/DELETE …/members/{uid}` · `GET /api/org/members?q=` | Bearer + 멤버십 |
| 사용자 · 프로젝트 | `GET/POST /api/spaces/{id}/projects` · `GET/PATCH /api/projects/{id}`(name · description · instructions · sort_order · archived) | Bearer + 스페이스 멤버 |
| 사용자 · 대화 | `GET /api/threads?space=&project=<id\|none>` · `PATCH /api/threads/{id}`(title · visibility · project_id) · `/api/chat`(새 대화만 forwardedProps.spaceId · projectId) · `GET /api/runs?space=` | Bearer + 멤버십 |
| 관리자 | `/api/admin/users`(목록 · 비활성화 · 세션 끊기 · 재설정 코드 · instance admin 지정) · `/orgs`(+ members) · `/spaces` · `/invites` · `/audit` | 쿠키 + CSRF + instance admin |

## 화면
| 어디 | 무엇 |
|---|---|
| 데스크톱 사이드바 맨 위 | 스페이스 전환기 [◫ 현재 스페이스 ▾]: 내 스페이스 → 참여한 공유 → 둘러보기(open) → + 만들기 · 조직 머리글은 조직이 2개 이상일 때만 |
| 데스크톱 사이드바 | '프로젝트(예시)' → 현재 스페이스의 진짜 프로젝트 목록 + [+ 새 프로젝트] (SAMPLE_PROJECTS 삭제) · '최근' = 현재 스페이스의 내 대화 + 공유된 대화(남의 것엔 닉네임 태그) · 입력창 '프로젝트' 칩 = 이 대화의 프로젝트 |
| 프로젝트 화면 | 프로젝트 이름 · 설명 · 그 프로젝트 대화 목록 · [새 대화](이 프로젝트에) · ⚙ 설정 시트(이름 · 설명 · 지침 · 보관 — 만든 사람 · space admin 만) |
| 스페이스 설정 시트 | admin: 이름 · 설명 · 공개 범위(◉ 조직 누구나 참여 / ○ 초대한 사람만) · 멤버 · 보관 / member: [나가기] · '조직에 없는 사람은 관리자에게 초대를 요청하세요' |
| 빈 화면 | '아직 공유된 대화가 없어요. 대화를 시작하고 [공유]를 누르면 멤버가 볼 수 있어요' · '함께 쓸 스페이스를 만들어 보세요 [+ 만들기]' · '프로젝트로 대화를 묶고 지침을 정해 보세요 [+ 새 프로젝트]' |
| 관리자 '사용자·조직' (옛 '사용자·예산') | 탭 4개 — 사용자(닉네임 · 이메일 · 로그인 방식 · 조직·역할 · 상태 · 마지막 로그인 · 세션 수 · 행 메뉴) · 조직(1개면 카드 편집) · 스페이스(공유만 · 개인은 'N개(내용은 본인만)') · 초대(만들기 · 1회 표시 · 사용 수 · 취소). 예산 열은 P6 까지 '—' |

## 데모 스크립트 (금요일)
1. 관리자 콘솔 › 사용자·조직 › 초대: B 용 코드 → [안내문 복사]
2. 데스크톱(B · 다른 사용자 데이터 폴더): '초대 코드가 있어요' → 미리보기 → 가입
3. A: 스페이스 '팀'(open) 만들기 → 프로젝트 '주간 보고'(지침: '표로 답한다') → B 가 둘러보기에서 참여 → A 가 '주간 보고'에서 대화 하나 (답이 표)
4. B 가 A 의 대화 주소로 → 404 · A [공유] → B '최근'에 A 닉네임 태그와 함께 보임
5. 관리자: B [재설정 코드] → B 새 비밀번호 → B 의 다른 세션이 다음 요청에서 게이트로
6. `npm run e2e`(`spaces.spec` · `projects.spec` · `auth-invite.spec` · `admin-users.spec`) · pytest(`test_authz.py`) green

## done
- [ ] `auth/policy.py` 한 곳 판정 · 404 숨김 · 암묵 admin(shared 만) · 역할 상한 · 프로젝트 권한 (`test_authz.py`)
- [ ] 스페이스 API · 전환기 · open 참여 · 멤버 · 나가기 · 보관
- [ ] 프로젝트 API · 사이드바 목록 · 프로젝트 화면 · 설정 시트 · 지침이 시스템 프롬프트에 · 대화 옮기기
- [ ] 입력창 프로젝트 칩 · 대화 [공유] · 빈 화면
- [ ] 초대 코드(만들기 → 미리보기 → 가입) · 재설정 코드
- [ ] 관리자 '사용자·조직' 탭 4개 (`admin.spec` 메뉴 라벨 같이 수정)
- [ ] `audit_events` 기록 · LiteLLM 요청 `user` = users.id
- [ ] `spaces.spec` · `projects.spec` · `admin-users.spec` green · eval 제약 2개(무인증 API 거부 · 다른 스페이스 대화 거부) 케이스

## 범위 밖
조직 admin 범위 콘솔 · viewer 역할 · 프로젝트별 멤버 · open 가입 · 승인 대기 · 메일 초대 · space → LiteLLM team 예산(P6) · 스페이스별 기본 모델 · 로그인된 기기 목록 · 감사 탭 (`docs/ideas.md`)

## 함정
- personal 엔 암묵 권한 없음 — 조직 owner 도 남의 내 스페이스를 못 본다 (API 자체가 없음)
- Store 함수는 범위 인자(user_id, space_id) 필수 · 전역 조회는 관리자 경로(`api_admin.py`)만
- 층 순서 · 부모 칸은 서버 `scopes.py` · 화면 `packages/ui/src/scope.ts` 두 곳뿐 (`test_scopes.py` 가 다른 서버 파일의 층 나열을 막고 두 표가 같은지 본다) · 경로는 자원을 `auth/guard.py` 로만 꺼낸다
- 도메인 판단은 이메일 접미사가 아니라 id_token `hd`
- 이메일을 정하지 않은 초대 + 비밀번호 가입 = 이메일 미확인 (`users.email_verified_at` 비어 있음) → 같은 이메일 Google 이 오면 비밀번호 · 세션을 끊고 가져간다 (계정 선점). 테스트 사용자처럼 비밀번호를 계속 쓸 사람은 이메일을 정한 초대로
- 프로젝트 지침은 사용자 글이다 — 시스템 프롬프트 '뒤'에 붙여 conductor 규칙(툴 · 승인)을 덮지 못하게 · 4000자 상한
- instance admin 은 SQLite · Langfuse 를 직접 볼 수 있다 — 화면에 없다고 못 보는 건 아니다
- '사용자 앱에 관리자 기능 금지'(AGENTS) — 데스크톱엔 스페이스 · 프로젝트 협업만, 조직 · 사용자 · 초대는 관리자 콘솔
