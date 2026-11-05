# slice 12 · API 키 (외부에서 BrewAI 쓰기 · OpenAI 호환 먼저)

- 목표: 데스크톱에서 만든 키 하나로 `curl` · OpenAI SDK · Cursor 같은 도구가 BrewAI 의 노출 모델을 부르고, 그 사용량이 내 사용량에 '키별'로 쌓인다.
- 결정 (2026-11-05 사용자): 첫 표면 = OpenAI 호환 · 사용자 각자 만들고 관리자가 켜고 끔 · 서버 배포 전제 · 한도는 관리자 콘솔에서 → ADR-0017 (확정).
- 로드맵: 10 샌드박스 + 승인 카드 → 11 trace → **12 API 키** (1단계는 승인 카드와 무관 → 앞당길 수 있음).

## 흐름
| 단계 | 어디 | 무엇 |
|---|---|---|
| 만들기 | 데스크톱 설정 › API 키 | 이름 · 범위(모델 보기 · 대화 · 사용량 보기) · 만료(30 · 90 · 365일) · 한도 → 키를 한 번만 보여 줌 (복사) |
| 부르기 | 바깥 프로그램 | `base_url = http://127.0.0.1:8787/v1` · `api_key = bwk_…` · `model = <노출 모델 id>` |
| 판정 | conductor `/v1/*` | 키 해시 찾기 → 만료 · 폐기 · 범위 · 조직 정책 · 한도 → 주인의 권한으로 모델 확인 (노출 모델만) |
| 실행 | conductor → LiteLLM | 서비스 키 · `user` = users.id · metadata `key_id` · 스트림은 그대로 흘려보냄 · 끝나면 usage_events 한 줄 (`source = api`) |
| 보기 | 설정 › 사용량 · 관리자 › 사용량 | 분류 '키' 추가 · 키 목록에 마지막 사용 · 이번 달 호출 · 비용 |
| 끄기 | 데스크톱 · 관리자 콘솔 | 폐기 = 즉시 401 `key_revoked` · 관리자 강제 폐기 · 사람 계정 정지 = 그 사람 키 전부 멈춤 |

## 표 (store · 표 추가 = SCHEMA_VERSION 그대로)
- `api_keys`: id · user_id · org_id · name · hint(앞 4 · 뒤 4) · hash(sha256) · scopes(json) · limits(json: rpm · tokens_per_day · usd_per_month) · created_at · expires_at · last_used_at · revoked_at · revoked_by
- `usage_events` 칸 더하기: `key_id` · `source` (ensure_columns · project_id 와 같은 길)
- 조직 정책 (meta 또는 orgs 칸): `api_keys.enabled` · `api_keys.max_days` · 기본 한도

## API
| 표면 | 경로 | 비고 |
|---|---|---|
| 사용자 (Bearer bwa_) | `GET/POST /api/me/keys` · `PATCH/DELETE /api/me/keys/{id}` | 만들기 응답에만 `key` 전체 |
| 관리자 (쿠키) | `GET /api/admin/keys?org&user` · `DELETE /api/admin/keys/{id}` · `GET/PATCH /api/admin/keys/policy` | 값은 안 보임 |
| 외부 (Bearer bwk_) | `GET /v1/models` · `POST /v1/chat/completions` | OpenAI 오류 모양 `{error: {type, code, message}}` |

## 지킬 것 (eval · pytest)
- 키 값 · 해시가 로그 · SSE · span · DB(audit) · 모델 요청에 0번 (eval `p1-key-secret`, 기존 '비밀 노출' 제약과 같은 방식).
- `bwk_` 로 `/api/*` · 관리자 표면 = 401 · `bwa_` 로 `/v1/*` = 401 (표면 분리).
- 숨긴 모델 · 남의 조직 모델 = 404 `model_not_found` · 범위 밖 = 403 · 만료 · 폐기 = 401 · 한도 = 429 + `Retry-After`.
- 데모 (E2E): 설정 › API 키 만들기 → 복사 → Playwright 가 그 키로 `/v1/chat/completions` (mock 게이트웨이) → 사용량 '키' 탭에 한 줄 → 폐기 → 401.

## 구현 (2026-11-05)
- conductor: `apikeys.py` (판단) · `api_keys.py` (/api/me/keys · /api/admin/keys) · `api_v1.py` (/v1) · usage_events `key_id` · `source` · 묶음 `key`.
- 데스크톱: 설정 › 내 계정 › API 키 (한도 · 내 키 표 · 만들기 · 한 번만 보기 · 복사 · curl 예시 · 폐기) · 사용량 세부 보기 'API 키' 탭.
- 관리자: 사용자와 조직 › API 키 탭 (정책 카드 · 전체 키 표 · 키마다 한도 · 강제 폐기).
- 검증: pytest test_apikeys 7 · eval p1-key-secret · E2E chat-keys (desktop 3) · admin-keys (admin 3).
