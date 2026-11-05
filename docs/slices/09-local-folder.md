# slice 09 · 로컬 폴더 (프로젝트에 이 PC 폴더 연결 · 읽기만)

- 목표: 데스크톱 프로젝트에 내 PC 폴더를 연결하면, 그 프로젝트 대화에서 에이전트가 파일을 찾아 읽고 답한다.
- 결정 (2026-11-05 사용자): 승인 카드는 뒤로 · conductor 가 직접 읽는다 (이 PC 일 때만) → ADR-0016.
- 로드맵: 08 문서 만들기 → **09 로컬 폴더** → 10 샌드박스 + 승인 카드 (쓰기 · 실행은 여기서) → 11 trace.

## 흐름
| 단계 | 어디 | 무엇 |
|---|---|---|
| 고르기 | 프로젝트 화면 머리 `[로컬 폴더 연결]` | Electron 폴더 대화상자 (`pick-folder.cjs` · E2E = `BREWAI_E2E_PICK_DIR`) |
| 판정 · 저장 | `PUT /api/projects/{id}/folder` (api_folders.py) | 집 폴더 안 · 숨김 X · 이 PC → `project_folders` (사람마다) |
| 대화 | app.py prepare → RunScope.folder | 그 프로젝트 대화 + 내가 연결 + 이 PC 일 때만 도구 3개 + 지침 한 줄 (폴더 이름만) |
| 도구 | localfs.py | `folder_list` {path, depth 1~3} · `folder_read` {path, start, lines} (줄 번호 · 400줄 · 2.4만 자) · `folder_search` {query, glob, regex, path} (100줄 · 5천 파일 · 5초) |
| 화면 | 도구 카드 | 폴더 보기 · 폴더 파일 읽기 · 폴더 검색 (`/api/tools` 이름) |

## 막는 것 (eval `p1-folder-secret` · tests/test_localfs.py)
- 폴더 밖: `../` · 절대 경로 · 밖을 가리키는 링크 → `outside_folder`.
- 비밀: .env · .env.* (견본 .example 은 됨) · *.pem · *.key · id_rsa · .git · .ssh · secrets.json · *.tfvars · *.sqlite3 → `blocked` (목록 · 검색에서도 안 보임).
- 꺼짐: conductor 공개 주소가 이 PC 가 아님 · 요청이 다른 PC → `local_folders_off` (버튼도 숨김). 끄기 = `.env` `CONDUCTOR_LOCAL_FOLDERS=0`.

## 데모 (E2E `chat-folder.spec.ts`)
1. 프로젝트 화면 → `[로컬 폴더 연결]` → 폴더 이름 · 경로 · 읽기만 · 바꾸기 · 연결 끊기.
2. 그 프로젝트에서 '할 일 찾아줘' → 폴더 검색 카드 → `src/app.py` · `.env` 읽기는 막힘 · 비밀 값은 모델 요청 · 화면 어디에도 없음.
3. `[연결 끊기]` → 다음 대화엔 폴더 도구 0.

## 다음
- 쓰기 · 고치기 · 명령 실행 = slice 10 (샌드박스 + 승인 카드) · 열린 대화 칩에 폴더 표시 · 여러 폴더.
