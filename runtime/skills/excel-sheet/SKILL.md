---
name: excel-sheet
label: Excel 표
description: 목록, 수치, 일정, 예산 같은 표를 Excel(xlsx) 또는 CSV 파일로 만든다. "엑셀로", "xlsx", "스프레드시트", "표 파일로", "csv 로 뽑아 줘" 같은 요청에.
tools: [make_file]
---
# Excel 표 (make_file kind=xlsx, 단순 목록을 다른 프로그램에 넣을 때만 csv)

## 순서
1. 열을 먼저 정한다: 한 열 = 한 가지 값 (날짜, 이름, 수량, 금액 …). 머리 이름은 짧게, 단위는 머리에 (금액(원)).
2. sheets = [{"name":"시트 이름","rows":[[머리…],[값…],…]}] — 첫 행이 머리 (굵게, 고정된다).
3. 숫자는 따옴표 없이 숫자로 준다 (1200, 3.5). 날짜는 "2026-11-04" 글로.
4. 합계, 평균은 수식으로 둘 수 있다: "=SUM(B2:B10)", "=AVERAGE(C2:C10)", "=IF(D2>0,\"흑자\",\"적자\")".
   쓸 수 있는 함수: SUM AVERAGE MIN MAX COUNT COUNTA COUNTIF(S) SUMIF(S) AVERAGEIF MEDIAN PRODUCT IF IFERROR AND OR NOT ROUND(UP/DOWN) ABS INT MOD TODAY DATE YEAR MONTH DAY LEFT RIGHT MID LEN UPPER LOWER TRIM CONCAT TEXT VLOOKUP XLOOKUP INDEX MATCH. 그 밖은 글로 들어간다.
5. 시트가 여럿이면 요약 시트를 맨 앞에.
6. 답에는 시트와 열을 한 줄씩만 설명한다. 파일 주소는 쓰지 않는다.

## 하지 않는 것
- 없는 값을 채우지 않는다 (빈 칸은 ""). 다른 파일을 가리키는 수식, 링크 수식은 쓰지 않는다.
- 행이 5,000개를 넘으면 나눠서 만든다.
