---
name: pdf-doc
label: PDF 문서
description: 대화에서 나온 내용이나 첨부 파일을 PDF 파일로 만든다. "PDF로", "pdf 파일", "pdf로 만들어 줘", "PDF로 내보내기", "인쇄용 문서" 같은 요청에.
tools: [make_file]
---
# PDF 문서 (make_file kind=pdf, A4)

## 순서
1. 다시 묻지 않는다. 앞 답, 앞에서 찾은 자료, 첨부 파일 내용으로 바로 만든다 ("이걸 PDF로" = 바로 앞 답).
   자료가 정말 없을 때만 무엇을 담을지 한 줄로 묻는다.
2. Canva 같은 앱 도구로 만들지 않는다. PDF 는 make_file kind=pdf 하나로 만든다 (앱에서 내보내기를 기다리지 않는다).
3. 뼈대: cover (표지) → heading level 1 (큰 장) → level 2 (절). 숫자, 날짜, 이름은 대화에 나온 그대로.
   확인하지 못한 내용은 넣지 않거나 "확인 필요" 로 적는다. 출처가 있으면 마지막에 "출처" 장으로.
4. blocks 는 Word 와 같다: paragraph (강조는 **굵게**), bullets, numbered (항목 앞 공백 2칸 = 안쪽), table, pagebreak + 아래 꾸밈 블록. design 을 꼭 고른다.
5. make_file 을 한 번 부른다. 답에는 무엇을 담았는지 2~3줄만 쓴다. 파일 주소나 경로, 내려받는 방법은 쓰지 않는다 (답 아래 칩을 누르면 미리보기와 저장이 된다).

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
- 그림과 차트는 아직 넣을 수 없다. 필요하면 표로 대신한다.
