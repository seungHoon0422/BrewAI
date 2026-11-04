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
    ({"kind": "pdf", "name": "x"}, "bad_kind"), ("x", "bad_shape"), ({"kind": "docx", "name": "x", "blocks": [{"type": "video"}]}, "bad_block"),
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
            return ("tools", [("make_file", {"kind": "pdf", "name": "x"})])
        return ("text", "PDF 는 아직 안 돼요")

    wire = Wire(plan)
    api = make(make_api, h, wire)
    events = api.chat("발표 PDF 로", thread="t-bad")
    result = json.loads([e for e in events if e["type"] == "TOOL_CALL_RESULT"][-1]["content"])
    assert result["error"] == "bad_kind" and "PDF" in result["message"]
    assert api.client.get("/api/files").json() == []


def test_plain_skill_does_not_open_make_file(make_api, h, clock) -> None:  # noqa: F811
    wire = Wire(lambda body, n: ("tools", [("use_skill", {"need": "이 글 요약"})]) if n == 1 else ("text", "요약"))
    api = make(make_api, h, wire)
    api.chat("요약해 줘")
    assert names(wire.sent[1]) == ["use_skill"]  # 요약 스킬은 tools 가 없다
