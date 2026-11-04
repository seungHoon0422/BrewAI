# slice 08 · 문서 파일 만들기 (스킬은 필요할 때 찾기 · make_file · 답 아래 저장)

- 목표: "워드로 · 엑셀로 · 피피티로" 요청에 진짜 파일을 만든다. 스킬이 늘어도 시작 프롬프트 · 도구 정의가 거의 그대로.
- 결정 (2026-11-04 사용자): 스킬 = 필요로 찾기 (use_skill {need}) · 만들기 = 서버 도구 make_file (코드 실행 없음) · PDF · 코드 샌드박스 = 다음 slice (이 PC Docker · 승인 카드와 함께 · 'PDF 로 내보내기' 스킬).
- 로드맵: 08 문서 만들기 → 09 샌드박스 + 승인 카드 (ADR-0016) → 10 trace.

## 스킬 찾기 (skills.py · connectors/rank.py)
| 전 | 후 |
|---|---|
| 프롬프트 = 스킬마다 `이름 화면이름` 한 줄씩 | `스킬 N개 (화면 이름 12개까지 · 외 N개): 맞을 것 같으면 먼저 use_skill {need}` |
| 도구 인자 = 스킬 이름 enum (스킬 수만큼 늘어남) | `need` (할 일 한 줄) · `name` (알 때만) — 스킬이 30개여도 같은 스키마 |
| 모델이 이름을 고름 | 서버가 고름: BM25 (이름 ×3 · 화면 이름 ×2 · 설명) + 한영 사전 (워드 · 엑셀 · 피피티 · 발표 …) · 한 글자 한글 말끝(줘 · 해)은 안 셈 → 본문 + 다른 후보 3개 |

## 스킬이 여는 도구
- SKILL.md `tools: [make_file]` = 그 스킬을 부른 대화에서만 도구 배열에 실린다 (부르기 전 = 요청에 0 · 기록에 스킬 결과가 남아 다음 턴에도). 쓸 수 있는 이름 = `tools.SKILL_TOOLS`.
- 스타터 스킬 5개: 요약 · 비교표 · **Word 문서(word-doc) · Excel 표(excel-sheet) · 발표 자료(ppt-deck)**.

## make_file (docmake.py · 표준 zipfile + XML · 새 의존성 없음)
| kind | 모델이 주는 것 | 서버가 정하는 것 |
|---|---|---|
| docx · md | title · blocks (heading 1~3 · paragraph · bullets · numbered · table · pagebreak) · `**굵게**` · 항목 앞 공백 2칸 = 안쪽 | A4 · 여백 · 맑은 고딕 · 표 테두리와 머리 행 · 번호 목록마다 1부터 |
| xlsx · csv | sheets [{name, rows}] (첫 행 = 머리) | 머리 굵게 · 첫 행 고정 · 열 너비 · 수식 = 허용 함수만 (DDE · 외부 참조 · HYPERLINK = 글로) · csv = 수식처럼 보이는 글 앞에 ' · BOM |
| pptx | title · subtitle (표지) · slides [{title, bullets, rows}] | 16:9 · 표지 + 제목과 내용 레이아웃 · 글 + 표면 글 위 1/3 |
- 상한: 블록 2,000 · 행 5,000 · 열 50 · 시트 20 · 슬라이드 60 · 칸 2만 자 · 합 200만 자 · 같은 입력 = 같은 바이트.
- 만든 파일 = 파일 저장소 (slice 07) · 그 **대화**에 묶음 (턴에는 안 묶음 = 내 말풍선 첨부 칩 아님) · 다음 턴 read_file 로 읽힘 · 스페이스 '파일' 화면에도.
- 확인: LibreOffice 로 PDF 변환 · 쪽 그림 확인 (docx · xlsx · pptx) · pytest 는 모든 칸을 XML 로 읽고 우리 파서로 되읽기.

## 화면
| 어디 | 무엇 |
|---|---|
| 답 아래 | '만든 파일' 칩 (종류 아이콘 · 이름 · 종류 크기 · 저장) → 데스크톱 = 저장 대화상자 (main `save-file.cjs` · 경로는 renderer 에 안 돌려줌) · 지워진 파일 = '지워진 파일이에요' |
| 도구 카드 | '파일 만들기' · 파일 이름 · '만들었어요 (답 아래에서 저장)' · 구조(JSON)는 원문 토글 뒤 |
| 설정 › 스킬 | 문서 스킬 3개에 '쓰는 도구: 파일 만들기' |
| 개발 샘플 | '문서 파일 만들기' 묶음 (Word 회의록 · Excel 예산표 · PPT 발표 자료) |

## 테스트
- pytest test_docmake.py · test_skills.py (need 로 찾기 10가지 · 스킬 30개 = 같은 스키마) · 골든 다시 찍음 (스킬 줄 · use_skill 인자 · 스타터 수만 다름).
- E2E chat-make.spec.ts: 스킬 전 make_file 없음 → 뒤에 있음 → 칩 → 저장(BREWAI_E2E_SAVE_DIR) → 다시 열기 → 지운 파일. 스크린샷 `desktop-make-*`.
