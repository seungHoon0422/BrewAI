"""문서 만들기 (slice 08): make_file 모양 → docx · xlsx · pptx · md · csv (표준 zip + XML) · 거절 · 수식 허용 목록 · CSV 주입 ·
문서 스킬을 부른 뒤에만 도구 배열에 실림 · 만든 파일 = 그 대화 파일 (내 말풍선 첨부가 아님) · 다음 턴 read_file."""

from __future__ import annotations

import io
import json
import zipfile
from typing import Any
from xml.etree import ElementTree

import pytest

from conductor import docmake as dm
from conductor import files as fl
from conductor import pdfmake as pm
from conductor.skills import load_skills
from conductor.tools import SKILL_TOOLS

from .test_files import clock, items  # noqa: F401  (fixture)
from .test_tokens import Wire

DOC = {"kind": "docx", "name": "보고서", "title": "3분기 보고서", "blocks": [
    {"type": "heading", "text": "요약", "level": 1}, {"type": "paragraph", "text": "매출 **12%** 증가 <특수> & \"따옴표\"\x01"},
    {"type": "bullets", "items": ["하나", "  안쪽"]}, {"type": "numbered", "items": ["첫째"]}, {"type": "numbered", "items": ["다시 첫째"]},
    {"type": "table", "rows": [["항목", "값"], ["매출", 1200], ["비용", 800.0]]}, {"type": "pagebreak"},
]}
SHEET = {"kind": "xlsx", "name": "매출", "sheets": [{"name": "3분기", "rows": [["월", "매출"], ["7월", 400], ["합계", "=SUM(B2:B2)"],
                                                                         ["위험", "=cmd|' /C calc'!A0"], ["링크", "=HYPERLINK(\"http://x\")"]]},
                                                 {"name": "3분기", "rows": [["같은 이름"]]}]}
DECK = {"kind": "pptx", "name": "발표", "title": "실적", "subtitle": "영업팀", "slides": [
    {"title": "핵심", "bullets": ["매출 증가", "  기업 고객"]}, {"title": "수치", "rows": [["a", "b"], ["1", "2"]]},
    {"title": "둘 다", "bullets": ["설명"], "rows": [["x"], ["y"]]},
]}


def xml_parts(data: bytes) -> dict[str, ElementTree.Element]:
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        return {n: ElementTree.fromstring(z.read(n)) for n in z.namelist()}  # 모든 칸이 올바른 XML


@pytest.mark.parametrize(("spec", "kind", "must"), [
    (DOC, "docx", ["3분기 보고서", "매출 12% 증가 <특수> & \"따옴표\"", "안쪽", "1200"]),
    (SHEET, "xlsx", ["월 | 매출", "7월 | 400", "=cmd/' /C calc'!A0"]),  # 위험한 수식 = 글 (읽을 때 | → /)
    (DECK, "pptx", ["실적", "영업팀", "기업 고객", "1"]),
])
def test_office_files_are_valid_and_read_back(spec: dict[str, Any], kind: str, must: list[str]) -> None:
    made = dm.make(spec)
    assert made.kind == kind and made.name == f"{spec['name']}.{kind}" and made.mime == dm.MIME[kind]  # type: ignore[index]
    parts = xml_parts(made.data)
    assert "[Content_Types].xml" in parts and "_rels/.rels" in parts and "docProps/core.xml" in parts
    parsed = fl.parse(made.data)  # 우리 파일 읽기(slice 07)와 같은 길 = 다음 턴 read_file 로 읽힌다
    text = "\n".join(c.text for c in parsed.chunks)
    assert parsed.kind == kind
    for m in must:
        assert m in text, m
    assert "\x01" not in text
    assert dm.make(spec).data == made.data  # 같은 입력 = 같은 바이트 (저장소가 한 번만 둔다)


def test_docx_numbering_restarts_and_table_header() -> None:
    parts = xml_parts(dm.make(DOC).data)
    nums = parts["word/numbering.xml"]
    w = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    assert [n.get(f"{w}numId") for n in nums.iter(f"{w}num")] == ["1", "2", "3"]  # 글머리 1 + 번호 목록마다 새로 1부터
    assert len(list(parts["word/document.xml"].iter(f"{w}tblHeader"))) == 1


def test_xlsx_formulas_only_from_the_allowlist_and_unique_sheet_names() -> None:
    parts = xml_parts(dm.make(SHEET).data)
    s = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    formulas = [f.text for f in parts["xl/worksheets/sheet1.xml"].iter(f"{s}f")]
    assert formulas == ["SUM(B2:B2)"]  # DDE · HYPERLINK = 글로
    assert [x.get("name") for x in parts["xl/workbook.xml"].iter(f"{s}sheet")] == ["3분기", "3분기 2"]
    assert parts["xl/worksheets/sheet1.xml"].find(f"{s}sheetViews/{s}sheetView/{s}pane").get("state") == "frozen"  # type: ignore[union-attr]


def test_pptx_slides_layouts_and_table() -> None:
    made = dm.make(DECK)
    with zipfile.ZipFile(io.BytesIO(made.data)) as z:
        names = z.namelist()
        assert [n for n in names if n.startswith("ppt/slides/slide")] == [f"ppt/slides/slide{i}.xml" for i in (1, 2, 3, 4)]
        assert b"slideLayout1.xml" in z.read("ppt/slides/_rels/slide1.xml.rels")  # 표지
        assert b"slideLayout2.xml" in z.read("ppt/slides/_rels/slide2.xml.rels")
        assert b"<a:tbl>" in z.read("ppt/slides/slide3.xml") and b'lvl="1"' in z.read("ppt/slides/slide2.xml")


def test_md_and_csv() -> None:
    md = dm.make({"kind": "md", "name": "노트", "title": "회의", "blocks": [{"type": "heading", "text": "결정"}, {"type": "table", "rows": [["a|b", "c"]]}]})
    assert md.data.decode() == "# 회의\n\n## 결정\n\n| a\\|b | c |\n|---|---|\n"
    csv = dm.make({"kind": "csv", "name": "목록", "sheets": [{"rows": [["이름", "값"], ["=1+1", -3], ["@x", "-2.5"], ["+a", "ok"]]}]})
    assert csv.data.decode("utf-8-sig") == "이름,값\r\n'=1+1,-3\r\n'@x,-2.5\r\n'+a,ok\r\n"  # 수식처럼 보이는 글 = 앞에 ' · 숫자는 그대로


@pytest.mark.parametrize(("spec", "code"), [
    ({"kind": "hwp", "name": "x"}, "bad_kind"), ("x", "bad_shape"), ({"kind": "pdf", "name": "x", "blocks": [{"type": "video"}]}, "bad_block"), ({"kind": "docx", "name": "x", "blocks": [{"type": "video"}]}, "bad_block"),
    ({"kind": "docx", "name": "x", "blocks": "글"}, "bad_shape"), ({"kind": "xlsx", "name": "x"}, "empty"), ({"kind": "pptx", "name": "x"}, "empty"),
    ({"kind": "pptx", "name": "x", "slides": [{"title": str(i)} for i in range(dm.MAX_SLIDES + 1)]}, "too_large"),
    ({"kind": "xlsx", "name": "x", "sheets": [{"rows": [["a"] * (dm.MAX_COLS + 1)]}]}, "too_large"),
    ({"kind": "docx", "name": "x", "blocks": [{"type": "paragraph", "text": "가" * dm.MAX_TEXT}] * 101}, "too_large"),
    ({"kind": "xlsx", "name": "x", "sheets": [{"rows": [[{"a": 1}]]}]}, "bad_value"),
])
def test_rejections(spec: Any, code: str) -> None:
    with pytest.raises(dm.MakeError) as e:
        dm.make(spec)
    assert e.value.code == code


def test_file_name_is_cleaned() -> None:
    assert dm.make({"kind": "md", "name": '../../etc/pa:ss*wd.md', "blocks": []}).name == ".. .. etc pa ss wd.md"
    assert dm.make({"kind": "md", "name": "", "title": "제목만", "blocks": []}).name == "제목만.md"
    assert len(dm.make({"kind": "md", "name": "가" * 300, "blocks": []}).name) == 83


# ── 대화: use_skill(워드) → make_file 이 그때 실린다 → 만든 파일 = 그 대화 파일 ──

def make(make_api: Any, h: Any, wire: Wire) -> Any:
    return make_api(None, items(h), openai_client=wire.client(), skills=load_skills(h.SKILLS_DIR, known_tools=SKILL_TOOLS),
                    bootstrap_models=("fake-chat-small",))


def names(body: dict[str, Any]) -> list[str]:
    return [t["function"]["name"] for t in body.get("tools", [])]


def test_make_file_appears_only_after_a_document_skill(make_api, h, clock) -> None:  # noqa: F811
    spec = {"kind": "docx", "name": "회의록", "blocks": [{"type": "paragraph", "text": "결정: 금요일 배포"}]}

    def plan(body: dict[str, Any], n: int) -> tuple[str, Any]:
        if n == 1:
            return ("tools", [("use_skill", {"need": "회의록을 워드 파일로"})])
        if n == 2:
            return ("tools", [("make_file", spec)])
        return ("text", "회의록을 만들었어요")

    wire = Wire(plan)
    api = make(make_api, h, wire)
    events = api.chat("회의록 워드로 만들어 줘", thread="t-doc")
    assert names(wire.sent[0]) == ["use_skill"]  # 부르기 전 = make_file 정의 0
    assert names(wire.sent[1]) == ["use_skill", "make_file"] and names(wire.sent[2]) == ["use_skill", "make_file"]
    steps = [e["stepName"] for e in events if e["type"] == "STEP_STARTED"]
    assert steps == ["skill:word-doc", "tool:make_file", "writing"]
    result = json.loads([e for e in events if e["type"] == "TOOL_CALL_RESULT"][-1]["content"])
    f = result["file"]
    assert f["name"] == "회의록.docx" and f["kind"] == "docx" and f["size"] > 0
    # 파일 = 이 대화 파일 (스페이스 파일 화면 · 내려받기) · 내 말풍선 첨부는 아니다
    row = api.client.get(f"/api/files/{f['id']}").json()
    assert row["where"]["kind"] == "thread" and row["where"]["id"] == "t-doc"
    assert fl.parse(api.client.get(f"/api/files/{f['id']}/content").content).kind == "docx"
    msgs = api.client.get("/api/threads/t-doc").json()["messages"]
    assert "files" not in msgs[0]
    card = next(p for p in msgs[1]["parts"] if p.get("name") == "make_file")
    assert card["label"] == "파일 만들기" and card["result"]["file"]["id"] == f["id"] and card["status"] == "done"
    # 다음 턴: 스킬을 다시 안 불러도 make_file 이 그대로 (기록에 스킬 결과) · read_file 도 (대화에 파일이 생겼다)
    wire.plan = lambda body, n: ("text", "네")
    api.chat("고마워", thread="t-doc")
    assert names(wire.sent[-1]) == ["use_skill", "read_file", "make_file"]


def test_make_file_errors_go_back_to_the_model(make_api, h, clock) -> None:  # noqa: F811
    def plan(body: dict[str, Any], n: int) -> tuple[str, Any]:
        if n == 1:
            return ("tools", [("use_skill", {"need": "발표 자료"})])
        if n == 2:
            return ("tools", [("make_file", {"kind": "hwp", "name": "x"})])
        return ("text", "한글 파일은 안 돼요")

    wire = Wire(plan)
    api = make(make_api, h, wire)
    events = api.chat("발표 hwp 로", thread="t-bad")
    result = json.loads([e for e in events if e["type"] == "TOOL_CALL_RESULT"][-1]["content"])
    assert result["error"] == "bad_kind" and "pdf" in result["message"]
    assert api.client.get("/api/files").json() == []


def test_plain_skill_does_not_open_make_file(make_api, h, clock) -> None:  # noqa: F811
    wire = Wire(lambda body, n: ("tools", [("use_skill", {"need": "이 글 요약"})]) if n == 1 else ("text", "요약"))
    api = make(make_api, h, wire)
    api.chat("요약해 줘")
    assert names(wire.sent[1]) == ["use_skill"]  # 요약 스킬은 tools 가 없다


# ── PDF (pdfmake.py · 나눔고딕 부분 집합) ──

PDF = {"kind": "pdf", "name": "OTel 요약", "title": "OpenTelemetry 현황", "blocks": [
    {"type": "heading", "text": "핵심", "level": 1},
    {"type": "paragraph", "text": "계측은 **OTel API 로 한 번**만 한다. " + "한글은글자사이에서나뉜다" * 8 + " a-very-long-latin-word-" * 6},
    {"type": "bullets", "items": ["기여자 12,000명", "  회사 2,800곳"]}, {"type": "numbered", "items": ["첫째", "  안쪽", "둘째"]},
    {"type": "table", "rows": [["항목", "값"], ["교체 비용", "exporter 만 바꿈, 앱 코드는 그대로 둔다"], ["가격", 1200.5]]},
    {"type": "pagebreak"}, {"type": "paragraph", "text": "둘째 쪽 <특수> & \"따옴표\" 😀"},
]}
FONT_SHA = {"NanumGothic-Regular.ttf": "76f45ef4a6bcff344c837c95a7dcc26e017e38b5846d5ae0cdcb5b86be2e2d31",
            "NanumGothic-Bold.ttf": "f96298f9fb18e364d2370f4c3ce948ac67a2b61af992d7234bc15c42b033c674"}


def test_bundled_fonts_are_the_recorded_ones() -> None:
    import hashlib

    for name, sha in FONT_SHA.items():
        assert hashlib.sha256((pm.FONTS_DIR / name).read_bytes()).hexdigest() == sha, name  # runtime/fonts/README.md 와 같게
    assert (pm.FONTS_DIR / "OFL.txt").is_file()


def test_pdf_is_valid_korean_text_reads_back_and_is_deterministic() -> None:
    import pypdf

    made = dm.make(PDF)
    assert made.name == "OTel 요약.pdf" and made.mime == "application/pdf" and made.data.startswith(b"%PDF-1.7")
    reader = pypdf.PdfReader(io.BytesIO(made.data), strict=True)
    assert len(reader.pages) == 2 and reader.metadata.title == "OpenTelemetry 현황"
    parsed = fl.parse(made.data)  # 우리 파일 읽기와 같은 길 = 다음 턴 read_file
    text = "\n".join(c.text for c in parsed.chunks)
    assert parsed.kind == "pdf" and parsed.pages == 2
    for m in ("OpenTelemetry 현황", "핵심", "OTel API 로 한 번", "• 기여자 12,000명", "a. 안쪽", "2. 둘째", "exporter 만 바꿈", "1200.5", "<특수> & \"따옴표\""):
        assert m in text, m
    assert "😀" not in text and "?" in text  # 글꼴에 없는 글자 = ?
    assert dm.make(PDF).data == made.data  # 같은 입력 = 같은 바이트 (시각 · 무작위 id 없음)
    assert fl.render_pages(made.data, 2)  # pypdfium2 도 그린다


def test_pdf_embeds_only_used_glyphs() -> None:
    made = dm.make({"kind": "pdf", "name": "작은", "blocks": [{"type": "paragraph", "text": "가나다 abc"}]})
    font_size = (pm.FONTS_DIR / "NanumGothic-Regular.ttf").stat().st_size
    assert len(made.data) < font_size / 10  # 부분 집합 (원본 2MB 를 통째로 넣지 않는다)
    assert b"/FontFile2" in made.data and b"/Identity-H" in made.data and b"/ToUnicode" in made.data


def test_pdf_long_table_repeats_header_and_wraps_lines() -> None:
    rows = [["번호", "설명"]] + [[str(i), "긴 설명 " * 30] for i in range(60)]
    made = dm.make({"kind": "pdf", "name": "긴 표", "blocks": [{"type": "table", "rows": rows}]})
    parsed = fl.parse(made.data)
    assert parsed.pages and parsed.pages > 3
    assert all(c.text.lstrip().startswith("번호") for c in parsed.chunks[1:])  # 다음 쪽에 머리 행을 다시
    lines = pm.wrap([("가" * 200, False)], 100, 10, {"r": pm._font("r"), "b": pm._font("b")})
    assert len(lines) > 10 and all(len(line) for line in lines)


def test_pdf_page_limit() -> None:
    with pytest.raises(dm.MakeError) as e:
        dm.make({"kind": "pdf", "name": "x", "blocks": [{"type": "pagebreak"}] * (pm.MAX_PAGES + 1)})
    assert e.value.code == "too_large"


def test_pdf_preview_pages_endpoint(make_api, h, clock) -> None:  # noqa: F811
    spec = dict(PDF)

    def plan(body: dict[str, Any], n: int) -> tuple[str, Any]:
        if n == 1:
            return ("tools", [("use_skill", {"need": "pdf로 만들어줘"})])
        if n == 2:
            return ("tools", [("make_file", spec)])
        return ("text", "PDF 를 만들었어요")

    wire = Wire(plan)
    api = make(make_api, h, wire)
    events = api.chat("이거 pdf로 만들어줘", thread="t-pdf")
    assert [e["stepName"] for e in events if e["type"] == "STEP_STARTED"] == ["skill:pdf-doc", "tool:make_file", "writing"]
    f = json.loads([e for e in events if e["type"] == "TOOL_CALL_RESULT"][-1]["content"])["file"]
    assert f["kind"] == "pdf" and f["name"] == "OTel 요약.pdf"
    assert api.client.get(f"/api/files/{f['id']}").json()["pages"] == 2
    page = api.client.get(f"/api/files/{f['id']}/pages/1")
    assert page.status_code == 200 and page.headers["content-type"] == "image/png" and page.content.startswith(b"\x89PNG")
    assert api.client.get(f"/api/files/{f['id']}/pages/2").status_code == 200
    assert api.client.get(f"/api/files/{f['id']}/pages/3").json() == {"detail": "page_not_found"}
    assert api.client.get(f"/api/files/{f['id']}/pages/0").status_code == 422
    # 남 = 못 본다 (404 · 있는지 숨김) · PDF 가 아닌 파일 = 쪽 없음
    api.add_user("eve@brewai.test")
    eve = api.login("eve@brewai.test")
    assert eve.get(f"/api/files/{f['id']}/pages/1").status_code == 404
    docx = api.client.put("/api/files", params={"name": "a.docx"}, content=dm.make(DOC).data).json()
    assert api.client.get(f"/api/files/{docx['id']}/pages/1").status_code == 404


# ── 디자인 4종 · 꾸밈 블록 (designs.py) ──

from conductor import designs as ds  # noqa: E402

RICH = [
    {"type": "cover", "title": "3분기 사업 보고", "subtitle": "매출과 다음 분기", "date": "2026년 10월", "by": "전략기획팀"},
    {"type": "heading", "text": "요약", "level": 1},
    {"type": "kpis", "cards": [{"label": "매출", "value": "12%", "note": "지난 분기보다"}, {"label": "신규 고객", "value": "40곳"}]},
    {"type": "callout", "tone": "warn", "title": "위험", "text": "환율이 오르면 원가가 는다."},
    {"type": "quote", "text": "고객이 먼저 찾아오게", "by": "영업본부장"},
    {"type": "divider"},
    {"type": "columns", "left": [{"type": "heading", "text": "잘 된 것", "level": 3}, {"type": "bullets", "items": ["대형 계약"]}],
     "right": [{"type": "paragraph", "text": "아쉬운 것: 응답 지연"}]},
    {"type": "heading", "text": "세부 수치", "level": 2},
    {"type": "table", "rows": [["항목", "3분기"], ["매출", "1,200"], ["비용", 800]]},
]
LAYOUTS = {"title": "실적", "subtitle": "영업팀", "slides": [
    {"layout": "section", "title": "1부 성과", "subtitle": "숫자로 본 분기"}, {"layout": "big_number", "title": "매출", "value": "+12%", "label": "지난 분기보다"},
    {"layout": "two_column", "title": "비교", "left": ["좋은 점"], "right": ["아쉬운 점"]}, {"layout": "table", "title": "수치", "rows": [["a", "b"], ["1", "2"]]},
    {"title": "핵심", "bullets": ["하나", "  안쪽"]},
]}


@pytest.mark.parametrize("design", list(ds.DESIGNS))
@pytest.mark.parametrize("kind", ["docx", "pdf", "md"])
def test_every_design_renders_rich_blocks(design: str, kind: str) -> None:
    made = dm.make({"kind": kind, "name": "견본", "design": design, "blocks": RICH})
    if kind == "docx":
        xml_parts(made.data)  # 모든 칸이 올바른 XML
    text = made.data.decode() if kind == "md" else "\n".join(c.text for c in fl.parse(made.data).chunks)
    for m in ("3분기 사업 보고", "12%", "신규 고객", "위험", "고객이 먼저 찾아오게", "잘 된 것", "아쉬운 것: 응답 지연", "1,200"):
        assert m in text, (design, kind, m)
    assert dm.make({"kind": kind, "name": "견본", "design": design, "blocks": RICH}).data == made.data


@pytest.mark.parametrize("design", list(ds.DESIGNS))
def test_every_design_pptx_layouts_and_xlsx(design: str) -> None:
    made = dm.make({"kind": "pptx", "name": "덱", "design": design, **LAYOUTS})
    parts = xml_parts(made.data)
    d = ds.DESIGNS[design]
    assert f'val="{d.accent}"' in ElementTree.tostring(parts["ppt/theme/theme1.xml"], encoding="unicode")
    with zipfile.ZipFile(io.BytesIO(made.data)) as z:
        section = z.read("ppt/slides/slide2.xml").decode()
        assert "<p:bg>" in section and "1부 성과" in section  # 장 나눔 = 바탕색
        assert "+12%" in z.read("ppt/slides/slide3.xml").decode() and 'sz="8800"' in z.read("ppt/slides/slide3.xml").decode()
        two = z.read("ppt/slides/slide4.xml").decode()
        assert "좋은 점" in two and "아쉬운 점" in two
    xlsx = dm.make({"kind": "xlsx", "name": "표", "design": design, "sheets": [{"rows": [["항목", "값"], ["가", 1200], ["나", 3], ["다", 4]]}]})
    styles = ElementTree.tostring(xml_parts(xlsx.data)["xl/styles.xml"], encoding="unicode")
    assert f"FF{d.head_fill}" in styles and f"FF{d.zebra}" in styles


def test_unknown_design_is_clean_and_cover_rules() -> None:
    spec = {"kind": "pdf", "name": "x", "blocks": RICH}
    assert dm.make({**spec, "design": "neon"}).data == dm.make({**spec, "design": "clean"}).data == dm.make(spec).data
    # 표지 = 첫 쪽 (쪽 번호 없음) · 본문 첫 쪽 = 1
    chunks = fl.parse(dm.make(spec).data).chunks
    assert "3분기 사업 보고" in chunks[0].text and not chunks[0].text.rstrip().endswith("1")
    assert chunks[1].text.rstrip().endswith("1")
    # docx 표지 = 구역 둘 (표지 여백 0 · 본문 쪽 번호)
    doc = xml_parts(dm.make({**spec, "kind": "docx"}).data)["word/document.xml"]
    w = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    assert len(list(doc.iter(f"{w}sectPr"))) == 2 and len(list(doc.iter(f"{w}footerReference"))) == 1


@pytest.mark.parametrize(("blocks", "code"), [
    ([{"type": "kpis", "cards": ["12%"]}], "bad_shape"),
    ([{"type": "kpis", "cards": [{"label": str(i), "value": "1"} for i in range(dm.MAX_CARDS + 1)]}], "too_large"),
    ([{"type": "columns", "left": [{"type": "columns"}]}], "bad_block"),
    ([{"type": "columns", "left": [{"type": "cover", "title": "x"}]}], "bad_block"),
    ([{"type": "columns", "left": "글"}], "bad_shape"),
])
def test_decorative_block_rejections(blocks: list[dict[str, Any]], code: str) -> None:
    with pytest.raises(dm.MakeError) as e:
        dm.make({"kind": "docx", "name": "x", "blocks": blocks})
    assert e.value.code == code


def test_md_renders_new_blocks_plainly() -> None:
    md = dm.make({"kind": "md", "name": "노트", "blocks": RICH[:6]}).data.decode()
    assert md.startswith("# 3분기 사업 보고\n\n매출과 다음 분기\n\n2026년 10월 / 전략기획팀\n\n## 요약\n\n- **12%** 매출 (지난 분기보다)\n- **40곳** 신규 고객")
    assert "> **위험**\n> 환율이 오르면 원가가 는다." in md and "> 고객이 먼저 찾아오게\n> — 영업본부장" in md


def test_designs_api_and_preview(make_api, h, clock) -> None:  # noqa: F811
    api = make(make_api, h, Wire())
    got = api.client.get("/api/designs").json()
    assert [x["id"] for x in got] == ["clean", "report", "modern", "warm"]
    assert all(x["label"] and x["description"] and x["colors"]["accent"].startswith("#") for x in got)
    assert all("·" not in x["description"] and "·" not in x["label"] for x in got)  # 화면 글
    png = api.client.get("/api/designs/report/preview.png")
    assert png.status_code == 200 and png.headers["content-type"] == "image/png" and png.content.startswith(b"\x89PNG")
    assert api.client.get("/api/designs/neon/preview.png").status_code == 404
    assert api.anon().get("/api/designs").status_code == 401
    assert api.anon().get("/api/designs/report/preview.png").status_code == 401


def test_text_view_endpoint(make_api, h, clock) -> None:  # noqa: F811
    """뷰어 = 뽑은 글 조각 (Word · Excel · PowerPoint · 글) · 권한 = content 와 같다 (남 = 404)."""
    api = make(make_api, h, Wire())
    made = dm.make({"kind": "docx", "name": "회의록", "blocks": [{"type": "paragraph", "text": "결정: 금요일 배포"}]})
    f = api.client.put("/api/files", params={"name": made.name}, content=made.data).json()
    body = api.client.get(f"/api/files/{f['id']}/text").json()
    assert body["truncated"] is False and "금요일 배포" in "".join(c["text"] for c in body["chunks"]) and body["chunks"][0]["label"]
    api.add_user("bob@brewai.test")
    assert api.login("bob@brewai.test").get(f"/api/files/{f['id']}/text").status_code == 404
