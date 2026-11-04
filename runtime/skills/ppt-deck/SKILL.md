---
name: ppt-deck
label: 발표 자료
description: 발표, 보고, 제안용 슬라이드를 PowerPoint(pptx) 파일로 만든다. "피피티", "PPT", "pptx", "발표 자료", "슬라이드로 만들어 줘" 같은 요청에.
tools: [make_file]
---
# 발표 자료 (make_file kind=pptx, 16:9)

## 순서
1. 이야기 줄기를 먼저 잡는다: 표지 → (목차) → 문제 → 내용 3~6장 → 정리와 다음 할 일.
2. title + subtitle = 표지 (발표 제목, 누가, 언제). slides = 내용 슬라이드. design 을 고른다 (아래).
3. 슬라이드 하나 = 한 가지 말. title 은 결론을 한 줄로 ("매출 12% 증가" 처럼), bullets 는 3~6개, 한 줄 30자 안쪽.
   항목 앞 공백 2칸 = 한 단계 안쪽 (2단계까지).
4. 숫자 비교는 rows (표, 첫 행 = 머리, 열 5개, 행 8개 이하). bullets 와 rows 를 같이 주면 글은 위, 표는 아래.
5. make_file 을 한 번 부른다. 답에는 장 수와 줄기만 짧게 쓴다. 파일 주소는 쓰지 않는다.

## 슬라이드 모양 (layout)
- bullets (기본): title + bullets (+ rows 를 같이 주면 글은 위, 표는 아래).
- section: 장 나눔 슬라이드 (진한 바탕에 큰 제목, subtitle 한 줄). 3장 넘는 덩어리 앞에.
- big_number: 숫자 하나를 크게 {value: "+12%", label: "지난 분기보다"} (bullets 를 주면 오른쪽에 설명).
- two_column: 비교 {left: [..], right: [..]} (장단점, 전과 후, A 와 B).
- table: 표만 {rows}.
- 같은 모양만 이어지지 않게: 표지 → section → big_number → bullets → two_column → table 처럼 섞는다.

## 디자인 (design)
- clean 깔끔 (흰 바탕, 회색), report 보고서 (남색 왼쪽 패널 표지, 왼쪽 띠), modern 모던 (진한 표지, 파란 포인트), warm 따뜻함 (베이지 표지, 주황).
- 사용자가 이름을 말했으면 그대로. 말이 없으면: 보고, 기획 = report, 발표, 제안, 기술 = modern, 교육, 안내, 행사 = warm, 그 밖 = clean.

## 하지 않는 것
- 한 장에 글을 빽빽하게 넣지 않는다 (14줄이 한도, 6줄이 좋다).
- 그림, 차트는 아직 넣을 수 없다. 숫자는 big_number 나 표로 보여 준다. 색은 design 이 정한다.
