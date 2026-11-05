# ADR-0016 · 로컬 폴더 = 프로젝트에 이 PC 폴더 연결 · conductor 가 직접 읽기만

- 상태: 확정 · 2026-11-05 (사용자: 데스크톱이니 로컬 프로젝트에 접근 · 승인 카드는 뒤로 · 읽는 쪽 = conductor 직접)
- 맥락: 데스크톱 앱인데 대화가 내 PC 파일을 못 본다. 지금 conductor 는 같은 PC 에서 돈다 (ADR-0009 · 배포판 백엔드는 미정, ADR-0007).
- 결정
  - 연결 = 프로젝트 하나에 **사람마다** 폴더 하나 (`project_folders` 표 · 경로는 본인만 본다 · 감사 기록엔 폴더 이름만). 고르기 = Electron 폴더 대화상자 → `PUT /api/projects/{id}/folder`.
  - 읽는 쪽 = conductor 가 직접 (`localfs.py`). 켜짐 = conductor 공개 주소가 loopback **그리고** 요청이 이 PC 에서 (`local_folders_ok` · `from_this_pc`). 아니면 버튼 · 도구 · 지침 0.
  - 고르는 규칙: 집 폴더 **안**만 (집 자체 · 디스크 루트 X) · 경로에 숨김 폴더 X · ~/Library · AppData X.
  - 도구 = 읽기만 3개 `folder_list` · `folder_read` · `folder_search` — 폴더가 연결된 프로젝트 대화에만 실린다 (그 밖 = 요청 바이트 그대로). 팀원도 같은 3개.
  - 막는 것: 폴더 밖 (링크를 푼 실제 경로로 판정 · 링크 폴더는 안 따라감) · 비밀 이름 (.env* · 키 · 인증서 · .git · .ssh · secrets …) = 목록 · 검색 · 읽기 모두 없음 · 바이너리 · 2MB 넘는 파일. 검색은 node_modules 같은 무거운 폴더와 root .gitignore 를 건너뜀. 결과 = untrusted.
  - 모델엔 폴더 **이름**만 (전체 경로 · 사용자 이름은 안 보낸다).
- 탈락: 데스크톱(Electron)이 실행하고 conductor 는 요청만 (서버로 옮겨도 그대로지만 도구마다 왕복 · 팀원 연동이 어렵다 → conductor 를 옮길 때 다시) · 쓰기 · 실행 (승인 카드 전엔 안 함) · 새 의존성(pathspec 등).
- 재검토: conductor 를 다른 PC(서버)로 옮길 때 = 데스크톱 다리로 · 승인 카드(쓰기 · 명령 실행) · 금요일 trace 에서 막힘 오탐 · 미탐.
