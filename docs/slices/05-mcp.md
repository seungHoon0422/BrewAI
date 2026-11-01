# slice 05 · MCP 연결 (관리자 · 사용자 서버 · 사용자별 인증 · 필요할 때만 도구)

- 목표: 관리자와 사용자가 동시에 MCP 서버를 추가해 쓴다. 인증은 사용자마다 한 번이면 계속 자동. 대화엔 앱 목록만 싣고 도구는 쓸 때만 꺼내 토큰을 아낀다 (ADR-0013).
- 연결된 exit criteria: **P1-1** · **P1-8**
- 기간: 2026-11-02 (월) ~ 11-06 (금 데모). 시작 = ADR-0013 확인 → conductor 먼저, 화면은 그 API 로.

## 서버가 내 목록에 오는 길 3개
| 출처 | 누가 추가 | 누구에게 | 인증 |
|---|---|---|---|
| 전체 공통 | 관리자 콘솔 | 모두 (install share + auto_include) · 숨기기 가능 | 각자 자기 계정 |
| 내가 추가 | 사용자 (데스크톱 설정) | 본인만 | 본인 |
| 가져옴 | 남이 추가해 내 조직 · 스페이스에 공유 | [가져오기] 한 멤버만 · 멤버십이 끊기면 목록에서 빠짐 | 가져온 사람이 **자기 계정으로** (공유자 토큰 안 씀) |

같은 서버 주소(resource)면 로그인 한 번이 모든 항목 · 대화 · 스페이스에 쓰인다.

## 토큰 전략
| 무엇이 요청에 실리나 | 크기 |
|---|---|
| 앱 목록 블록 (지침 뒤 · 정렬 고정 = 프롬프트 캐시 유지) `- linear (Linear): 이슈, 프로젝트 [연결됨]` | 한 줄 약 30토큰 · 합계 900 상한 (넘으면 이름만 · 연결됨 · 최근 쓴 것 먼저) |
| 상시 도구 `use_app(app, need)` + 자동 `search_tools` (한글 bigram 검색 전략) | 약 260 |
| MCP 도구 | 0 (전부 deferred) → `use_app` 이 need 로 순위 매긴 4개만 꺼냄 · 그 대화에 고정 · 대화당 최대 12개 |
| 도구 결과 | 12KB 상한 + '나머지 N개' 표시 |

`use_app` 은 서버 안에서 LLM 없이 처리(캐시 적중 30ms): 앱 찾기 → 연결 확인(없으면 아래 인증 흐름) → tools/list 캐시 → BM25 (이름 `_` `.` camelCase 쪼갬 · 설명 · 별칭 · 한글 bigram · 읽기 도구 우선) → 4개 공개. 이름 = `<handle>__<tool>` 64자 · `[A-Za-z0-9_-]` (넘으면 해시 + 역매핑). 스키마 다듬기 = `$schema` · `title` · `examples` 제거 · 설명 400 / 속성 120자.

| 서버 수 | 다 보내기 | 우리 · 앱 안 씀 | 우리 · 앱 1개 | 우리 · 앱 2개 |
|---|---|---|---|---|
| 0 | 0 | 0 | — | — |
| 10 | 약 105,000 | 약 600 | 약 2,400 | 약 4,200 |
| 50 | 약 525,000 (컨텍스트 초과) | 약 1,200 | 약 3,000 | 약 4,800 |

가정(추정, E2E 에서 실측): 서버당 도구 15개 · 도구 정의 700토큰(다듬으면 450) · 목록 한 줄 30. 5단계 실행(서버 10개) = 약 525K → 약 10K (-98%). 지연 = 대화에서 그 앱을 처음 쓸 때 모델 왕복 +1 · 그 뒤 0. tools/list 는 연결 · 추가 · [연결 확인] 직후에 미리 받아 둔다 (앱 시작 때 미리 받기는 아직 없음 = 그 전엔 첫 use_app 이 받는다).

**실측 (2026-11-01 · 위 표는 추정)**: 진짜 conductor → mock 게이트웨이 기록(FAKE_GATEWAY_RECORD) · mock tracker 서버 = 도구 30개(읽기 18 · 쓰기 12) · 모두 연결됨 · 새 대화 첫 질문. 토큰 = `connectors/client.estimate_tokens`(ASCII 4자 = 1 · 한글 1자 = 1) 로 요청 JSON(messages + tools)을 센 값.
MCP 몫 = 도구 정의(use_app · search_tools · 꺼낸 앱 도구) + 지침의 앱 목록 · 안내 + '도구를 꺼냈어요' 알림. 요청 전체 = 그 요청 그대로 (기본 도구 5개 · 지침 · 대화 기록 포함).

| 서버 수 | 다 보내기 (도구 전부) | 앱 안 씀 = 요청 1 | use_app 뒤 · 앱 1개 (도구 4개) | use_app 뒤 · 앱 2개 (도구 8개) |
|---|---|---|---|---|
| 0 | 0 | MCP 0 · 요청 1,471 (5,092 B) | — | — |
| 1 | 1,787 (30개) | MCP 446 · 요청 1,943 (6,730 B) | MCP 725 · 요청 2,422 (8,604 B) | — |
| 10 | 17,866 (300개) | MCP 565 · 요청 2,063 (7,147 B) | MCP 845 · 요청 2,542 (9,021 B) | MCP 1,126 · 요청 3,540 (12,909 B, 3번째 턴) |

- 서버 10개 · 앱 1개 = 17,866 → 845 (-95%). 서버 1 → 10개 = 요청 1 이 +120 (목록 한 줄 약 13토큰). 상시 도구 use_app + search_tools = 316.
- 꺼낸 도구 1개 = 약 60 (mock 설명이 짧다 · 서버당 1,787 = 도구당 60). 진짜 서버(설명 · 스키마가 긴)면 다 보내기가 더 커진다.
- 같은 대화 다음 턴 = 같은 4개 그대로 · 새 use_app 없음 (요청 1 부터 도구 12개). '다 보내기' 는 캐시의 다듬은 정의를 요청과 같은 모양(additionalProperties 포함)으로 만들어 센 값 · 꺼낸 8개는 실제 요청과 토큰이 똑같다.

## 자동 인증 알림 (`users.mcp_auto_auth` · 기본 unset = 꺼짐)
| 상태 | 에이전트가 연결 안 된 앱이 필요할 때 | 버튼 → 결과 |
|---|---|---|
| unset (처음) | 카드 A '리니어 연결이 필요해요' · '다음부터 연결이 필요하면 바로 로그인 화면을 열까요?' | [켜고 로그인] = on + 바로 브라우저 · [설정에서 할게요] = off + 카드 C. 다시는 안 물음 |
| on | 묻지 않고 시스템 브라우저로 로그인 화면 + 카드 B '리니어 로그인 화면을 열었어요' | [다시 열기] [그만두기] · 실행당 1번 · 시간당 3번까지 자동 |
| off | 카드 C '리니어가 아직 연결되지 않았어요. 설정 > 연결된 앱에서 연결하면 이어서 할게요.' | [설정 열기] → 연결 뒤 카드에 [이어서 하기] |
| 가져오기 전 | 카드 D '디자인팀 스페이스에 공유된 앱이에요. 설정에서 가져온 뒤 쓸 수 있어요.' | [설정 열기] |

설정 › 연결된 앱 맨 위 체크박스 '필요할 때 바로 로그인 화면 열기' = 언제든 on / off.

```
에이전트 use_app ─ 연결 없음 → CallDeferred(call_id) → 실행 끝 + CUSTOM brewai.app_auth{mode ask|auto|manual}
데스크톱 main  ─ loopback 127.0.0.1:port + ds → POST /api/me/mcp/servers/:id/connect/start → openExternal(authorize_url)
제공자         ─ 로그인 · 허용 → GET /api/mcp/oauth/callback (state · iss · PKCE · resource) → 302 loopback ?code
데스크톱 main  ─ POST …/connect/complete {code, ds} → 연결됨 → POST /api/chat {thread, resume:{call_id}}
conductor      ─ use_app 을 서버에서 다시 실행(UI 는 근거 아님) → deferred_tool_results → 같은 대화에서 답 이어감
```

## 화면 (UI 문구에 가운뎃점 '·' 쓰지 않는다)
| 어디 | 무엇 |
|---|---|
| 데스크톱 설정 › 연결된 앱 (`features/connections`, SAMPLE_APPS 제거) | 체크박스 · [내 앱] 줄 = 이름 · 도메인 · 출처 배지(전체 공통 / 내가 추가 / 가져옴) · 상태(연결됨 / 연결 필요 / 다시 로그인 필요 / 공유가 끊겼어요) · [연결] [연결 끊기] [숨기기] · [가져올 수 있는 앱] = 스페이스 경로(Breadcrumb)별 [가져오기] |
| 데스크톱 [앱 추가] 대화상자 | 이름 · 주소(https) · 에이전트가 읽는 한 줄 설명(80자) · 찾을 때 쓸 말 · 공유(안 함 / 스페이스 / 조직) → 미리 확인 '로그인 방식 OAuth (linear.app), 도구 18개, 예상 토큰 약 600' |
| 데스크톱 대화 | 카드 A~D · use_app 도구 카드 '리니어에서 쓸 도구 4개를 골랐어요' · 활동 단계 `app:<handle>` |
| 관리자 콘솔 카탈로그 탭 [MCP 서버] | 표 = 이름 · 도메인 · 로그인 방식 · 도구 수 · 예상 토큰 · 연결한 사람 수 · 상태 · [연결 테스트] → 상세 = 에이전트가 보는 목록 한 줄 + 토큰 · 도구별 숨김 / 바로 실행 / 승인 필요(07) / 항상 같이 열기 · 별칭 · 사전 등록 OAuth client |
| 관리자 콘솔 탭 [사용자 추가 서버] | 보기 · 끄기 · 정책(사용자 추가 허용 · 주소 허용 목록 = 바깥으로 요청 전에 보고 · 이미 추가된 서버도 목록 · 대화 · 연결에서 막힘). 인증정보는 개수만. 사용자 서버 = 주소 query 비밀값 금지 · 로그인 서버(issuer)는 같은 사이트만 · 사전 등록 client 는 관리자 서버만 |

## API (`api_mcp.py`)
| 묶음 | 경로 |
|---|---|
| 사용자 (Bearer) | `GET /api/me/mcp/servers` {mine, importable} · `POST` (probe + SSRF 검사 + share?) · `PATCH` · `DELETE /:id` (내 것 = 삭제 · 가져옴 = 빼기 · 공통 = 숨기기) · `POST`·`DELETE /:id/shares` · `POST /:id/import` · `POST /:id/connect/start` · `…/connect/complete` · `DELETE /:id/connection` · `GET`·`PATCH /api/me/settings` {auto_auth, auto_auth_asked} · `GET /api/me/mcp/presets` (추천 서버 + added) |
| 공개 | `GET /api/mcp/oauth/callback` |
| 관리자 (쿠키 + CSRF) | `GET`·`POST /api/admin/mcp/servers` · `PATCH`·`DELETE /:id` · `POST /:id/test` · `GET`·`PATCH /:id/tools` · `PUT /:id/oauth-client` · `GET /api/admin/mcp/user-servers` · `PATCH /api/admin/mcp/policy` · `GET /api/admin/mcp/presets` |

AG-UI: `CUSTOM brewai.app_auth` {call_id, server(+ issuer_domain), mode, reason not_connected\|expired\|insufficient_scope, write, label} (쓰기 도구 대기 = 로그인 뒤 저절로 잇지 않고 [이어서 하기]) · `CUSTOM brewai.app_needs_import` · `run_summary.pending`. span: `brewai.mcp.server` · `brewai.mcp.revealed` · `brewai.mcp.tool_tokens_est` · `gen_ai.tool.name` · `mcp.method.name` (토큰 값은 절대 안 남김).

## 테이블 (store v3 → v4 · 한 번에 전부 · 파일 DB 는 먼저 `<파일>.v3.bak`)
| 테이블 | 핵심 |
|---|---|
| mcp_servers | handle(a-z0-9_ 2~20) · name · url(정규 https · 못 고침) · origin admin\|user · owner_user_id · description(80자) · aliases · auth oauth\|none · status · tool_count · tool_tokens_est · UNIQUE(url, owner_user_id) |
| mcp_server_shares | (server, scope_kind install\|org\|space, scope_id) · auto_include · shared_by |
| mcp_user_servers | (user, server) · handle(내 별칭 · 처음 목록에 오를 때 정한 값을 적어 둔다 = 대화에 고정된 이름이 다른 서버로 안 옮겨 감) · state added\|hidden · source own\|imported\|install |
| mcp_tool_policy | (server, tool) · mode hidden\|auto\|approval · always_reveal (approval = 저장만 · slice 07 승인 카드 전까지 auto 와 같이 돈다) |
| mcp_credentials | (user_id, resource) · issuer · client_id · token_ct(AES-GCM · AAD = user\|resource\|issuer) · key_id · expires_at · status |
| mcp_oauth_clients · mcp_oauth_flows | (issuer, redirect_uri) 마다 client / state 해시 · verifier_ct · ds_hash · 10분 · handoff = `one_time_tokens` kind mcp_handoff 60초 |
| mcp_tool_cache | (server, user 또는 '*') · ttl_ms(없으면 10분) · 다듬은 tools_json · tokens_est |
| users (+) · runs (+) · meta | `mcp_auto_auth` unset\|on\|off / `pending_json` / `mcp.allow_user_servers` · `mcp.url_allowlist` |

권한(policy.py · 기본 거부): 만들기 = 누구나(허용 정책 켜짐) · 고치기 · 지우기 = 주인 · 끄기 = instance admin · 스페이스 공유 = 주인이면서 그 shared 스페이스 멤버 · 조직 공유 = 확인 대기(아래) · 공유 끊기 = 주인 · space admin · 조직 owner/admin · 가져오기 = 공유 범위의 멤버. audit = `mcp.server.add|remove|share|unshare|import` · `mcp.connect|disconnect`.

## E2E (게이트웨이 · MCP · OAuth 모두 mock)
- `e2e/mock/mcp.mjs` (Node 내장만, oidc.mjs 처럼): `/mcp` = server/discover · tools/list 30개(페이지) · tools/call · 401 + PRM · AS · `/register` · `/authorize`(허용 버튼) · `/token`(refresh 회전) · `/__fake/expire|revoke` · 인증 없는 `/noauth/mcp`. conductor `CONDUCTOR_MCP_ALLOW_LOOPBACK=1`(테스트 전용).
- gateway.mjs 표식: `[fake:app <handle> <need>]` → use_app · `[fake:tool <name>]` → 그 도구가 `tools` 에 있을 때만 호출 · `FAKE_GATEWAY_RECORD` 로 실린 것 검사.

| 스펙 | 확인 |
|---|---|
| admin-mcp | 공통 서버 추가 · 연결 테스트 · 도구 수 · 예상 토큰 · 쓰기 도구는 쓰기 표시 |
| mcp-connect | 설정 '연결 필요' → 가짜 로그인 → 연결됨 · 재시작 유지 · 끊기 |
| mcp-tokens | 요청 1 의 tools = 기본 + use_app + search_tools, `tracker__*` 0개 → use_app 뒤 4개 이하 → 다음 턴도 고정(새 use_app 없음) · MCP 바이트 예산 |
| mcp-auth-flag | unset = 카드 A → 승인 → 브라우저 → 같은 대화에서 답 · revoke 뒤 다음 요청은 카드 없이 바로 브라우저 · off = 카드 C + 설정 링크 |
| mcp-share | A 가 추가 + 스페이스 S 공유 → 멤버 B 가 가져와 다른 가짜 계정으로 연결(mock 이 B 토큰 ≠ A 확인) · 비멤버 C 는 안 보임 |

pytest: vault 왕복 · AAD 불일치 · iss 불일치 · SSRF(사설 · link-local · rebinding) · policy 표 · 한글 need 순위 · 64자 이름 · 결과 상한 · refresh single-flight. eval: 기존 '비밀 노출' 제약에 케이스 1개(MCP 토큰이 프롬프트 · trace 에 0) = `evals/cases/p1-mcp-secret.json` + 도구 결과 주입 `p1-mcp-untrusted-result.json`.

## 실제 서버 확인 (2026-11-01)
벤더가 직접 운영하는 원격 MCP 를 우리 conductor(SSRF 검사 켬)로 확인. 인증 없음 = 연결 · 도구 목록 · 읽기 도구 1번 · 대화 use_app 까지. OAuth = DCR 등록 + 로그인 주소 만들기까지 (로그인 · 동의는 사람이 나중에). 쓰기 도구 · 자격 증명 0. 바깥 요청 약 1,300번 · DCR 서버당 1번 · 기록 = 작업 scratchpad `wf-realmcp/`. **규칙(서버당 약 20번) 넘음**: 확인 · 대화 · 재확인 단계를 합치면 12곳이 23~42번 (Microsoft Learn 39~42 · AWS 문서 38 · GitMCP 38 · Exa 37 · DeepWiki 34 · Webflow 개발 문서 28~31 · Atlassian 24~26 · Agents 문서 · Astro · OpenAI 문서 · Grep · Nuxt 23~24). 인증 없는 서버는 연결 한 번 = 요청 4번(discover 400 · initialize · initialized · 요청) → 다음 재확인은 저장된 결과를 다시 쓴다.
추천 목록 = `services/conductor/src/conductor/connectors/presets.json` (70개 · 쓸 수 있음 54) → `GET /api/admin/mcp/presets` · `GET /api/me/mcp/presets` (+ added) → 관리자 [MCP 서버 추가] · 데스크톱 [앱 추가] 위 '추천 서버'. 누르면 칸만 채우고 추가는 사람이.

| 서버 | 인증 | 결과 | 도구 수 | 메모 |
|---|---|---|---|---|
| Cloudflare 문서 · Agents 문서 · 블로그 | 없음 | 됨 | 2 · 1 · 4 | 블로그 검색 25초 (느림) |
| Microsoft Learn | 없음 | 됨 | 3 | 세션 유지형 |
| AWS 문서 | 없음 | 됨 | 5 | structuredContent |
| OpenAI 개발자 문서 | 없음 | 됨 | 5 | |
| Context7 · DeepWiki · Grep | 없음 | 됨 | 2 · 3 · 1 | |
| LangChain · Astro · Svelte · Nuxt · Mintlify 문서 | 없음 | 됨 | 3 · 1 · 4 · 12 · 3 | 결과가 크면 12KB 로 자름 |
| Webflow 개발 문서 | 없음 | 됨 | 1 | 'MCP' 검색에 서버가 거절 글 |
| Hugging Face · Exa | 없음 | 됨 | 4 · 2 | |
| GitMCP | 없음 | 됨 | 5 | 17초 (느림) |
| Cloudflare 데모 데이 | 없음 | 됨 | 1 | 행사용 = 목록에서 뺌 |
| GitLab · Sentry · Netlify · Postman · Buildkite · CircleCI · Railway · Wix | OAuth | 로그인 주소까지 | 로그인 뒤 | DCR 됨 |
| Cloudflare API · 컨테이너 · 브라우저 · DEX · CASB | OAuth | 로그인 주소까지 | 로그인 뒤 | 지원 중단 Cloudflare 서버 10개는 목록에서 뺌 |
| Supabase · Neon · Prisma · Grafana · Datadog · PostHog · Airtable | OAuth | 로그인 주소까지 | 로그인 뒤 | PostHog scope 153개 · Supabase 비밀 client |
| Notion · Linear · Atlassian v2 · monday · Make · Intercom · Zapier | OAuth | 로그인 주소까지 | 로그인 뒤 | monday = 계정 관리자 승인 · Intercom = localhost 콜백만 자동 허용 |
| Stripe · PayPal · Plaid · Canva · Miro · Webflow | OAuth | 로그인 주소까지 | 로그인 뒤 | Plaid = 운영 승인 팀만 |
| Vercel · Square · ClickUp | OAuth | 로그인 주소까지 | 로그인 뒤 | 벤더가 검토한 앱만 로그인 (거절될 수 있음) |
| GitHub · Asana · HubSpot · Slack · Box | OAuth | 안 됨 (벤더) | | 자동 등록 없음 = 사전 등록 client 필요 · GitHub = 관리자만 |
| Dropbox · Figma · 카카오 PlayMCP | OAuth | 안 됨 (벤더) | | DCR 403 (허용 목록) · PlayMCP 는 CIMD 지원 |
| Calendly | OAuth | 안 됨 (벤더) | | DCR 400 (원인 코드는 이제 로그에 남음) |
| Gmail · Drive · 캘린더 · BigQuery | OAuth | 안 됨 (벤더) | 23 · 8 · 9 · 9 | 목록은 공개 · 호출은 Google OAuth client 필요 |
| Render · Google 개발자 문서 · Google 지도 | API 키 | 안 됨 (우리) | 5 (지도) | API 키 인증 없음 |
| Semgrep · Snyk · Shopify Dev · 토스페이먼츠 | | 뺌 | | 보관된 실험 서버 · 원격 없음(로컬 stdio) |

고친 것 (pytest `test_mcp_real.py`): issuer 루트 '/' 차이 허용(Box · Semgrep · ADR-0013 의 의도적 예외 · 지금 이걸로 쓸 수 있게 된 추천 서버는 없음) · 목록만 공개 · 호출이 401 + resource_metadata 인 서버 = OAuth 로 바꾸고 로그인 안내 + 그때 받은 PRM 주소(DB)로 로그인 시작(Google · 헤더 없는 401 은 안내만) · 결과 상한을 직렬화 크기로 · DCR 실패 error 코드 로그 · 서버 이름 = serverInfo · OAuth 확인 바깥 요청 2번 → 1번(POST 만 · 연결 뒤 GET 스트림의 401 · 403 은 무시) · 사용자 추천 목록도 주소 허용 목록을 따름 · 추천 서버의 부르는 이름(cloudflare_2 대신 cf_docs).
남은 것: API 키(정적 헤더) 인증 · CIMD (PlayMCP · 여러 벤더가 DCR 대신 권장) · PRM scopes_supported 전부 요청(PostHog 153개 · 사양대로지만 최소 권한 아님) — 결정 필요.

## 이번 주 순서 · 목요일 자르기
월 ADR · 의존성 · 마이그레이션 → 화 connectors(OAuth · vault · use_app · deferred · 검색) → 수 관리자 공통 서버 + 데스크톱 연결된 앱 · 체크박스 · 카드 → 목 사용자 추가 · 공유 · 가져오기 → 금 데모. 목요일 밤 안 되면 자르는 순서: ① 공유 · 가져오기 화면(테이블 · API 는 남김) ② 관리자 도구별 토글(mock 의 읽기 목록 사용) ③ 카드 B 다듬기.

## 사람이 할 일
| 언제 | 무엇 |
|---|---|
| 시작 전 | 없음 (결정 3개 확정) |
| 기본 (할 일 없음) | `npm run dev` 가 `.env` 에 `CONDUCTOR_SECRET_KEY` 를 만든다 (두 PC 다른 값 = DB 도 따로라 괜찮음 · 잃으면 전부 다시 연결) |
| 진짜 앱으로 데모할 때 | Linear · Notion 계정 (DCR 이라 등록 불필요) · GitHub 는 OAuth App 사전 등록(~5분, redirect `http://127.0.0.1:8787/api/mcp/oauth/callback`) → 관리자 콘솔 [사전 등록 client] |

## done
- [ ] `mcp==2.3.0` · `cryptography==50.0.2` 해시 고정 (`uv lock` · 전이 패키지도 7일 지남 · Windows 전이 pywin32 확인)
- [ ] store v3 → v4 백업(.v3.bak) · 모든 mcp 테이블 · 마이그레이션 테스트
- [ ] connectors: OAuth(DCR · 사전 등록) · vault · refresh · SSRF · use_app · deferred · 한글 검색 · 결과 상한 · span
- [ ] 관리자 [MCP 서버] · 데스크톱 연결된 앱 · [앱 추가] · 체크박스 · 카드 A~D (UI 문구 '·' 0)
- [ ] 스펙 5개 + 기존 E2E · pytest · eval green
- [ ] 두 PC 에서 데모: 질문 → 카드 A → 로그인 → 같은 대화에서 결과 카드 → 다음 대화는 묻지 않고 바로

## 결정 (2026-11-01 사용자 확정)
1. 조직 공유 = **조직 owner·admin 만** (스페이스 공유 = 그 스페이스 멤버)
2. 쓰기 도구 = **지금 바로 허용** (도구 카드에 쓰기 표시 · slice 07 승인 카드 뒤 도구별 '승인 필요' 로)
3. 공유 · 가져오기 화면 = **05 안 · 목요일 첫 자르기**
