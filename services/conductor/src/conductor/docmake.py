"""make_file = 모델이 준 구조(JSON) → docx · xlsx · pptx · pdf · md · csv 바이트 (slice 08 · 표준 zipfile + XML · pdf = pdfmake.py + fontTools).

모델은 모양만 준다 (제목 · 제목 수준 · 문단 · 목록 · 표 · 시트 · 슬라이드). 글꼴 · 여백 · 표 테두리 = 여기서 정한 한 벌 (한글 = 맑은 고딕).
같은 입력 = 같은 바이트 (zip 시각 고정 · 만든 시각 안 넣음) → 파일 저장소가 sha256 으로 한 번만 둔다.
안전: 글은 XML 이스케이프 + XML 에 못 넣는 제어 문자 제거 · 크기 상한(블록 · 행 · 열 · 슬라이드 · 글자) · xlsx 수식 = 허용 함수만
(DDE · 외부 참조 · HYPERLINK 없음 → 그 밖은 글로) · csv = '=' '+' '-' '@' 로 시작하는 글 앞에 ' (CSV 수식 주입).
PDF = docx 와 같은 blocks → pdfmake.py (A4 · 나눔고딕 부분 집합 · 줄 나눔 · 표) · 같은 입력 = 같은 바이트.
"""

from __future__ import annotations

import csv
import io
import re
import zipfile
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal
from xml.sax.saxutils import escape as _esc

from . import pdfmake as pm

Kind = Literal["docx", "xlsx", "pptx", "pdf", "md", "csv"]
KINDS: tuple[Kind, ...] = ("docx", "xlsx", "pptx", "pdf", "md", "csv")
MAX_BLOCKS = 2_000
MAX_ROWS = 5_000
MAX_COLS = 50
MAX_SHEETS = 20
MAX_SLIDES = 60
MAX_BULLETS = 14  # 슬라이드 하나
MAX_ITEMS = 200  # 목록 하나
MAX_TEXT = 20_000  # 칸 하나
MAX_TOTAL = 2_000_000  # 글자 합
FONT_EA = "맑은 고딕"
FONT_LATIN = "Calibri"
_ZIP_TIME = (2026, 1, 1, 0, 0, 0)
_BAD_XML = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]")
_BOLD = re.compile(r"\*\*(.+?)\*\*")
_FORMULA_FN = re.compile(r"([A-Z][A-Z0-9.]*)\s*\(")
_FORMULA_OK = re.compile(r"^=[A-Za-z0-9_$:.,+\-*/^&%<>=()\" ]+$")
FORMULA_FUNCS = frozenset({
    "SUM", "AVERAGE", "MIN", "MAX", "COUNT", "COUNTA", "COUNTIF", "COUNTIFS", "SUMIF", "SUMIFS", "AVERAGEIF", "MEDIAN", "PRODUCT",
    "IF", "IFERROR", "AND", "OR", "NOT", "ROUND", "ROUNDUP", "ROUNDDOWN", "ABS", "INT", "MOD", "TODAY", "DATE", "YEAR", "MONTH", "DAY",
    "LEFT", "RIGHT", "MID", "LEN", "UPPER", "LOWER", "TRIM", "CONCAT", "TEXT", "VLOOKUP", "XLOOKUP", "INDEX", "MATCH",
})
MIME: dict[Kind, str] = {
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "pdf": "application/pdf",
    "md": "text/markdown",
    "csv": "text/csv",
}

# 도구 정의 (문서 스킬을 불렀을 때만 도구 배열에 실린다 · agent._SkillGatedTools)
MAKE_FILE = "make_file"
MAKE_FILE_DESC = (
    "Word(docx) · Excel(xlsx) · PowerPoint(pptx) · PDF · md · csv 파일을 만들어 이 대화에 붙인다. 모양만 준다 (글꼴 · 여백 · 테두리는 서버가). "
    "docx · pdf · md = blocks · xlsx · csv = sheets (첫 행 = 머리) · pptx = title/subtitle(표지) + slides. 글 안 **굵게** 가능 · 목록 항목 앞 공백 2칸 = 한 단계 안쪽. "
    "만든 파일은 답 아래 칩으로 저절로 보인다 (주소 · 경로를 적지 않는다)."
)
_CELLS = {"type": "array", "items": {"type": "array", "items": {"type": "string"}}}
MAKE_FILE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": list(KINDS)},
        "name": {"type": "string", "description": "파일 이름 (확장자 없이)"},
        "title": {"type": "string"},
        "subtitle": {"type": "string", "description": "pptx 표지 아래 줄"},
        "blocks": {"type": "array", "items": {"type": "object", "properties": {
            "type": {"type": "string", "enum": ["heading", "paragraph", "bullets", "numbered", "table", "pagebreak"]},
            "text": {"type": "string"}, "level": {"type": "integer", "description": "heading 1~3"},
            "items": {"type": "array", "items": {"type": "string"}}, "rows": _CELLS,
        }, "required": ["type"]}},
        "sheets": {"type": "array", "items": {"type": "object", "properties": {"name": {"type": "string"}, "rows": _CELLS}, "required": ["rows"]}},
        "slides": {"type": "array", "items": {"type": "object", "properties": {
            "title": {"type": "string"}, "bullets": {"type": "array", "items": {"type": "string"}}, "rows": _CELLS,
        }, "required": ["title"]}},
    },
    "required": ["kind", "name"],
}


class MakeError(Exception):
    """모델에게 돌려줄 거절 (code · 한 줄 사유)."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message


@dataclass(frozen=True)
class Made:
    kind: Kind
    name: str  # 확장자 포함
    data: bytes
    mime: str


# ── 입력 정리 ──

class _Budget:
    def __init__(self) -> None:
        self.used = 0

    def text(self, v: Any) -> str:
        if v is None:
            return ""
        if isinstance(v, bool):
            s = "TRUE" if v else "FALSE"
        elif isinstance(v, (int, float)):
            s = _num_text(v)
        elif isinstance(v, str):
            s = v
        else:
            raise MakeError("bad_value", "칸 값은 글 또는 숫자여야 한다")
        s = _BAD_XML.sub("", s.replace("\r\n", "\n"))[:MAX_TEXT]
        self.used += len(s)
        if self.used > MAX_TOTAL:
            raise MakeError("too_large", f"글이 너무 많다 (합 {MAX_TOTAL:,}자까지)")
        return s


def _num_text(v: float) -> str:
    return str(int(v)) if isinstance(v, float) and v.is_integer() and abs(v) < 1e15 else str(v)


def _list(v: Any, what: str, limit: int) -> list[Any]:
    if v is None:
        return []
    if not isinstance(v, list):
        raise MakeError("bad_shape", f"{what} 는 배열이어야 한다")
    if len(v) > limit:
        raise MakeError("too_large", f"{what} 는 {limit}개까지")
    return v


def _rows(v: Any, b: _Budget) -> list[list[Any]]:
    rows = []
    for r in _list(v, "rows", MAX_ROWS):
        cells = _list(r if isinstance(r, list) else [r], "행의 칸", MAX_COLS)
        rows.append([c if isinstance(c, (int, float)) and not isinstance(c, bool) else b.text(c) for c in cells])
    width = max((len(r) for r in rows), default=0)
    return [r + [""] * (width - len(r)) for r in rows]


def _x(s: str) -> str:
    return _esc(s, {'"': "&quot;"})


def _runs(text: str) -> list[tuple[str, bool]]:
    """'**굵게**' → [(글, 굵게?)]."""
    out: list[tuple[str, bool]] = []
    pos = 0
    for m in _BOLD.finditer(text):
        if m.start() > pos:
            out.append((text[pos : m.start()], False))
        out.append((m.group(1), True))
        pos = m.end()
    if pos < len(text):
        out.append((text[pos:], False))
    return out or [("", False)]


def _indent(item: str) -> tuple[int, str]:
    """목록 항목 앞 공백 2칸 = 한 단계 (최대 2단계)."""
    n = len(item) - len(item.lstrip(" "))
    return min(n // 2, 2), item.strip().removeprefix("- ").removeprefix("• ").strip()


def _zip(parts: Sequence[tuple[str, str]]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, body in parts:
            info = zipfile.ZipInfo(name, date_time=_ZIP_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + body)
    return buf.getvalue()


_CT = "http://schemas.openxmlformats.org/package/2006/content-types"
_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
_ODR = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
_S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
_A = "http://schemas.openxmlformats.org/drawingml/2006/main"
_P = "http://schemas.openxmlformats.org/presentationml/2006/main"


def _types(overrides: Sequence[tuple[str, str]]) -> str:
    o = "".join(f'<Override PartName="{p}" ContentType="{t}"/>' for p, t in overrides)
    return (f'<Types xmlns="{_CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            f'<Default Extension="xml" ContentType="application/xml"/>{o}</Types>')


def _rels(items: Sequence[tuple[str, str, str]]) -> str:
    r = "".join(f'<Relationship Id="{i}" Type="{t}" Target="{target}"/>' for i, t, target in items)
    return f'<Relationships xmlns="{_REL}">{r}</Relationships>'


def _core(title: str) -> str:
    return ('<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
            'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" '
            'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
            f'<dc:title>{_x(title)}</dc:title><dc:creator>BrewAI</dc:creator></cp:coreProperties>')


_CORE_CT = ("/docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml")
_CORE_REL = ("rId2", "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", "docProps/core.xml")


# ── docx ──

def _w_runs(text: str, *, bold: bool = False) -> str:
    out = []
    for chunk, strong in _runs(text):
        lines = chunk.split("\n")
        rpr = "<w:rPr><w:b/><w:bCs/></w:rPr>" if (strong or bold) else ""
        body = "<w:br/>".join(f'<w:t xml:space="preserve">{_x(line)}</w:t>' for line in lines)
        out.append(f"<w:r>{rpr}{body}</w:r>")
    return "".join(out)


def _w_p(text: str, style: str | None = None, num: tuple[int, int] | None = None, *, bold: bool = False) -> str:
    ppr = ""
    if style or num:
        ppr = "<w:pPr>" + (f'<w:pStyle w:val="{style}"/>' if style else "")
        if num:
            ppr += f'<w:numPr><w:ilvl w:val="{num[0]}"/><w:numId w:val="{num[1]}"/></w:numPr>'
        ppr += "</w:pPr>"
    return f"<w:p>{ppr}{_w_runs(text, bold=bold)}</w:p>"


_TEXT_W = 9026  # A4 (11906) - 여백 1440 × 2 (twip)


def _w_table(rows: list[list[Any]], b: _Budget) -> str:
    if not rows:
        return ""
    cols = len(rows[0])
    w = _TEXT_W // max(cols, 1)
    grid = "".join(f'<w:gridCol w:w="{w}"/>' for _ in range(cols))
    trs = []
    for i, row in enumerate(rows):
        head = i == 0 and len(rows) > 1
        tcs = []
        for c in row:
            shd = '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>' if head else ""
            tcs.append(f'<w:tc><w:tcPr><w:tcW w:w="{w}" w:type="dxa"/>{shd}</w:tcPr>{_w_p(b.text(c), bold=head)}</w:tc>')
        trpr = "<w:trPr><w:tblHeader/></w:trPr>" if head else ""
        trs.append(f"<w:tr>{trpr}{''.join(tcs)}</w:tr>")
    return (f'<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/>'
            f'<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>'
            f"<w:tblGrid>{grid}</w:tblGrid>{''.join(trs)}</w:tbl>")


def _docx_styles() -> str:
    heads = "".join(
        f'<w:style w:type="paragraph" w:styleId="Heading{n}"><w:name w:val="heading {n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/>'
        f'<w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="{280 - n * 40}" w:after="120"/><w:outlineLvl w:val="{n - 1}"/></w:pPr>'
        f'<w:rPr><w:b/><w:bCs/><w:sz w:val="{36 - n * 4}"/><w:szCs w:val="{36 - n * 4}"/></w:rPr></w:style>'
        for n in (1, 2, 3)
    )
    border = "".join(f'<w:{e} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>' for e in ("top", "left", "bottom", "right", "insideH", "insideV"))
    return (
        f'<w:styles xmlns:w="{_W}"><w:docDefaults><w:rPrDefault><w:rPr>'
        f'<w:rFonts w:ascii="{FONT_LATIN}" w:hAnsi="{FONT_LATIN}" w:eastAsia="{FONT_EA}" w:cs="{FONT_LATIN}"/>'
        '<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="ko-KR" w:eastAsia="ko-KR" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>'
        '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="288" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
        '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>'
        '<w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>'
        f"{heads}"
        '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/>'
        '<w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>'
        '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/>'
        '<w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/>'
        '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>'
        '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="39"/>'
        f'<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:tblPr><w:tblBorders>{border}</w:tblBorders></w:tblPr></w:style>'
        "</w:styles>"
    )


def _docx_numbering(numbered: int) -> str:
    def lvls(fmt: str) -> str:
        out = []
        for i in range(3):
            text = ("•", "◦", "▪")[i] if fmt == "bullet" else f"%{i + 1}."
            out.append(f'<w:lvl w:ilvl="{i}"><w:start w:val="1"/><w:numFmt w:val="{"bullet" if fmt == "bullet" else ("decimal", "lowerLetter", "lowerRoman")[i]}"/>'
                       f'<w:lvlText w:val="{text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="{720 * (i + 1)}" w:hanging="360"/></w:pPr></w:lvl>')
        return "".join(out)

    nums = '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' + "".join(
        f'<w:num w:numId="{i + 2}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>'
        for i in range(numbered)
    )
    return (f'<w:numbering xmlns:w="{_W}">'
            f'<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>{lvls("bullet")}</w:abstractNum>'
            f'<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>{lvls("decimal")}</w:abstractNum>'
            f"{nums}</w:numbering>")


def _docx(spec: dict[str, Any], b: _Budget) -> bytes:
    body: list[str] = []
    title = b.text(spec.get("title"))
    if title:
        body.append(_w_p(title, "Title"))
    numbered = 0
    for blk in _list(spec.get("blocks"), "blocks", MAX_BLOCKS):
        if not isinstance(blk, dict):
            raise MakeError("bad_shape", "blocks 의 칸은 객체여야 한다")
        t = blk.get("type")
        if t == "heading":
            level = blk.get("level") if isinstance(blk.get("level"), int) else 1
            body.append(_w_p(b.text(blk.get("text")), f"Heading{min(max(level, 1), 3)}"))
        elif t == "paragraph":
            body.append(_w_p(b.text(blk.get("text"))))
        elif t in ("bullets", "numbered"):
            num = 1
            if t == "numbered":
                numbered += 1
                num = numbered + 1
            for item in _list(blk.get("items"), "items", MAX_ITEMS):
                lvl, text = _indent(b.text(item))
                body.append(_w_p(text, "ListParagraph", (lvl, num)))
        elif t == "table":
            body.append(_w_table(_rows(blk.get("rows"), b), b))
            body.append("<w:p/>")
        elif t == "pagebreak":
            body.append('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
        else:
            raise MakeError("bad_block", f"모르는 block type '{str(t)[:20]}' (heading · paragraph · bullets · numbered · table · pagebreak)")
    if not body:
        body.append("<w:p/>")
    sect = ('<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
            '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>')
    doc = f'<w:document xmlns:w="{_W}" xmlns:r="{_ODR}"><w:body>{"".join(body)}{sect}</w:body></w:document>'
    main = "application/vnd.openxmlformats-officedocument.wordprocessingml"
    return _zip([
        ("[Content_Types].xml", _types([("/word/document.xml", f"{main}.document.main+xml"), ("/word/styles.xml", f"{main}.styles+xml"),
                                        ("/word/numbering.xml", f"{main}.numbering+xml"), _CORE_CT])),
        ("_rels/.rels", _rels([("rId1", f"{_ODR}/officeDocument", "word/document.xml"), _CORE_REL])),
        ("word/_rels/document.xml.rels", _rels([("rId1", f"{_ODR}/styles", "styles.xml"), ("rId2", f"{_ODR}/numbering", "numbering.xml")])),
        ("word/document.xml", doc),
        ("word/styles.xml", _docx_styles()),
        ("word/numbering.xml", _docx_numbering(numbered)),
        ("docProps/core.xml", _core(title or str(spec.get("name") or ""))),
    ])


# ── xlsx ──

def _col(i: int) -> str:
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def _width(v: Any) -> float:
    s = v if isinstance(v, str) else _num_text(v)
    first = s.split("\n", 1)[0]
    return sum(2 if ord(ch) > 0x2E7F else 1 for ch in first)


def _safe_formula(s: str) -> bool:
    return bool(_FORMULA_OK.match(s)) and all(f in FORMULA_FUNCS for f in _FORMULA_FN.findall(s.upper()))


def _sheet_name(raw: str, i: int, used: set[str]) -> str:
    name = re.sub(r"[\[\]:*?/\\]", " ", raw).strip().strip("'")[:31] or f"시트{i + 1}"
    base, n = name, 2
    while name.lower() in used:
        name = f"{base[:28]} {n}"
        n += 1
    used.add(name.lower())
    return name


def _xlsx_sheet(rows: list[list[Any]]) -> str:
    out = []
    for r, row in enumerate(rows):
        cells = []
        for c, v in enumerate(row):
            ref = f"{_col(c)}{r + 1}"
            style = ' s="1"' if r == 0 and len(rows) > 1 else (' s="2"' if isinstance(v, str) and "\n" in v else "")
            if isinstance(v, (int, float)):
                cells.append(f'<c r="{ref}"{style}><v>{_num_text(v)}</v></c>')
            elif v == "":
                continue
            elif v.startswith("=") and _safe_formula(v):
                cells.append(f'<c r="{ref}"{style}><f>{_x(v[1:])}</f></c>')
            else:
                cells.append(f'<c r="{ref}"{style} t="inlineStr"><is><t xml:space="preserve">{_x(v)}</t></is></c>')
        out.append(f'<row r="{r + 1}">{"".join(cells)}</row>')
    cols = len(rows[0]) if rows else 0
    widths = "".join(
        f'<col min="{c + 1}" max="{c + 1}" width="{min(max(max((_width(row[c]) for row in rows), default=8) + 2, 8), 60):.0f}" customWidth="1"/>'
        for c in range(cols)
    )
    pane = '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' if len(rows) > 1 else ""
    return (f'<worksheet xmlns="{_S}" xmlns:r="{_ODR}"><sheetViews><sheetView workbookViewId="0">{pane}</sheetView></sheetViews>'
            f'<sheetFormatPr defaultRowHeight="16.5"/>{f"<cols>{widths}</cols>" if widths else ""}<sheetData>{"".join(out)}</sheetData></worksheet>')


def _xlsx_styles() -> str:
    font = f'<sz val="11"/><name val="{FONT_EA}"/><family val="2"/><charset val="129"/>'
    return (f'<styleSheet xmlns="{_S}"><fonts count="2"><font>{font}</font><font><b/>{font}</font></fonts>'
            '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
            '<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill></fills>'
            '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
            '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
            '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
            '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
            '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>'
            '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>')


def _sheets(spec: dict[str, Any], b: _Budget) -> list[tuple[str, list[list[Any]]]]:
    used: set[str] = set()
    out = []
    for i, sh in enumerate(_list(spec.get("sheets"), "sheets", MAX_SHEETS)):
        if not isinstance(sh, dict):
            raise MakeError("bad_shape", "sheets 의 칸은 객체여야 한다")
        out.append((_sheet_name(b.text(sh.get("name")), i, used), _rows(sh.get("rows"), b)))
    if not out:
        raise MakeError("empty", "sheets 가 비어 있다 (첫 행 = 머리)")
    return out


def _xlsx(spec: dict[str, Any], b: _Budget) -> bytes:
    sheets = _sheets(spec, b)
    main = "application/vnd.openxmlformats-officedocument.spreadsheetml"
    n = len(sheets)
    wb = (f'<workbook xmlns="{_S}" xmlns:r="{_ODR}"><bookViews><workbookView/></bookViews><sheets>'
          + "".join(f'<sheet name="{_x(name)}" sheetId="{i + 1}" r:id="rId{i + 1}"/>' for i, (name, _) in enumerate(sheets))
          + "</sheets></workbook>")
    return _zip([
        ("[Content_Types].xml", _types([("/xl/workbook.xml", f"{main}.sheet.main+xml"), ("/xl/styles.xml", f"{main}.styles+xml"),
                                        *((f"/xl/worksheets/sheet{i + 1}.xml", f"{main}.worksheet+xml") for i in range(n)), _CORE_CT])),
        ("_rels/.rels", _rels([("rId1", f"{_ODR}/officeDocument", "xl/workbook.xml"), _CORE_REL])),
        ("xl/workbook.xml", wb),
        ("xl/_rels/workbook.xml.rels", _rels([*((f"rId{i + 1}", f"{_ODR}/worksheet", f"worksheets/sheet{i + 1}.xml") for i in range(n)),
                                              (f"rId{n + 1}", f"{_ODR}/styles", "styles.xml")])),
        ("xl/styles.xml", _xlsx_styles()),
        *((f"xl/worksheets/sheet{i + 1}.xml", _xlsx_sheet(rows)) for i, (_, rows) in enumerate(sheets)),
        ("docProps/core.xml", _core(b.text(spec.get("title")) or str(spec.get("name") or ""))),
    ])


# ── pptx (16:9 · 표지 + 제목과 내용 두 레이아웃) ──

_NS_P = f'xmlns:a="{_A}" xmlns:r="{_ODR}" xmlns:p="{_P}"'
_SLIDE_W, _SLIDE_H = 12192000, 6858000
_BODY_X, _BODY_Y, _BODY_W, _BODY_H = 838200, 1825625, 10515600, 4351338
_GRP = ('<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/>'
        '<a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>')


def _a_runs(text: str, *, size: int | None = None, bold: bool = False) -> str:
    out = []
    for chunk, strong in _runs(text.replace("\n", " ")):
        attrs = ' lang="ko-KR" altLang="en-US"' + (f' sz="{size}"' if size else "") + (' b="1"' if strong or bold else "")
        out.append(f"<a:r><a:rPr{attrs} dirty=\"0\"/><a:t>{_x(chunk)}</a:t></a:r>")
    return "".join(out)


def _a_level(lvl: int) -> str:
    """안쪽 단계 = 들여쓰기 · 글머리표를 슬라이드에 직접 (레이아웃 상속을 안 따르는 프로그램이 있다 · LibreOffice)."""
    if not lvl:
        return ""
    char = ("–", "•")[lvl - 1]
    return (f'<a:pPr marL="{228600 + 457200 * lvl}" lvl="{lvl}" indent="-228600"><a:buFont typeface="Arial"/>'
            f'<a:buChar char="{char}"/></a:pPr>')


def _ph(sid: int, name: str, ph: str, paras: str, xfrm: str = "", body_pr: str = "<a:bodyPr/>") -> str:
    return (f'<p:sp><p:nvSpPr><p:cNvPr id="{sid}" name="{name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>{ph}</p:nvPr></p:nvSpPr>'
            f"<p:spPr>{xfrm}</p:spPr><p:txBody>{body_pr}<a:lstStyle/>{paras}</p:txBody></p:sp>")


def _xfrm(x: int, y: int, w: int, h: int) -> str:
    return f'<a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{w}" cy="{h}"/></a:xfrm>'


def _a_table(rows: list[list[Any]], b: _Budget, y: int, h: int, sid: int) -> str:
    cols = len(rows[0])
    cw = _BODY_W // cols
    rh = min(370840, h // max(len(rows), 1))
    size = 1400 if len(rows) <= 8 else 1100
    line = "".join(f'<a:{e} w="12700"><a:solidFill><a:srgbClr val="BFBFBF"/></a:solidFill></a:{e}>' for e in ("lnL", "lnR", "lnT", "lnB"))
    trs = []
    for i, row in enumerate(rows):
        head = i == 0 and len(rows) > 1
        fill = '<a:solidFill><a:srgbClr val="F2F2F2"/></a:solidFill>' if head else ""
        tcs = "".join(
            f'<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p>{_a_runs(b.text(c), size=size, bold=head)}</a:p></a:txBody>'
            f'<a:tcPr marL="91440" marR="91440" marT="45720" marB="45720">{line}{fill}</a:tcPr></a:tc>'
            for c in row
        )
        trs.append(f'<a:tr h="{rh}">{tcs}</a:tr>')
    grid = "".join(f'<a:gridCol w="{cw}"/>' for _ in range(cols))
    return (f'<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="{sid}" name="Table {sid}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/>'
            f'</p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="{_BODY_X}" y="{y}"/><a:ext cx="{cw * cols}" cy="{rh * len(rows)}"/></p:xfrm>'
            f'<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/>'
            f"<a:tblGrid>{grid}</a:tblGrid>{''.join(trs)}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>")


def _slide(inner: str) -> str:
    return f'<p:sld {_NS_P}><p:cSld><p:spTree>{_GRP}{inner}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>'


def _content_slide(s: dict[str, Any], b: _Budget) -> str:
    title = _ph(2, "Title 1", '<p:ph type="title"/>', f"<a:p>{_a_runs(b.text(s.get('title')))}</a:p>")
    bullets = [_indent(b.text(x)) for x in _list(s.get("bullets"), "bullets", MAX_BULLETS)]
    rows = _rows(s.get("rows"), b)
    parts = [title]
    table_y, table_h = _BODY_Y, _BODY_H
    if bullets:
        paras = "".join("<a:p>" + _a_level(lvl) + _a_runs(t) + "</a:p>" for lvl, t in bullets)
        xfrm = ""
        if rows:  # 글 + 표 = 글은 위 1/3
            xfrm = _xfrm(_BODY_X, _BODY_Y, _BODY_W, _BODY_H // 3)
            table_y, table_h = _BODY_Y + _BODY_H // 3 + 120000, _BODY_H - _BODY_H // 3 - 120000
        parts.append(_ph(3, "Content 2", '<p:ph idx="1"/>', paras, xfrm, "<a:bodyPr><a:normAutofit/></a:bodyPr>"))
    if rows:
        parts.append(_a_table(rows, b, table_y, table_h, 4))
    return _slide("".join(parts))


def _title_slide(title: str, subtitle: str) -> str:
    sub = _ph(3, "Subtitle 2", '<p:ph type="subTitle" idx="1"/>', f"<a:p>{_a_runs(subtitle)}</a:p>") if subtitle else ""
    return _slide(_ph(2, "Title 1", '<p:ph type="ctrTitle"/>', f"<a:p>{_a_runs(title)}</a:p>") + sub)


def _master() -> str:
    title = _ph(2, "Title Placeholder 1", '<p:ph type="title"/>', '<a:p><a:endParaRPr lang="ko-KR"/></a:p>',
                _xfrm(_BODY_X, 365125, _BODY_W, 1325563) + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>', '<a:bodyPr anchor="ctr"><a:normAutofit/></a:bodyPr>')
    body = _ph(3, "Text Placeholder 2", '<p:ph type="body" idx="1"/>', '<a:p><a:endParaRPr lang="ko-KR"/></a:p>',
               _xfrm(_BODY_X, _BODY_Y, _BODY_W, _BODY_H) + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>', "<a:bodyPr><a:normAutofit/></a:bodyPr>")

    def lvl(n: int, size: int) -> str:
        mar = 228600 + 457200 * (n - 1)
        char = ("•", "–", "•")[n - 1]
        return (f'<a:lvl{n}pPr marL="{mar}" indent="-228600" algn="l"><a:lnSpc><a:spcPct val="100000"/></a:lnSpc><a:spcBef><a:spcPts val="1000"/></a:spcBef>'
                f'<a:buFont typeface="Arial"/><a:buChar char="{char}"/><a:defRPr sz="{size}"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill>'
                f'<a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl{n}pPr>')

    return (f'<p:sldMaster {_NS_P}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>{_GRP}{title}{body}</p:spTree></p:cSld>'
            '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" '
            'accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
            '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/><p:sldLayoutId id="2147483650" r:id="rId2"/></p:sldLayoutIdLst>'
            '<p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPct val="0"/></a:spcBef><a:buNone/>'
            '<a:defRPr sz="3600" b="1"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/>'
            '<a:cs typeface="+mj-cs"/></a:defRPr></a:lvl1pPr></p:titleStyle>'
            f"<p:bodyStyle>{lvl(1, 2400)}{lvl(2, 2000)}{lvl(3, 1800)}</p:bodyStyle>"
            '<p:otherStyle><a:defPPr><a:defRPr lang="ko-KR"/></a:defPPr></p:otherStyle></p:txStyles></p:sldMaster>')


def _layout(kind: str) -> str:
    if kind == "title":
        inner = (_ph(2, "Title 1", '<p:ph type="ctrTitle"/>', '<a:p><a:endParaRPr lang="ko-KR"/></a:p>', _xfrm(1524000, 1122363, 9144000, 2387600),
                     '<a:bodyPr anchor="b"><a:normAutofit/></a:bodyPr>').replace("<a:lstStyle/>", '<a:lstStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="4800"/></a:lvl1pPr></a:lstStyle>')
                 + _ph(3, "Subtitle 2", '<p:ph type="subTitle" idx="1"/>', '<a:p><a:endParaRPr lang="ko-KR"/></a:p>', _xfrm(1524000, 3602038, 9144000, 1655762))
                 .replace("<a:lstStyle/>", '<a:lstStyle><a:lvl1pPr marL="0" indent="0" algn="ctr"><a:buNone/><a:defRPr sz="2400"/></a:lvl1pPr></a:lstStyle>'))
        name, typ = "Title Slide", "title"
    else:
        inner = (_ph(2, "Title 1", '<p:ph type="title"/>', '<a:p><a:endParaRPr lang="ko-KR"/></a:p>')
                 + _ph(3, "Content Placeholder 2", '<p:ph idx="1"/>', '<a:p><a:endParaRPr lang="ko-KR"/></a:p>'))
        name, typ = "Title and Content", "obj"
    return (f'<p:sldLayout {_NS_P} type="{typ}" preserve="1"><p:cSld name="{name}"><p:spTree>{_GRP}{inner}</p:spTree></p:cSld>'
            "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>")


def _theme() -> str:
    colors = (("dk1", '<a:sysClr val="windowText" lastClr="000000"/>'), ("lt1", '<a:sysClr val="window" lastClr="FFFFFF"/>'),
              ("dk2", '<a:srgbClr val="1F2937"/>'), ("lt2", '<a:srgbClr val="F3F4F6"/>'), ("accent1", '<a:srgbClr val="2563EB"/>'),
              ("accent2", '<a:srgbClr val="0D9488"/>'), ("accent3", '<a:srgbClr val="D97706"/>'), ("accent4", '<a:srgbClr val="7C3AED"/>'),
              ("accent5", '<a:srgbClr val="DC2626"/>'), ("accent6", '<a:srgbClr val="4B5563"/>'), ("hlink", '<a:srgbClr val="2563EB"/>'),
              ("folHlink", '<a:srgbClr val="7C3AED"/>'))
    clr = "".join(f"<a:{k}>{v}</a:{k}>" for k, v in colors)
    font = f'<a:latin typeface="{FONT_LATIN}"/><a:ea typeface="{FONT_EA}"/><a:cs typeface=""/><a:font script="Hang" typeface="{FONT_EA}"/>'
    solid = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
    fills = solid * 3
    lines = "".join(f'<a:ln w="{w}" cap="flat" cmpd="sng" algn="ctr">{solid}<a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>' for w in (6350, 12700, 19050))
    effects = "<a:effectStyle><a:effectLst/></a:effectStyle>" * 3
    return (f'<a:theme xmlns:a="{_A}" name="BrewAI"><a:themeElements><a:clrScheme name="BrewAI">{clr}</a:clrScheme>'
            f'<a:fontScheme name="BrewAI"><a:majorFont>{font}</a:majorFont><a:minorFont>{font}</a:minorFont></a:fontScheme>'
            f'<a:fmtScheme name="BrewAI"><a:fillStyleLst>{fills}</a:fillStyleLst><a:lnStyleLst>{lines}</a:lnStyleLst>'
            f"<a:effectStyleLst>{effects}</a:effectStyleLst><a:bgFillStyleLst>{fills}</a:bgFillStyleLst></a:fmtScheme>"
            "</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>")


def _pptx(spec: dict[str, Any], b: _Budget) -> bytes:
    slides: list[tuple[str, int]] = []  # (xml, 레이아웃 번호)
    title, subtitle = b.text(spec.get("title")), b.text(spec.get("subtitle"))
    if title:
        slides.append((_title_slide(title, subtitle), 1))
    for s in _list(spec.get("slides"), "slides", MAX_SLIDES):
        if not isinstance(s, dict):
            raise MakeError("bad_shape", "slides 의 칸은 객체여야 한다")
        slides.append((_content_slide(s, b), 2))
    if not slides:
        raise MakeError("empty", "slides 가 비어 있다 (title 만 주면 표지 한 장)")
    if len(slides) > MAX_SLIDES:
        raise MakeError("too_large", f"슬라이드는 {MAX_SLIDES}장까지")
    main = "application/vnd.openxmlformats-officedocument.presentationml"
    n = len(slides)
    pres = (f'<p:presentation {_NS_P} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>'
            "<p:sldIdLst>" + "".join(f'<p:sldId id="{256 + i}" r:id="rId{10 + i}"/>' for i in range(n)) + "</p:sldIdLst>"
            f'<p:sldSz cx="{_SLIDE_W}" cy="{_SLIDE_H}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>')
    layout_rel = f"{_ODR}/slideLayout"
    return _zip([
        ("[Content_Types].xml", _types([
            ("/ppt/presentation.xml", f"{main}.presentation.main+xml"), ("/ppt/slideMasters/slideMaster1.xml", f"{main}.slideMaster+xml"),
            ("/ppt/slideLayouts/slideLayout1.xml", f"{main}.slideLayout+xml"), ("/ppt/slideLayouts/slideLayout2.xml", f"{main}.slideLayout+xml"),
            ("/ppt/theme/theme1.xml", "application/vnd.openxmlformats-officedocument.theme+xml"),
            ("/ppt/presProps.xml", f"{main}.presProps+xml"), ("/ppt/viewProps.xml", f"{main}.viewProps+xml"),
            ("/ppt/tableStyles.xml", f"{main}.tableStyles+xml"),
            *((f"/ppt/slides/slide{i + 1}.xml", f"{main}.slide+xml") for i in range(n)), _CORE_CT,
        ])),
        ("_rels/.rels", _rels([("rId1", f"{_ODR}/officeDocument", "ppt/presentation.xml"), _CORE_REL])),
        ("ppt/presentation.xml", pres),
        ("ppt/_rels/presentation.xml.rels", _rels([
            ("rId1", f"{_ODR}/slideMaster", "slideMasters/slideMaster1.xml"), ("rId2", f"{_ODR}/theme", "theme/theme1.xml"),
            ("rId3", f"{_ODR}/presProps", "presProps.xml"), ("rId4", f"{_ODR}/viewProps", "viewProps.xml"),
            ("rId5", f"{_ODR}/tableStyles", "tableStyles.xml"),
            *((f"rId{10 + i}", f"{_ODR}/slide", f"slides/slide{i + 1}.xml") for i in range(n)),
        ])),
        ("ppt/presProps.xml", f"<p:presentationPr {_NS_P}/>"),
        ("ppt/viewProps.xml", f'<p:viewPr {_NS_P}><p:gridSpacing cx="72008" cy="72008"/></p:viewPr>'),
        ("ppt/tableStyles.xml", f'<a:tblStyleLst xmlns:a="{_A}" def="{{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}}"/>'),
        ("ppt/theme/theme1.xml", _theme()),
        ("ppt/slideMasters/slideMaster1.xml", _master()),
        ("ppt/slideMasters/_rels/slideMaster1.xml.rels", _rels([
            ("rId1", layout_rel, "../slideLayouts/slideLayout1.xml"), ("rId2", layout_rel, "../slideLayouts/slideLayout2.xml"),
            ("rId3", f"{_ODR}/theme", "../theme/theme1.xml"),
        ])),
        ("ppt/slideLayouts/slideLayout1.xml", _layout("title")),
        ("ppt/slideLayouts/slideLayout2.xml", _layout("obj")),
        ("ppt/slideLayouts/_rels/slideLayout1.xml.rels", _rels([("rId1", f"{_ODR}/slideMaster", "../slideMasters/slideMaster1.xml")])),
        ("ppt/slideLayouts/_rels/slideLayout2.xml.rels", _rels([("rId1", f"{_ODR}/slideMaster", "../slideMasters/slideMaster1.xml")])),
        *((f"ppt/slides/slide{i + 1}.xml", xml) for i, (xml, _) in enumerate(slides)),
        *((f"ppt/slides/_rels/slide{i + 1}.xml.rels", _rels([("rId1", layout_rel, f"../slideLayouts/slideLayout{lay}.xml")]))
          for i, (_, lay) in enumerate(slides)),
        ("docProps/core.xml", _core(title or str(spec.get("name") or ""))),
    ])


# ── md · csv ──

def _md_cell(v: Any) -> str:
    s = v if isinstance(v, str) else _num_text(v)
    return s.replace("|", "\\|").replace("\n", " ")


def _md(spec: dict[str, Any], b: _Budget) -> bytes:
    out: list[str] = []
    title = b.text(spec.get("title"))
    if title:
        out.append(f"# {title}")
    for blk in _list(spec.get("blocks"), "blocks", MAX_BLOCKS):
        if not isinstance(blk, dict):
            raise MakeError("bad_shape", "blocks 의 칸은 객체여야 한다")
        t = blk.get("type")
        if t == "heading":
            level = blk.get("level") if isinstance(blk.get("level"), int) else 1
            out.append("#" * (min(max(level, 1), 3) + (1 if title else 0)) + " " + b.text(blk.get("text")))
        elif t == "paragraph":
            out.append(b.text(blk.get("text")))
        elif t in ("bullets", "numbered"):
            lines = []
            for i, item in enumerate(_list(blk.get("items"), "items", MAX_ITEMS)):
                lvl, text = _indent(b.text(item))
                lines.append("   " * lvl + (f"{i + 1}. " if t == "numbered" and not lvl else "- ") + text)
            out.append("\n".join(lines))
        elif t == "table":
            rows = _rows(blk.get("rows"), b)
            if rows:
                lines = ["| " + " | ".join(_md_cell(c) for c in rows[0]) + " |", "|" + "---|" * len(rows[0])]
                lines += ["| " + " | ".join(_md_cell(c) for c in r) + " |" for r in rows[1:]]
                out.append("\n".join(lines))
        elif t == "pagebreak":
            out.append("---")
        else:
            raise MakeError("bad_block", f"모르는 block type '{str(t)[:20]}'")
    return ("\n\n".join(out) + "\n").encode("utf-8")


def _csv_cell(v: Any) -> str:
    if isinstance(v, (int, float)):
        return _num_text(v)
    return "'" + v if v[:1] in ("=", "+", "-", "@", "\t", "\r") and not _is_number(v) else v


def _is_number(s: str) -> bool:
    try:
        float(s)
    except ValueError:
        return False
    return True


def _csv(spec: dict[str, Any], b: _Budget) -> bytes:
    _, rows = _sheets(spec, b)[0]
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    for r in rows:
        w.writerow([_csv_cell(c) for c in r])
    return ("\ufeff" + buf.getvalue()).encode("utf-8")  # BOM = Excel 이 한글을 바로 읽는다


def _pdf(spec: dict[str, Any], b: _Budget) -> bytes:
    """docx 와 같은 blocks → pdfmake 블록 (번호 목록 = 단계마다 1. · a. · i.) → PDF."""
    out: list[pm.Block] = []
    title = b.text(spec.get("title"))
    if title:
        out.append(("title", _runs(title)))
    for blk in _list(spec.get("blocks"), "blocks", MAX_BLOCKS):
        if not isinstance(blk, dict):
            raise MakeError("bad_shape", "blocks 의 칸은 객체여야 한다")
        t = blk.get("type")
        if t == "heading":
            level = blk.get("level") if isinstance(blk.get("level"), int) else 1
            out.append(("heading", min(max(level, 1), 3), _runs(b.text(blk.get("text")))))
        elif t == "paragraph":
            out.append(("para", _runs(b.text(blk.get("text")))))
        elif t in ("bullets", "numbered"):
            counts = [0, 0, 0]
            for item in _list(blk.get("items"), "items", MAX_ITEMS):
                lvl, text = _indent(b.text(item))
                counts[lvl] += 1
                for deeper in range(lvl + 1, 3):
                    counts[deeper] = 0
                marker = ("•", "◦", "–")[lvl] if t == "bullets" else _number(counts[lvl], lvl)
                out.append(("item", lvl, marker, _runs(text)))
        elif t == "table":
            rows = _rows(blk.get("rows"), b)
            if rows:
                out.append(("table", [[c if isinstance(c, str) else _num_text(c) for c in r] for r in rows]))
        elif t == "pagebreak":
            out.append(("pagebreak",))
        else:
            raise MakeError("bad_block", f"모르는 block type '{str(t)[:20]}' (heading · paragraph · bullets · numbered · table · pagebreak)")
    try:
        return pm.render(out, title=title or str(spec.get("name") or ""))
    except pm.PdfError as e:
        raise MakeError(e.code, e.message) from e


def _number(n: int, lvl: int) -> str:
    if lvl == 0:
        return f"{n}."
    if lvl == 1:
        return f"{chr(96 + min(n, 26))}."
    roman = ("i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x")
    return f"{roman[n - 1] if n <= len(roman) else n}."


_WRITERS = {"docx": _docx, "xlsx": _xlsx, "pptx": _pptx, "pdf": _pdf, "md": _md, "csv": _csv}


def make(spec: Any) -> Made:
    """make_file 인자 → 파일. 틀리면 MakeError (모델에게 한 줄로 돌려준다)."""
    if not isinstance(spec, dict):
        raise MakeError("bad_shape", "인자는 객체여야 한다")
    kind = spec.get("kind")
    if kind not in KINDS:
        raise MakeError("bad_kind", f"kind 는 {', '.join(KINDS)} 중 하나")
    b = _Budget()
    raw = b.text(spec.get("name")).strip() or b.text(spec.get("title")).strip() or "문서"
    stem = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', " ", raw).strip().removesuffix(f".{kind}").strip()[:80] or "문서"
    data = _WRITERS[kind](spec, b)
    return Made(kind=kind, name=f"{stem}.{kind}", data=data, mime=MIME[kind])
