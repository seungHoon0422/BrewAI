---
name: word-doc
label: Word 문서
description: 보고서, 기획서, 회의록, 안내문 같은 글을 Word(docx) 파일로 만든다. "워드로", "docx 로", "문서 파일로 만들어 줘", "보고서 파일" 같은 요청에.
tools: [make_file]
---
# Word 문서 (make_file kind=docx)

## 순서
1. 무엇을 담을지 먼저 정한다. 자료가 대화나 첨부 파일에 있으면 그것만 쓴다 (없는 숫자를 지어내지 않는다).
2. 뼈대를 잡는다: cover (표지) → heading level 1 (큰 장) → level 2 (절). 3단계까지만. design 을 고른다 (아래).
3. make_file 을 한 번 부른다. 고칠 것이 생기면 같은 name 으로 다시 부른다 (새 파일이 생긴다).
4. 답에는 무엇을 담았는지 2~3줄만 쓴다. 파일 주소나 경로는 쓰지 않는다 (답 아래 칩으로 보인다).

## blocks 쓰는 법
- 문단 = {"type":"paragraph","text":"…"} — 한 문단 3~5문장. 강조는 **굵게** 만.
- 목록 = {"type":"bullets","items":[…]}, 순서가 있으면 "numbered". 항목 앞 공백 2칸 = 한 단계 안쪽.
- 표 = {"type":"table","rows":[["머리1","머리2"],["값","값"]]} — 첫 행이 머리. 열은 6개 이하로.
- 새 쪽 = {"type":"pagebreak"} (부록 앞 등).

## 모양 (보고서 기본)
- 요약 (3줄) → 배경 → 본문 장들 → 결론과 할 일 → (부록).
- 회의록 = 일시, 참석, 안건, 결정, 할 일 (담당, 기한) 표.

## 디자인 (design)
- clean 깔끔: 흰 바탕에 회색 하나. 기본값, 무엇에나.
- report 보고서: 남색 띠 표지, 왼쪽 띠 제목. 보고, 기획서, 공문, 결과 정리.
- modern 모던: 진한 표지, 파란 포인트, 번호 붙은 제목. 발표, 제안, 기술 문서, 신제품.
- warm 따뜻함: 베이지 표지, 주황 밑줄. 안내문, 사내 소식, 행사, 교육.
- 사용자가 이름을 말했으면 ("모던으로", "보고서 디자인") 그대로. 말이 없으면 문서 성격으로 고른다. 다른 디자인으로 다시 해 달라면 같은 내용으로 design 만 바꿔 다시 부른다.

## 보기 좋게 (꾸밈 블록)
- 첫 블록 = cover {title, subtitle, date, by}. 표지가 있으면 맨 위 title 은 따로 안 써도 된다.
- 숫자가 핵심이면 kpis {cards: [{label, value, note}]} 2~4개 (value 는 짧게: "12%", "40곳").
- 꼭 읽어야 할 한 가지 = callout {tone: info | ok | warn, title, text}. 문서 하나에 1~3개만.
- 인용 = quote {text, by}, 장 사이 = divider, 비교 = columns {left: [blocks], right: [blocks]} (안에는 heading, paragraph, bullets, table, callout 만).
- 표는 첫 행이 머리. 숫자 열은 오른쪽으로 맞춰진다. 열은 6개 이하.
- 글로만 길게 쓰지 않는다: 장마다 문단 1~3개 + 목록 또는 표 또는 카드 하나.

## 하지 않는 것
- 글꼴, 색, 여백은 정하지 않는다 (design 이 정한다).
- PDF 를 원하면 Word 가 아니라 make_file kind=pdf 로 만든다 (같은 blocks, PDF 문서 스킬).
