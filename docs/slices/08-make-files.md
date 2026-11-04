# slice 08 · 문서 파일 만들기 (스킬은 필요할 때 찾기 · make_file · 답 아래 저장)

- 목표: "워드로 · 엑셀로 · 피피티로" 요청에 진짜 파일을 만든다. 스킬이 늘어도 시작 프롬프트 · 도구 정의가 거의 그대로.
- 결정 (2026-11-04 사용자): 스킬 = 필요로 찾기 (use_skill {need}) · 만들기 = 서버 도구 make_file (코드 실행 없음) · PDF = 직접 만들기 (fontTools + 나눔고딕 동봉) · 코드 샌드박스 = 다음 slice (이 PC Docker · 승인 카드와 함께).
- 로드맵: 08 문서 만들기 → 09 샌드박스 + 승인 카드 (ADR-0016) → 10 trace.

## 스킬 찾기 (skills.py · connectors/rank.py)
| 전 | 후 |
|---|---|
| 프롬프트 = 스킬마다 `이름 화면이름` 한 줄씩 | `스킬 N개 (화면 이름 12개까지 · 외 N개): 맞을 것 같으면 먼저 use_skill {need}` |
| 도구 인자 = 스킬 이름 enum (스킬 수만큼 늘어남) | `need` (할 일 한 줄) · `name` (알 때만) — 스킬이 30개여도 같은 스키마 |
| 모델이 이름을 고름 | 서버가 고름: BM25 (이름 ×3 · 화면 이름 ×2 · 설명) + 한영 사전 (워드 · 엑셀 · 피피티 · 발표 …) · 한 글자 한글 말끝(줘 · 해)은 안 셈 → 본문 + 다른 후보 3개 |

## 스킬이 여는 도구
- SKILL.md `tools: [make_file]` = 그 스킬을 부른 대화에서만 도구 배열에 실린다 (부르기 전 = 요청에 0 · 기록에 스킬 결과가 남아 다음 턴에도). 쓸 수 있는 이름 = `tools.SKILL_TOOLS`.
- 스타터 스킬 6개: 요약 · 비교표 · **Word 문서(word-doc) · Excel 표(excel-sheet) · 발표 자료(ppt-deck) · PDF 문서(pdf-doc)** (PDF = 대화 내용으로 바로 · Canva 같은 앱 말고 make_file).

## make_file (docmake.py · 표준 zipfile + XML · 새 의존성 없음)
| kind | 모델이 주는 것 | 서버가 정하는 것 |
|---|---|---|
| docx · md | title · blocks (heading 1~3 · paragraph · bullets · numbered · table · pagebreak) · `**굵게**` · 항목 앞 공백 2칸 = 안쪽 | A4 · 여백 · 맑은 고딕 · 표 테두리와 머리 행 · 번호 목록마다 1부터 |
| xlsx · csv | sheets [{name, rows}] (첫 행 = 머리) | 머리 굵게 · 첫 행 고정 · 열 너비 · 수식 = 허용 함수만 (DDE · 외부 참조 · HYPERLINK = 글로) · csv = 수식처럼 보이는 글 앞에 ' · BOM |
| pptx | title · subtitle (표지) · slides [{title, bullets, rows}] | 16:9 · 표지 + 제목과 내용 레이아웃 · 글 + 표면 글 위 1/3 |
| pdf (2026-11-04 사용자: 앱 없이 직접 · 앱 안에서 보기) | docx 와 같은 blocks | pdfmake.py · A4 · 나눔고딕(runtime/fonts · OFL) 쓴 글자만 부분 집합 (fontTools 4.67.0) · ToUnicode (복사 · 되읽기) · 한글 줄 나눔 · 표 칸 줄 나눔 · 다음 쪽에 머리 행 · 300쪽 |
- 상한: 블록 2,000 · 행 5,000 · 열 50 · 시트 20 · 슬라이드 60 · 칸 2만 자 · 합 200만 자 · 같은 입력 = 같은 바이트.
- 만든 파일 = 파일 저장소 (slice 07) · 그 **대화**에 묶음 (턴에는 안 묶음 = 내 말풍선 첨부 칩 아님) · 다음 턴 read_file 로 읽힘 · 스페이스 '파일' 화면에도.
- 확인: LibreOffice 로 PDF 변환 · 쪽 그림 확인 (docx · xlsx · pptx) · pytest 는 모든 칸을 XML 로 읽고 우리 파서로 되읽기.

## 디자인 4종 + 꾸밈 블록 (designs.py · 2026-11-04 사용자: 글과 표만이라 딱딱하다 → 우리가 견본 디자인을 들고, 말하면 그 디자인으로)
| design | 색 | 표지 | 제목 | 고르는 때 |
|---|---|---|---|---|
| clean 깔끔 (기본 · 모르는 이름도) | 회색 하나 | 흰 쪽 + 짧은 막대 | 굵게 | 무엇에나 |
| report 보고서 | 남색 | 위 남색 띠 (pptx = 왼쪽 패널) | 왼쪽 띠 | 보고 · 기획서 · 공문 |
| modern 모던 | 검정 + 파랑 | 진한 면 | 번호 + 아래 선 (01 · 1.1) | 발표 · 제안 · 기술 |
| warm 따뜻함 | 주황 · 베이지 | 베이지 면 | 강조색 밑줄 | 안내 · 사내 소식 · 행사 |

- 꾸밈 블록 (docx · pdf · md): `cover` {title, subtitle, date, by} = 첫 쪽 하나 (docx = 여백 0 구역 · 쪽 번호 없음) · `kpis` {cards: [{label, value, note}]} 2~4개 · `callout` {tone info|ok|warn, title, text} · `quote` {text, by} · `divider` · `columns` {left, right} (안에는 heading · paragraph · 목록 · table · callout · quote · divider).
- 표 = 머리 행 디자인 색 · 줄무늬 · 가로줄만 · 숫자 열 오른쪽 맞춤 (머리도). 본문 쪽 번호 (docx 바닥글 · pdf).
- pptx 슬라이드 layout: bullets (기본) · section (장 나눔 · 진한 바탕) · big_number {value, label} · two_column {left, right} · table · title. 내용 슬라이드 = 제목 위 강조 막대 · 오른쪽 아래 번호.
- xlsx = 머리 행 색 · 줄무늬 · 눈금선 숨김 · 정수 · 수식 = 1,234.
- 견본: `GET /api/designs` · `GET /api/designs/{id}/preview.png` (견본 PDF 표지 + 본문 첫 쪽을 나란히 · 메모리 캐시) → 설정 › 스킬 '문서 디자인' 카드 4장.
- 확인: 디자인 × docx · pptx · xlsx 를 LibreOffice 로 PDF → 쪽 그림 · pdf 는 직접 그림 (맥에 맑은 고딕이 없어 LibreOffice 확인은 Apple SD 산돌고딕 Neo 로 바꿔서).

## 화면
| 어디 | 무엇 |
|---|---|
| 답 아래 | '만든 파일' 칩 (종류 아이콘 · 이름 · 종류 크기 · 저장) → 데스크톱 = 저장 대화상자 (main `save-file.cjs` · 경로는 renderer 에 안 돌려줌) · 지워진 파일 = '지워진 파일이에요' |
| 미리보기 서랍 | PDF · 이미지 칩을 누르면 Sheet = 쪽 그림 (`GET /api/files/{id}/pages/{n}` · pypdfium2 · 서버가 64장 기억 · data: 주소) · 앞 30쪽 · 저장 |
| 도구 카드 | '파일 만들기' · 파일 이름 · '만들었어요 (답 아래에서 저장)' · 구조(JSON)는 원문 토글 뒤 |
| 설정 › 스킬 | 문서 스킬에 '쓰는 도구: 파일 만들기' · '문서 디자인' 견본 카드 4장 (견본 그림 · 이름 · 설명 · "…디자인으로 만들어 줘") |
| 개발 샘플 | '문서 파일 만들기' 묶음 (Word 회의록 · Excel 예산표 · PPT 발표 자료) |

## 테스트
- pytest test_docmake.py · test_skills.py (need 로 찾기 10가지 · 스킬 30개 = 같은 스키마) · 골든 다시 찍음 (스킬 줄 · use_skill 인자 · 스타터 수만 다름).
- E2E chat-make.spec.ts: 스킬 전 make_file 없음 → 뒤에 있음 → 칩 → 저장(BREWAI_E2E_SAVE_DIR) → 다시 열기 → 지운 파일. 스크린샷 `desktop-make-*`.
