# runtime/fonts — PDF 만들기 글꼴 (docmake.py · slice 08)

PDF 에 쓴 글자만 부분 집합으로 넣는다 (fontTools · CIDFontType2 · Identity-H). 어느 PC 에서나 같은 모양 · 같은 바이트.

| 파일 | 출처 (google/fonts main · ofl/nanumgothic) | sha256 |
|---|---|---|
| NanumGothic-Regular.ttf | https://raw.githubusercontent.com/google/fonts/main/ofl/nanumgothic/NanumGothic-Regular.ttf | 76f45ef4a6bcff344c837c95a7dcc26e017e38b5846d5ae0cdcb5b86be2e2d31 |
| NanumGothic-Bold.ttf | https://raw.githubusercontent.com/google/fonts/main/ofl/nanumgothic/NanumGothic-Bold.ttf | f96298f9fb18e364d2370f4c3ce948ac67a2b61af992d7234bc15c42b033c674 |
| OFL.txt | https://raw.githubusercontent.com/google/fonts/main/ofl/nanumgothic/OFL.txt | (라이선스 원문) |

- 라이선스 = SIL Open Font License 1.1 (OFL.txt) · OS/2 fsType 0 (설치 가능한 넣기 허용) · 받은 날 2026-11-04 (사용자 승인: 'fontTools + 나눔고딕 동봉').
- 확인: TrueType(glyf) · 1000 unitsPerEm · '가' 'A' 있음. 바꾸면 위 표와 tests/test_docmake.py 의 sha 를 같이.
