"""make_file = 모델이 준 구조(JSON) → docx · xlsx · pptx · pdf · md · csv 바이트 (slice 08 · 표준 zipfile + XML · pdf = pdfmake.py + fontTools).

모델은 모양과 디자인 이름만 준다 (표지 · 제목 · 문단 · 목록 · 표 · 숫자 카드 · 강조 상자 · 인용 · 두 단 · 시트 · 슬라이드).
색 · 글꼴 · 여백 · 표 모양 = designs.py 의 디자인 한 벌 (깔끔 · 보고서 · 모던 · 따뜻함 · 모르는 이름 = 깔끔 · 한글 = 맑은 고딕).
같은 입력 = 같은 바이트 (zip 시각 고정 · 만든 시각 안 넣음) → 파일 저장소가 sha256 으로 한 번만 둔다.
안전: 글은 XML 이스케이프 + XML 에 못 넣는 제어 문자 제거 · 크기 상한(블록 · 행 · 열 · 슬라이드 · 글자) · xlsx 수식 = 허용 함수만
(DDE · 외부 참조 · HYPERLINK 없음 → 그 밖은 글로) · csv = '=' '+' '-' '@' 로 시작하는 글 앞에 ' (CSV 수식 주입).
PDF = docx 와 같은 blocks → pdfmake.py (A4 · 나눔고딕 부분 집합 · 줄 나눔 · 표 · 디자인) · 같은 입력 = 같은 바이트.
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

from . import designs as ds
from . import pdfmake as pm
from .designs import Design

Kind = Literal["docx", "xlsx", "pptx", "pdf", "md", "csv"]
KINDS: tuple[Kind, ...] = ("docx", "xlsx", "pptx", "pdf", "md", "csv")
MAX_BLOCKS = 2_000
MAX_ROWS = 5_000
MAX_COLS = 50
MAX_SHEETS = 20
MAX_SLIDES = 60
MAX_BULLETS = 14  # 슬라이드 하나
MAX_ITEMS = 200  # 목록 하나
MAX_CARDS = 4  # 숫자 카드 한 줄
MAX_TEXT = 20_000  # 칸 하나
MAX_TOTAL = 2_000_000  # 글자 합
FONT_EA = "맑은 고딕"
FONT_LATIN = "Calibri"
_ZIP_TIME = (2026, 1, 1, 0, 0, 0)
_BAD_XML = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]")
_BOLD = re.compile(r"\*\*(.+?)\*\*")
_FORMULA_FN = re.compile(r"([A-Z][A-Z0-9.]*)\s*\(")
_FORMULA_OK = re.compile(r"^=[A-Za-z0-9_$:.,+\-*/^&%<>=()\" ]+$")
_NUMERIC = re.compile(r"^[\s+\-−]?[$₩€¥]?\s?[\d,.]+\s?(%|원|명|개|곳|건|배|점|만|억|천|[kKmMbB])?$")
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
BLOCK_TYPES = ("cover", "heading", "paragraph", "bullets", "numbered", "table", "kpis", "callout", "quote", "divider", "columns", "pagebreak")
SLIDE_LAYOUTS = ("bullets", "title", "section", "big_number", "two_column", "table")
_IN_COLUMN = ("heading", "para", "list", "table", "callout", "quote", "divider")  # 두 단 안에 둘 수 있는 블록 (정리한 이름)

# 도구 정의 (문서 스킬을 불렀을 때만 도구 배열에 실린다 · agent.skill_toolset)
MAKE_FILE = "make_file"
MAKE_FILE_DESC = (
    "Word(docx) · Excel(xlsx) · PowerPoint(pptx) · PDF · md · csv 파일을 만들어 이 대화에 붙인다. 내용과 모양만 준다 (색 · 글꼴 · 여백은 design 이). "
    "design = clean 깔끔 | report 보고서 | modern 모던 | warm 따뜻함. docx · pdf · md = blocks (cover 표지 · kpis 숫자 카드 cards[{label,value,note}] · "
    "callout 강조 상자 tone info|ok|warn · quote · divider · columns left/right=blocks) · xlsx · csv = sheets (첫 행 = 머리) · "
    "pptx = title/subtitle(표지) + slides (layout bullets|section|big_number value/label|two_column left/right|table rows). "
    "글 안 **굵게** · 목록 항목 앞 공백 2칸 = 한 단계 안쪽. 만든 파일은 답 아래 칩으로 저절로 보인다 (주소 · 경로를 적지 않는다)."
)
_CELLS = {"type": "array", "items": {"type": "array", "items": {"type": "string"}}}
_STRS = {"type": "array", "items": {"type": "string"}}
MAKE_FILE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": list(KINDS)},
        "name": {"type": "string", "description": "파일 이름 (확장자 없이)"},
        "design": {"type": "string", "enum": list(ds.DESIGNS)},
        "title": {"type": "string"},
        "subtitle": {"type": "string"},
        "blocks": {"type": "array", "items": {"type": "object", "properties": {
            "type": {"type": "string", "enum": list(BLOCK_TYPES)},
            "text": {"type": "string"}, "level": {"type": "integer", "description": "heading 1~3"}, "items": _STRS, "rows": _CELLS,
            "title": {"type": "string"}, "subtitle": {"type": "string"}, "date": {"type": "string"}, "by": {"type": "string"},
            "tone": {"type": "string", "enum": ["info", "ok", "warn"]},
            "cards": {"type": "array", "items": {"type": "object", "properties": {
                "label": {"type": "string"}, "value": {"type": "string"}, "note": {"type": "string"}}, "required": ["label", "value"]}},
            "left": {"type": "array", "items": {"type": "object"}}, "right": {"type": "array", "items": {"type": "object"}},
        }, "required": ["type"]}},
        "sheets": {"type": "array", "items": {"type": "object", "properties": {"name": {"type": "string"}, "rows": _CELLS}, "required": ["rows"]}},
        "slides": {"type": "array", "items": {"type": "object", "properties": {
            "layout": {"type": "string", "enum": list(SLIDE_LAYOUTS)}, "title": {"type": "string"}, "subtitle": {"type": "string"},
            "bullets": _STRS, "rows": _CELLS, "value": {"type": "string"}, "label": {"type": "string"}, "left": _STRS, "right": _STRS,
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


def _str_rows(rows: list[list[Any]]) -> list[list[str]]:
    return [[c if isinstance(c, str) else _num_text(c) for c in r] for r in rows]


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


def _plain(text: str) -> str:
    return _BOLD.sub(r"\1", text)


def _indent(item: str) -> tuple[int, str]:
    """목록 항목 앞 공백 2칸 = 한 단계 (최대 2단계)."""
    n = len(item) - len(item.lstrip(" "))
    return min(n // 2, 2), item.strip().removeprefix("- ").removeprefix("• ").strip()


def _numeric(col: Sequence[str]) -> bool:
    return bool(col) and all(_NUMERIC.match(v or "0") for v in col)


# 정리한 블록 (docx · pdf · md 가 같이 쓴다):
# ("title", 글) · ("cover", 제목, 부제, 날짜, 쓴 곳) · ("heading", 수준, 글) · ("para", 글) · ("list", 번호?, [(단계, 글)]) · ("table", 행들)
# · ("kpis", [(이름, 값, 설명)]) · ("callout", tone, 제목, 글) · ("quote", 글, 누가) · ("divider",) · ("columns", 왼쪽, 오른쪽) · ("pagebreak",)
Norm = tuple[Any, ...]


def _blocks(raw: Any, b: _Budget, *, nested: bool = False) -> list[Norm]:
    out: list[Norm] = []
    for blk in _list(raw, "blocks", MAX_BLOCKS):
        if not isinstance(blk, dict):
            raise MakeError("bad_shape", "blocks 의 칸은 객체여야 한다")
        t = blk.get("type")
        txt = lambda k: b.text(blk.get(k))  # noqa: E731
        n: Norm
        if t == "heading":
            level = blk.get("level") if isinstance(blk.get("level"), int) else 1
            n = ("heading", min(max(level, 1), 3), txt("text"))
        elif t == "paragraph":
            n = ("para", txt("text"))
        elif t in ("bullets", "numbered"):
            n = ("list", t == "numbered", [_indent(b.text(i)) for i in _list(blk.get("items"), "items", MAX_ITEMS)])
        elif t == "table":
            rows = _rows(blk.get("rows"), b)
            if not rows:
                continue
            n = ("table", _str_rows(rows))
        elif t == "pagebreak":
            n = ("pagebreak",)
        elif t == "cover":
            n = ("cover", txt("title"), txt("subtitle") or txt("text"), txt("date"), txt("by"))
        elif t == "kpis":
            cards = []
            for c in _list(blk.get("cards") if blk.get("cards") is not None else blk.get("items"), "cards", MAX_CARDS):
                if not isinstance(c, dict):
                    raise MakeError("bad_shape", "kpis 의 cards 는 {label, value, note?} 객체다")
                cards.append((b.text(c.get("label")), b.text(c.get("value")), b.text(c.get("note"))))
            if not cards:
                continue
            n = ("kpis", cards)
        elif t == "callout":
            tone = blk.get("tone") if blk.get("tone") in ("info", "ok", "warn") else "info"
            n = ("callout", tone, txt("title"), txt("text"))
        elif t == "quote":
            n = ("quote", txt("text"), txt("by"))
        elif t == "divider":
            n = ("divider",)
        elif t == "columns":
            if nested:
                raise MakeError("bad_block", "두 단(columns) 안에 두 단을 또 넣을 수 없다")
            n = ("columns", _blocks(blk.get("left"), b, nested=True), _blocks(blk.get("right"), b, nested=True))
        else:
            raise MakeError("bad_block", f"모르는 block type '{str(t)[:20]}' ({', '.join(BLOCK_TYPES)})")
        if nested and n[0] not in _IN_COLUMN:
            raise MakeError("bad_block", "두 단 안에는 heading · paragraph · bullets · numbered · table · callout · quote · divider 만")
        out.append(n)
    return out


def _doc_blocks(spec: dict[str, Any], b: _Budget) -> tuple[str, list[Norm]]:
    """문서 제목 + 블록. 표지가 있으면 제목 줄을 따로 넣지 않는다 (표지 제목이 비면 문서 제목 · 파일 이름)."""
    title = b.text(spec.get("title"))
    blocks = _blocks(spec.get("blocks"), b)
    if any(x[0] == "cover" for x in blocks):
        fallback = title or str(spec.get("name") or "")
        blocks = [("cover", x[1] or fallback, *x[2:]) if x[0] == "cover" else x for x in blocks]
    elif title:
        blocks = [("title", title), *blocks]
    return title, blocks


def _heading_numbers(blocks: Sequence[Norm]) -> dict[int, str]:
    """번호 붙은 제목 (모던): 1단계 = 01 · 02 · 2단계 = 1.1 · 1.2 (3단계는 번호 없음)."""
    out: dict[int, str] = {}
    h1 = h2 = 0
    for i, x in enumerate(blocks):
        if x[0] == "heading" and x[1] == 1:
            h1, h2 = h1 + 1, 0
            out[i] = f"{h1:02d}"
        elif x[0] == "heading" and x[1] == 2:
            h2 += 1
            out[i] = f"{max(h1, 1)}.{h2}"
    return out


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


# ── docx (A4 · 디자인 = styles.xml 색 · 제목 장식 · 표 · 표지 구역) ──

_PAGE_W, _PAGE_H, _MARGIN = 11906, 16838, 1300
_TEXT_W = _PAGE_W - _MARGIN * 2  # twip


def _w_rpr(*, bold: bool = False, color: str | None = None, size: int | None = None) -> str:
    inner = ("<w:b/><w:bCs/>" if bold else "") + (f'<w:color w:val="{color}"/>' if color else "") + (f'<w:sz w:val="{size}"/><w:szCs w:val="{size}"/>' if size else "")
    return f"<w:rPr>{inner}</w:rPr>" if inner else ""


def _w_runs(text: str, *, bold: bool = False, color: str | None = None, size: int | None = None) -> str:
    out = []
    for chunk, strong in _runs(text):
        lines = chunk.split("\n")
        body = "<w:br/>".join(f'<w:t xml:space="preserve">{_x(line)}</w:t>' for line in lines)
        out.append(f"<w:r>{_w_rpr(bold=strong or bold, color=color, size=size)}{body}</w:r>")
    return "".join(out)


def _w_p(text: str, style: str | None = None, num: tuple[int, int] | None = None, *, bold: bool = False, color: str | None = None,
         size: int | None = None, ppr: str = "", prefix: str = "") -> str:
    inner = (f'<w:pStyle w:val="{style}"/>' if style else "")
    if num:
        inner += f'<w:numPr><w:ilvl w:val="{num[0]}"/><w:numId w:val="{num[1]}"/></w:numPr>'
    inner += ppr
    return f"<w:p>{f'<w:pPr>{inner}</w:pPr>' if inner else ''}{prefix}{_w_runs(text, bold=bold, color=color, size=size)}</w:p>"


def _w_borders(tag: str, sides: dict[str, tuple[int, str]]) -> str:
    """sides = {top: (sz, 색) …} · 나머지 = 없음."""
    names = ("top", "left", "bottom", "right") + (("insideH", "insideV") if tag == "tblBorders" else ())
    return f"<w:{tag}>" + "".join(
        f'<w:{n} w:val="single" w:sz="{sides[n][0]}" w:space="0" w:color="{sides[n][1]}"/>' if n in sides else f'<w:{n} w:val="nil"/>' for n in names
    ) + f"</w:{tag}>"


def _w_tc(content: str, width: int, *, fill: str | None = None, borders: str = "", mar: str = "", valign: str = "") -> str:
    tcpr = f'<w:tcW w:w="{width}" w:type="dxa"/>{borders}' + (f'<w:shd w:val="clear" w:color="auto" w:fill="{fill}"/>' if fill else "") + mar
    tcpr += f'<w:vAlign w:val="{valign}"/>' if valign else ""
    return f"<w:tc><w:tcPr>{tcpr}</w:tcPr>{content or '<w:p/>'}</w:tc>"


def _w_mar(top: int, left: int, bottom: int, right: int) -> str:
    return (f'<w:tcMar><w:top w:w="{top}" w:type="dxa"/><w:left w:w="{left}" w:type="dxa"/><w:bottom w:w="{bottom}" w:type="dxa"/>'
            f'<w:right w:w="{right}" w:type="dxa"/></w:tcMar>')


def _w_tbl(rows: str, widths: Sequence[int], *, borders: str, width: int | None = None, ind: int = 0, spacing: int = 0, look: str = "") -> str:
    total = width if width is not None else sum(widths)
    grid = "".join(f'<w:gridCol w:w="{w}"/>' for w in widths)
    return (f'<w:tbl><w:tblPr><w:tblW w:w="{total}" w:type="dxa"/>' + (f'<w:tblCellSpacing w:w="{spacing}" w:type="dxa"/>' if spacing else "")
            + f'<w:tblInd w:w="{ind}" w:type="dxa"/>{borders}<w:tblLayout w:type="fixed"/>'
            + '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>'
            + (look or '<w:tblLook w:val="0000" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/>')
            + f"</w:tblPr><w:tblGrid>{grid}</w:tblGrid>{rows}</w:tbl>")


def _col_widths(rows: list[list[str]], total: int) -> list[int]:
    def wid(s: str) -> int:
        return sum(2 if ord(ch) > 0x2E7F else 1 for ch in s.split("\n", 1)[0])

    cols = len(rows[0])
    weights = [min(max((wid(r[c]) for r in rows), default=4), 40) + 4 for c in range(cols)]
    s = sum(weights) or 1
    out = [max(600, total * w // s) for w in weights]
    out[-1] += total - sum(out)
    return out


def _w_data_table(rows: list[list[str]], d: Design, total: int = _TEXT_W) -> str:
    widths = _col_widths(rows, total)
    head = len(rows) > 1
    num = [_numeric([r[c] for r in rows[1 if head else 0 :]]) for c in range(len(rows[0]))]
    trs = []
    for i, row in enumerate(rows):
        is_head = head and i == 0
        fill = d.head_fill if is_head else (d.zebra if (i % 2 == 0 if head else i % 2 == 1) else None)
        tcs = []
        for c, v in enumerate(row):
            jc = '<w:jc w:val="right"/>' if num[c] else ""
            p = _w_p(v, ppr=f'<w:spacing w:before="0" w:after="0" w:line="276" w:lineRule="auto"/>{jc}', bold=is_head,
                     color=d.head_text if is_head else None, size=19)
            tcs.append(_w_tc(p, widths[c], fill=fill, mar=_w_mar(90, 130, 90, 130), valign="center"))
        trpr = "<w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>" if is_head else "<w:trPr><w:cantSplit/></w:trPr>"
        trs.append(f"<w:tr>{trpr}{''.join(tcs)}</w:tr>")
    borders = _w_borders("tblBorders", {"top": (8, d.head_fill if d.head_fill != "FFFFFF" else d.rule), "bottom": (8, d.rule), "insideH": (4, d.rule)})
    look = '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>'
    return _w_tbl("".join(trs), widths, borders=borders, look=look, ind=130) + '<w:p><w:pPr><w:spacing w:after="60"/></w:pPr></w:p>'


def _w_bar(color: str, width: int = 900, height: int = 70) -> str:
    """짧은 색 막대 (표지 · 제목 아래)."""
    row = f'<w:tr><w:trPr><w:trHeight w:val="{height}" w:hRule="exact"/></w:trPr>{_w_tc("<w:p/>", width, fill=color)}</w:tr>'
    return _w_tbl(row, [width], borders=_w_borders("tblBorders", {}))


def _w_cover(d: Design, title: str, subtitle: str, date: str, by: str) -> str:
    """표지 = 첫 구역 (여백 0 · 쪽 하나를 채우는 표) → 구역 나눔. 모양 = 디자인 cover."""
    W = _PAGE_W
    meta = "   |   ".join(x for x in (date, by) if x)
    bar = _w_bar(d.accent)
    t = _w_p(title, ppr='<w:spacing w:before="240" w:after="160" w:line="300" w:lineRule="auto"/>', bold=True, color=d.cover_text, size=60)
    s = _w_p(subtitle, ppr='<w:spacing w:after="0"/>', color=d.cover_sub, size=28) if subtitle else ""
    m = _w_p(meta, ppr=('<w:pBdr><w:top w:val="single" w:sz="6" w:space="12" w:color="' + d.rule + '"/></w:pBdr>' if d.cover in ("none", "band") else "")
             + '<w:spacing w:after="0"/>', color=d.cover_sub, size=20) if meta else ""
    fill = d.cover_bg if d.cover in ("dark", "tint") else None
    pad = _w_mar(0, _MARGIN + 100, 0, _MARGIN + 100)
    rows: list[tuple[int, str, str | None, str]] = []  # (높이, 내용, 바탕, 세로 맞춤)
    if d.cover == "band":
        rows = [(3300, "<w:p/>", d.cover_bg, ""), (140, "<w:p/>", d.soft, ""),
                (10200, f'<w:p><w:pPr><w:spacing w:before="1600"/></w:pPr></w:p>{bar}{t}{s}', None, ""), (2900, m, None, "center")]
    elif d.cover in ("dark", "tint"):
        rows = [(1200, "<w:p/>", fill, ""), (11600, f"{bar}{t}{s}", fill, "bottom"), (3740, m, fill, "center")]
    else:
        rows = [(4400, "<w:p/>", None, ""), (9200, f"{bar}{t}{s}", None, ""), (2940, m, None, "center")]
    trs = "".join(f'<w:tr><w:trPr><w:trHeight w:val="{h}" w:hRule="exact"/><w:cantSplit/></w:trPr>{_w_tc(c, W, fill=f, mar=pad, valign=v)}</w:tr>'
                  for h, c, f, v in rows)
    sect = ('<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr>'
            f'<w:sectPr><w:pgSz w:w="{_PAGE_W}" w:h="{_PAGE_H}"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/>'
            '</w:sectPr></w:pPr></w:p>')
    return _w_tbl(trs, [W], borders=_w_borders("tblBorders", {}), ind=_MARGIN + 100) + sect


def _w_kpis(cards: Sequence[tuple[str, str, str]], d: Design, total: int = _TEXT_W) -> str:
    """숫자 카드 = 칸마다 옅은 바탕 · 칸 사이 = 흰 세로 테두리 (칸 간격은 LibreOffice 가 무시한다)."""
    n = len(cards)
    cw = total // n
    tcs = []
    for label, value, note in cards:
        body = (_w_p(label, ppr='<w:spacing w:after="40"/>', color=d.muted, size=17)
                + _w_p(value, ppr='<w:spacing w:after="20" w:line="240" w:lineRule="auto"/>', bold=True, color=d.accent, size=40)
                + (_w_p(note, ppr='<w:spacing w:after="0"/>', color=d.muted, size=16) if note else ""))
        tcs.append(_w_tc(body, cw, fill=d.soft, mar=_w_mar(200, 240, 200, 240)))
    row = f"<w:tr><w:trPr><w:cantSplit/></w:trPr>{''.join(tcs)}</w:tr>"
    return (_w_tbl(row, [cw] * n, borders=_w_borders("tblBorders", {"insideV": (48, "FFFFFF")}), width=total, ind=240)
            + '<w:p><w:pPr><w:spacing w:after="80"/></w:pPr></w:p>')


def _w_callout(tone: str, title: str, text: str, d: Design, total: int = _TEXT_W) -> str:
    bar, bg = ds.tone(d, tone)
    body = (_w_p(title, ppr='<w:spacing w:after="60"/>', bold=True, color=d.ink) if title else "") + _w_p(text, ppr='<w:spacing w:after="0"/>')
    tc = _w_tc(body, total, fill=bg, borders=_w_borders("tcBorders", {"left": (24, bar)}), mar=_w_mar(160, 260, 160, 240))
    return (_w_tbl(f"<w:tr><w:trPr><w:cantSplit/></w:trPr>{tc}</w:tr>", [total], borders=_w_borders("tblBorders", {}), ind=260)
            + '<w:p><w:pPr><w:spacing w:after="80"/></w:pPr></w:p>')


def _w_quote(text: str, by: str, d: Design) -> str:
    bdr = f'<w:pBdr><w:left w:val="single" w:sz="18" w:space="12" w:color="{d.accent}"/></w:pBdr><w:ind w:left="300"/>'
    out = _w_p(text, ppr=f'{bdr}<w:spacing w:before="160" w:after="60" w:line="340" w:lineRule="auto"/>', color=d.ink, size=25)
    if by:
        out += _w_p(f"— {by}", ppr=f'{bdr}<w:spacing w:after="200"/>', color=d.muted, size=18)
    return out


def _w_divider(d: Design) -> str:
    return f'<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="{d.rule}"/></w:pBdr><w:spacing w:before="120" w:after="240"/></w:pPr></w:p>'


class _Numbering:
    """번호 목록마다 1부터 (w:num 하나씩 · 글머리 = numId 1)."""

    def __init__(self) -> None:
        self.count = 0

    def next(self) -> int:
        self.count += 1
        return self.count + 1


def _w_body(blocks: Sequence[Norm], d: Design, nums: _Numbering, total: int = _TEXT_W) -> str:
    numbers = _heading_numbers(blocks) if d.heading == "number" else {}
    out: list[str] = []
    for i, x in enumerate(blocks):
        k = x[0]
        if k == "title":
            out.append(_w_p(x[1], "Title"))
        elif k == "cover":
            out.append(_w_cover(d, x[1], x[2], x[3], x[4]))
        elif k == "heading":
            num = numbers.get(i)
            prefix = f'<w:r>{_w_rpr(bold=True, color=d.accent)}<w:t xml:space="preserve">{num}   </w:t></w:r>' if num else ""
            out.append(_w_p(x[2], f"Heading{x[1]}", prefix=prefix))
        elif k == "para":
            out.append(_w_p(x[1]))
        elif k == "list":
            num_id = nums.next() if x[1] else 1
            out.extend(_w_p(text, "ListParagraph", (lvl, num_id)) for lvl, text in x[2])
        elif k == "table":
            out.append(_w_data_table(x[1], d, total))
        elif k == "kpis":
            out.append(_w_kpis(x[1], d, total))
        elif k == "callout":
            out.append(_w_callout(x[1], x[2], x[3], d, total))
        elif k == "quote":
            out.append(_w_quote(x[1], x[2], d))
        elif k == "divider":
            out.append(_w_divider(d))
        elif k == "columns":
            gap = 360
            cw = (total - gap) // 2
            left = _w_body(x[1], d, nums, cw) or "<w:p/>"
            right = _w_body(x[2], d, nums, cw) or "<w:p/>"
            end = '<w:p><w:pPr><w:spacing w:after="0" w:line="60" w:lineRule="exact"/></w:pPr></w:p>'
            tcs = (_w_tc(left + end, cw + gap // 2, mar=_w_mar(0, 0, 0, gap // 2), valign="top")
                   + _w_tc(right + end, cw + gap // 2, mar=_w_mar(0, gap // 2, 0, 0), valign="top"))
            out.append(_w_tbl(f"<w:tr>{tcs}</w:tr>", [cw + gap // 2] * 2, borders=_w_borders("tblBorders", {}))
                       + '<w:p><w:pPr><w:spacing w:after="0" w:line="120" w:lineRule="exact"/></w:pPr></w:p>')
        elif k == "pagebreak":
            out.append('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
    return "".join(out)


def _docx_styles(d: Design) -> str:
    def heading(n: int, size: int, before: int, after: int, extra: str = "", color: str | None = None) -> str:
        return (f'<w:style w:type="paragraph" w:styleId="Heading{n}"><w:name w:val="heading {n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/>'
                f'<w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/>{extra}'
                f'<w:spacing w:before="{before}" w:after="{after}" w:line="276" w:lineRule="auto"/><w:outlineLvl w:val="{n - 1}"/></w:pPr>'
                f'<w:rPr><w:b/><w:bCs/><w:color w:val="{color or d.ink}"/><w:sz w:val="{size}"/><w:szCs w:val="{size}"/></w:rPr></w:style>')

    h1 = h2 = ""
    if d.heading == "bar":
        h1 = f'<w:pBdr><w:left w:val="single" w:sz="36" w:space="10" w:color="{d.accent}"/></w:pBdr><w:ind w:left="230"/>'
        h2 = f'<w:pBdr><w:left w:val="single" w:sz="18" w:space="9" w:color="{d.accent}"/></w:pBdr><w:ind w:left="200"/>'
    elif d.heading == "number":
        h1 = f'<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="6" w:color="{d.rule}"/></w:pBdr>'
    elif d.heading == "underline":
        h1 = f'<w:pBdr><w:bottom w:val="single" w:sz="16" w:space="5" w:color="{d.accent}"/></w:pBdr>'
    return (
        f'<w:styles xmlns:w="{_W}"><w:docDefaults><w:rPrDefault><w:rPr>'
        f'<w:rFonts w:ascii="{FONT_LATIN}" w:hAnsi="{FONT_LATIN}" w:eastAsia="{FONT_EA}" w:cs="{FONT_LATIN}"/>'
        f'<w:color w:val="{d.text}"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="ko-KR" w:eastAsia="ko-KR" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>'
        '<w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="320" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
        '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>'
        f'<w:pPr><w:pBdr><w:bottom w:val="single" w:sz="12" w:space="10" w:color="{d.accent}"/></w:pBdr><w:spacing w:after="360" w:line="276" w:lineRule="auto"/></w:pPr>'
        f'<w:rPr><w:b/><w:bCs/><w:color w:val="{d.ink}"/><w:sz w:val="48"/><w:szCs w:val="48"/></w:rPr></w:style>'
        + heading(1, 34, 480, 180, h1) + heading(2, 26, 340, 120, h2) + heading(3, 22, 240, 80, color=d.accent)
        + '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/>'
        '<w:pPr><w:spacing w:after="70"/><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>'
        '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/>'
        '<w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/>'
        '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>'
        "</w:styles>"
    )


def _docx_numbering(numbered: int, d: Design) -> str:
    def lvls(fmt: str) -> str:
        out = []
        for i in range(3):
            text = ("•", "◦", "▪")[i] if fmt == "bullet" else f"%{i + 1}."
            out.append(f'<w:lvl w:ilvl="{i}"><w:start w:val="1"/><w:numFmt w:val="{"bullet" if fmt == "bullet" else ("decimal", "lowerLetter", "lowerRoman")[i]}"/>'
                       f'<w:lvlText w:val="{text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="{600 + 400 * i}" w:hanging="300"/></w:pPr>'
                       f'<w:rPr><w:color w:val="{d.accent}"/></w:rPr></w:lvl>')
        return "".join(out)

    nums = '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' + "".join(
        f'<w:num w:numId="{i + 2}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>'
        for i in range(numbered)
    )
    return (f'<w:numbering xmlns:w="{_W}">'
            f'<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>{lvls("bullet")}</w:abstractNum>'
            f'<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>{lvls("decimal")}</w:abstractNum>'
            f"{nums}</w:numbering>")


def _docx_footer(d: Design) -> str:
    run = _w_rpr(color=d.muted, size=16)
    return (f'<w:ftr xmlns:w="{_W}" xmlns:r="{_ODR}"><w:p><w:pPr><w:jc w:val="center"/></w:pPr>'
            f'<w:r>{run}<w:fldChar w:fldCharType="begin"/></w:r><w:r>{run}<w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>'
            f'<w:r>{run}<w:fldChar w:fldCharType="separate"/></w:r><w:r>{run}<w:t>1</w:t></w:r><w:r>{run}<w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>')


def _docx(spec: dict[str, Any], b: _Budget, d: Design) -> bytes:
    title, blocks = _doc_blocks(spec, b)
    nums = _Numbering()
    body = _w_body(blocks, d, nums) or "<w:p/>"
    sect = (f'<w:sectPr><w:footerReference w:type="default" r:id="rId3"/><w:pgSz w:w="{_PAGE_W}" w:h="{_PAGE_H}"/>'
            f'<w:pgMar w:top="{_MARGIN}" w:right="{_MARGIN}" w:bottom="{_MARGIN}" w:left="{_MARGIN}" w:header="700" w:footer="620" w:gutter="0"/>'
            '<w:pgNumType w:start="1"/></w:sectPr>')
    doc = f'<w:document xmlns:w="{_W}" xmlns:r="{_ODR}"><w:body>{body}{sect}</w:body></w:document>'
    main = "application/vnd.openxmlformats-officedocument.wordprocessingml"
    return _zip([
        ("[Content_Types].xml", _types([("/word/document.xml", f"{main}.document.main+xml"), ("/word/styles.xml", f"{main}.styles+xml"),
                                        ("/word/numbering.xml", f"{main}.numbering+xml"), ("/word/footer1.xml", f"{main}.footer+xml"), _CORE_CT])),
        ("_rels/.rels", _rels([("rId1", f"{_ODR}/officeDocument", "word/document.xml"), _CORE_REL])),
        ("word/_rels/document.xml.rels", _rels([("rId1", f"{_ODR}/styles", "styles.xml"), ("rId2", f"{_ODR}/numbering", "numbering.xml"),
                                                ("rId3", f"{_ODR}/footer", "footer1.xml")])),
        ("word/document.xml", doc),
        ("word/styles.xml", _docx_styles(d)),
        ("word/numbering.xml", _docx_numbering(nums.count, d)),
        ("word/footer1.xml", _docx_footer(d)),
        ("docProps/core.xml", _core(title or str(spec.get("name") or ""))),
    ])


# ── xlsx (머리 행 = 디자인 색 · 줄무늬) ──

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
    head = len(rows) > 1
    for r, row in enumerate(rows):
        cells = []
        zebra = head and r > 0 and r % 2 == 0
        for c, v in enumerate(row):
            ref = f"{_col(c)}{r + 1}"
            wrapv = isinstance(v, str) and "\n" in v
            s = 1 if r == 0 and head else (4 if zebra and wrapv else 3 if zebra else 2 if wrapv else 0)
            whole = isinstance(v, int) or (isinstance(v, float) and v.is_integer()) or (isinstance(v, str) and v.startswith("=") and _safe_formula(v))
            if s in (0, 3) and whole and not (r == 0 and head):
                s = 6 if zebra else 5  # 1,234
            style = f' s="{s}"'  # 0 도 적는다 (안 적으면 LibreOffice 가 기본 서식의 밑줄을 빼먹는다)
            if isinstance(v, (int, float)):
                cells.append(f'<c r="{ref}"{style}><v>{_num_text(v)}</v></c>')
            elif v == "":
                if zebra:
                    cells.append(f'<c r="{ref}"{style}/>')
                continue
            elif v.startswith("=") and _safe_formula(v):
                cells.append(f'<c r="{ref}"{style}><f>{_x(v[1:])}</f></c>')
            else:
                cells.append(f'<c r="{ref}"{style} t="inlineStr"><is><t xml:space="preserve">{_x(v)}</t></is></c>')
        ht = ' ht="24" customHeight="1"' if r == 0 and head else ""
        out.append(f'<row r="{r + 1}"{ht}>{"".join(cells)}</row>')
    cols = len(rows[0]) if rows else 0
    widths = "".join(
        f'<col min="{c + 1}" max="{c + 1}" width="{min(max(max((_width(row[c]) for row in rows), default=8) + 3, 9), 60):.0f}" customWidth="1"/>'
        for c in range(cols)
    )
    pane = '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' if head else ""
    return (f'<worksheet xmlns="{_S}" xmlns:r="{_ODR}"><sheetViews><sheetView workbookViewId="0" showGridLines="0">{pane}</sheetView></sheetViews>'
            f'<sheetFormatPr defaultRowHeight="18"/>{f"<cols>{widths}</cols>" if widths else ""}<sheetData>{"".join(out)}</sheetData></worksheet>')


def _xlsx_styles(d: Design) -> str:
    font = f'<sz val="10.5"/><color rgb="FF{d.text}"/><name val="{FONT_EA}"/><family val="2"/><charset val="129"/>'
    hfont = f'<b/><sz val="10.5"/><color rgb="FF{d.head_text}"/><name val="{FONT_EA}"/><family val="2"/><charset val="129"/>'
    solid = lambda c: f'<fill><patternFill patternType="solid"><fgColor rgb="FF{c}"/><bgColor indexed="64"/></patternFill></fill>'  # noqa: E731
    line = f'<border><left/><right/><top/><bottom style="thin"><color rgb="FF{d.rule}"/></bottom><diagonal/></border>'
    return (f'<styleSheet xmlns="{_S}"><fonts count="2"><font>{font}</font><font>{hfont}</font></fonts>'
            f'<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>{solid(d.head_fill)}{solid(d.zebra)}</fills>'
            f'<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>{line}</borders>'
            '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
            '<cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>'
            '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>'
            '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
            '<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>'
            '<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
            '<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>'
            '<xf numFmtId="3" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/></cellXfs>'
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


def _xlsx(spec: dict[str, Any], b: _Budget, d: Design) -> bytes:
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
        ("xl/styles.xml", _xlsx_styles(d)),
        *((f"xl/worksheets/sheet{i + 1}.xml", _xlsx_sheet(rows)) for i, (_, rows) in enumerate(sheets)),
        ("docProps/core.xml", _core(b.text(spec.get("title")) or str(spec.get("name") or ""))),
    ])


# ── pptx (16:9 · 표지 + 제목과 내용 두 레이아웃 · 슬라이드 모양 = layout · 색 = 디자인) ──

_NS_P = f'xmlns:a="{_A}" xmlns:r="{_ODR}" xmlns:p="{_P}"'
_SLIDE_W, _SLIDE_H = 12192000, 6858000
_BODY_X, _BODY_Y, _BODY_W, _BODY_H = 838200, 1825625, 10515600, 4351338
_GRP = ('<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/>'
        '<a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>')


def _fill(c: str) -> str:
    return f'<a:solidFill><a:srgbClr val="{c}"/></a:solidFill>'


def _a_runs(text: str, *, size: int | None = None, bold: bool = False, color: str | None = None) -> str:
    out = []
    for chunk, strong in _runs(text.replace("\n", " ")):
        attrs = ' lang="ko-KR" altLang="en-US"' + (f' sz="{size}"' if size else "") + (' b="1"' if strong or bold else "")
        out.append(f"<a:r><a:rPr{attrs} dirty=\"0\">{_fill(color) if color else ''}</a:rPr><a:t>{_x(chunk)}</a:t></a:r>")
    return "".join(out)


def _a_level(lvl: int, accent: str) -> str:
    """안쪽 단계 = 들여쓰기 · 글머리표를 슬라이드에 직접 (레이아웃 상속을 안 따르는 프로그램이 있다 · LibreOffice)."""
    if not lvl:
        return ""
    char = ("–", "•")[lvl - 1]
    return (f'<a:pPr marL="{285750 + 457200 * lvl}" lvl="{lvl}" indent="-285750"><a:buClr><a:srgbClr val="{accent}"/></a:buClr><a:buFont typeface="Arial"/>'
            f'<a:buChar char="{char}"/></a:pPr>')


def _ph(sid: int, name: str, ph: str, paras: str, xfrm: str = "", body_pr: str = "<a:bodyPr/>") -> str:
    return (f'<p:sp><p:nvSpPr><p:cNvPr id="{sid}" name="{name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>{ph}</p:nvPr></p:nvSpPr>'
            f"<p:spPr>{xfrm}</p:spPr><p:txBody>{body_pr}<a:lstStyle/>{paras}</p:txBody></p:sp>")


def _xfrm(x: int, y: int, w: int, h: int) -> str:
    return f'<a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{w}" cy="{h}"/></a:xfrm>'


def _rect(sid: int, x: int, y: int, w: int, h: int, color: str) -> str:
    return (f'<p:sp><p:nvSpPr><p:cNvPr id="{sid}" name="Shape {sid}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>{_xfrm(x, y, w, h)}'
            f'<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>{_fill(color)}<a:ln><a:noFill/></a:ln></p:spPr></p:sp>')


def _box(sid: int, x: int, y: int, w: int, h: int, paras: str, anchor: str = "t") -> str:
    return (f'<p:sp><p:nvSpPr><p:cNvPr id="{sid}" name="Text {sid}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>{_xfrm(x, y, w, h)}'
            '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>'
            f'<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="{anchor}"><a:normAutofit/></a:bodyPr><a:lstStyle/>{paras}</p:txBody></p:sp>')


def _bullets(items: Sequence[tuple[int, str]], d: Design, size: int = 2000) -> str:
    out = []
    for lvl, t in items:
        mar = 285750 + 400000 * lvl
        out.append(f'<a:p><a:pPr marL="{mar}" indent="-285750"><a:lnSpc><a:spcPct val="110000"/></a:lnSpc><a:spcBef><a:spcPts val="900"/></a:spcBef>'
                   f'<a:buClr><a:srgbClr val="{d.accent}"/></a:buClr><a:buFont typeface="Arial"/><a:buChar char="{("•", "–", "•")[lvl]}"/></a:pPr>'
                   f'{_a_runs(t, size=size - 200 * lvl, color=d.text)}</a:p>')
    return "".join(out)


def _a_table(rows: list[list[Any]], b: _Budget, y: int, h: int, sid: int, d: Design) -> str:
    cols = len(rows[0])
    cw = _BODY_W // cols
    rh = min(420000, h // max(len(rows), 1))
    size = 1400 if len(rows) <= 8 else 1100
    head = len(rows) > 1
    text = _str_rows(rows)
    num = [_numeric([r[c] for r in text[1 if head else 0 :]]) for c in range(cols)]
    none = "".join(f"<a:{e}><a:noFill/></a:{e}>" for e in ("lnL", "lnR", "lnT"))
    right = '<a:pPr algn="r"/>'
    trs = []
    for i, row in enumerate(rows):
        is_head = head and i == 0
        fill = d.head_fill if is_head else (d.zebra if i % 2 == 0 else "FFFFFF")
        tcs = "".join(
            f'<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p>{right if num[c] else ""}'
            f'{_a_runs(b.text(v), size=size, bold=is_head, color=d.head_text if is_head else d.text)}</a:p></a:txBody>'
            f'<a:tcPr marL="114300" marR="114300" marT="64008" marB="64008" anchor="ctr">{none}<a:lnB w="9525">{_fill(d.rule)}</a:lnB>{_fill(fill)}</a:tcPr></a:tc>'
            for c, v in enumerate(row)
        )
        trs.append(f'<a:tr h="{rh}">{tcs}</a:tr>')
    grid = "".join(f'<a:gridCol w="{cw}"/>' for _ in range(cols))
    return (f'<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="{sid}" name="Table {sid}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/>'
            f'</p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="{_BODY_X}" y="{y}"/><a:ext cx="{cw * cols}" cy="{rh * len(rows)}"/></p:xfrm>'
            f'<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/>'
            f"<a:tblGrid>{grid}</a:tblGrid>{''.join(trs)}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>")


def _slide(inner: str, bg: str | None = None) -> str:
    bgx = f'<p:bg><p:bgPr>{_fill(bg)}<a:effectLst/></p:bgPr></p:bg>' if bg else ""
    return (f'<p:sld {_NS_P}><p:cSld>{bgx}<p:spTree>{_GRP}{inner}</p:spTree></p:cSld>'
            '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>')


def _chrome(d: Design, number: int) -> str:
    """내용 슬라이드 장식 (디자인마다) + 오른쪽 아래 쪽 번호."""
    parts = []
    if d.cover == "band":
        parts.append(_rect(10, 0, 0, 150000, _SLIDE_H, d.accent))
    elif d.cover == "dark":
        parts.append(_rect(10, 0, 0, _SLIDE_W, 80000, d.cover_bg))
    parts.append(_rect(11, _BODY_X, 520000, 560000, 56000, d.accent))
    parts.append(_box(12, _SLIDE_W - 1300000, _SLIDE_H - 520000, 460000, 260000,
                      f'<a:p><a:pPr algn="r"/>{_a_runs(str(number), size=1100, color=d.muted)}</a:p>'))
    return "".join(parts)


_FLUSH = 'lIns="0" rIns="0"'


def _title_ph(text: str, d: Design, color: str | None = None, xfrm: str = "") -> str:
    return _ph(2, "Title 1", '<p:ph type="title"/>', f"<a:p>{_a_runs(text, color=color or d.ink)}</a:p>", xfrm,
               f'<a:bodyPr {_FLUSH} anchor="t"><a:normAutofit/></a:bodyPr>')


def _content_slide(s: dict[str, Any], b: _Budget, d: Design, number: int) -> str:
    layout = s.get("layout") if s.get("layout") in SLIDE_LAYOUTS else "bullets"
    title = b.text(s.get("title"))
    if layout == "title":
        return _title_slide(title, b.text(s.get("subtitle")), d)
    if layout == "section":
        bg = d.cover_bg if d.cover in ("dark", "band", "tint") else d.ink
        fg = d.cover_text if d.cover == "tint" else "FFFFFF"
        sub = b.text(s.get("subtitle"))
        sub_color = d.cover_sub if d.cover in ("dark", "tint") else "D0D7E2"
        inner = (_rect(10, _BODY_X, 2500000, 700000, 70000, d.accent if d.cover != "band" else "FFFFFF")
                 + _title_ph(title, d, fg, _xfrm(_BODY_X, 2700000, _BODY_W, 1300000))
                 + (_box(3, _BODY_X, 4050000, _BODY_W, 800000, f"<a:p>{_a_runs(sub, size=2000, color=sub_color)}</a:p>") if sub else ""))
        return _slide(inner, bg)
    parts = [_chrome(d, number), _title_ph(title, d)]
    bullets = [_indent(b.text(x)) for x in _list(s.get("bullets"), "bullets", MAX_BULLETS)]
    if layout == "big_number":
        value, label = b.text(s.get("value")), b.text(s.get("label"))
        w = _BODY_W if not bullets else _BODY_W // 2 - 300000
        parts.append(_box(4, _BODY_X, 2000000, w, 1900000, f"<a:p>{_a_runs(value, size=8800, bold=True, color=d.accent)}</a:p>", "b"))
        if label:
            parts.append(_box(5, _BODY_X, 4000000, w, 900000, f"<a:p>{_a_runs(label, size=2000, color=d.muted)}</a:p>"))
        if bullets:
            parts.append(_box(6, _BODY_X + _BODY_W // 2 + 300000, 2100000, _BODY_W // 2 - 300000, 3600000, _bullets(bullets, d, 1800)))
        return _slide("".join(parts))
    if layout == "two_column":
        left = [_indent(b.text(x)) for x in _list(s.get("left"), "left", MAX_BULLETS)]
        right = [_indent(b.text(x)) for x in _list(s.get("right"), "right", MAX_BULLETS)]
        cw = _BODY_W // 2 - 250000
        parts.append(_rect(7, _BODY_X + cw + 225000, _BODY_Y + 100000, 12700, 3800000, d.rule))
        parts.append(_box(4, _BODY_X, _BODY_Y + 50000, cw, 4200000, _bullets(left, d, 1800) or "<a:p/>"))
        parts.append(_box(5, _BODY_X + cw + 500000, _BODY_Y + 50000, cw, 4200000, _bullets(right, d, 1800) or "<a:p/>"))
        return _slide("".join(parts))
    rows = _rows(s.get("rows"), b)
    table_y, table_h = _BODY_Y, _BODY_H
    if bullets and layout != "table":
        paras = "".join("<a:p>" + _a_level(lvl, d.accent) + _a_runs(t, color=d.text) + "</a:p>" for lvl, t in bullets)
        xfrm = ""
        if rows:  # 글 + 표 = 글은 위 1/3
            xfrm = _xfrm(_BODY_X, _BODY_Y, _BODY_W, _BODY_H // 3)
            table_y, table_h = _BODY_Y + _BODY_H // 3 + 120000, _BODY_H - _BODY_H // 3 - 120000
        parts.append(_ph(3, "Content 2", '<p:ph idx="1"/>', paras, xfrm, f"<a:bodyPr {_FLUSH}><a:normAutofit/></a:bodyPr>"))
    if rows:
        parts.append(_a_table(rows, b, table_y, table_h, 4, d))
    return _slide("".join(parts))


def _title_slide(title: str, subtitle: str, d: Design) -> str:
    """표지 (레이아웃 1 · 디자인 cover 모양)."""
    bg = d.cover_bg if d.cover in ("dark", "tint") else None
    x, w = _BODY_X, _BODY_W
    deco = ""
    if d.cover == "band":
        deco = _rect(10, 0, 0, 3900000, _SLIDE_H, d.cover_bg) + _rect(11, 3900000, 0, 90000, _SLIDE_H, d.soft)
        x, w = 4700000, _SLIDE_W - 4700000 - 700000
    bar = _rect(12, x, 2350000, 700000, 70000, d.accent)
    t = _ph(2, "Title 1", '<p:ph type="ctrTitle"/>', f'<a:p><a:pPr algn="l"/>{_a_runs(title, color=d.cover_text)}</a:p>',
            _xfrm(x, 2500000, w, 1500000), f'<a:bodyPr {_FLUSH} anchor="t"><a:normAutofit/></a:bodyPr>')
    sub = _ph(3, "Subtitle 2", '<p:ph type="subTitle" idx="1"/>',
              f'<a:p><a:pPr marL="0" indent="0" algn="l"><a:buNone/></a:pPr>{_a_runs(subtitle, color=d.cover_sub)}</a:p>',
              _xfrm(x, 4100000, w, 1000000), f"<a:bodyPr {_FLUSH}/>") if subtitle else ""
    return _slide(deco + bar + t + sub, bg)


def _master(d: Design) -> str:
    title = _ph(2, "Title Placeholder 1", '<p:ph type="title"/>', '<a:p><a:endParaRPr lang="ko-KR"/></a:p>',
                _xfrm(_BODY_X, 640000, _BODY_W, 1000000) + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>', '<a:bodyPr anchor="t"><a:normAutofit/></a:bodyPr>')
    body = _ph(3, "Text Placeholder 2", '<p:ph type="body" idx="1"/>', '<a:p><a:endParaRPr lang="ko-KR"/></a:p>',
               _xfrm(_BODY_X, _BODY_Y, _BODY_W, _BODY_H) + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>', "<a:bodyPr><a:normAutofit/></a:bodyPr>")

    def lvl(n: int, size: int) -> str:
        mar = 285750 + 457200 * (n - 1)
        char = ("•", "–", "•")[n - 1]
        return (f'<a:lvl{n}pPr marL="{mar}" indent="-285750" algn="l"><a:lnSpc><a:spcPct val="110000"/></a:lnSpc><a:spcBef><a:spcPts val="1000"/></a:spcBef>'
                f'<a:buClr><a:srgbClr val="{d.accent}"/></a:buClr><a:buFont typeface="Arial"/><a:buChar char="{char}"/><a:defRPr sz="{size}">{_fill(d.text)}'
                f'<a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl{n}pPr>')

    return (f'<p:sldMaster {_NS_P}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>{_GRP}{title}{body}</p:spTree></p:cSld>'
            '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" '
            'accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
            '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/><p:sldLayoutId id="2147483650" r:id="rId2"/></p:sldLayoutIdLst>'
            '<p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:lnSpc><a:spcPct val="95000"/></a:lnSpc><a:spcBef><a:spcPct val="0"/></a:spcBef><a:buNone/>'
            f'<a:defRPr sz="3200" b="1">{_fill(d.ink)}<a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/>'
            '<a:cs typeface="+mj-cs"/></a:defRPr></a:lvl1pPr></p:titleStyle>'
            f"<p:bodyStyle>{lvl(1, 2000)}{lvl(2, 1800)}{lvl(3, 1600)}</p:bodyStyle>"
            '<p:otherStyle><a:defPPr><a:defRPr lang="ko-KR"/></a:defPPr></p:otherStyle></p:txStyles></p:sldMaster>')


def _layout(kind: str) -> str:
    if kind == "title":
        inner = (_ph(2, "Title 1", '<p:ph type="ctrTitle"/>', '<a:p><a:endParaRPr lang="ko-KR"/></a:p>', _xfrm(_BODY_X, 2500000, _BODY_W, 1500000),
                     '<a:bodyPr anchor="t"><a:normAutofit/></a:bodyPr>').replace("<a:lstStyle/>", '<a:lstStyle><a:lvl1pPr algn="l"><a:defRPr sz="4400"/></a:lvl1pPr></a:lstStyle>')
                 + _ph(3, "Subtitle 2", '<p:ph type="subTitle" idx="1"/>', '<a:p><a:endParaRPr lang="ko-KR"/></a:p>', _xfrm(_BODY_X, 4100000, _BODY_W, 1000000))
                 .replace("<a:lstStyle/>", '<a:lstStyle><a:lvl1pPr marL="0" indent="0" algn="l"><a:buNone/><a:defRPr sz="2000"/></a:lvl1pPr></a:lstStyle>'))
        name, typ = "Title Slide", "title"
    else:
        inner = (_ph(2, "Title 1", '<p:ph type="title"/>', '<a:p><a:endParaRPr lang="ko-KR"/></a:p>')
                 + _ph(3, "Content Placeholder 2", '<p:ph idx="1"/>', '<a:p><a:endParaRPr lang="ko-KR"/></a:p>'))
        name, typ = "Title and Content", "obj"
    return (f'<p:sldLayout {_NS_P} type="{typ}" preserve="1"><p:cSld name="{name}"><p:spTree>{_GRP}{inner}</p:spTree></p:cSld>'
            "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>")


def _theme(d: Design) -> str:
    colors = (("dk1", f'<a:srgbClr val="{d.text}"/>'), ("lt1", '<a:sysClr val="window" lastClr="FFFFFF"/>'),
              ("dk2", f'<a:srgbClr val="{d.ink}"/>'), ("lt2", f'<a:srgbClr val="{d.soft}"/>'), ("accent1", f'<a:srgbClr val="{d.accent}"/>'),
              ("accent2", f'<a:srgbClr val="{d.ink}"/>'), ("accent3", f'<a:srgbClr val="{d.muted}"/>'), ("accent4", '<a:srgbClr val="1F8A4C"/>'),
              ("accent5", '<a:srgbClr val="B7791F"/>'), ("accent6", f'<a:srgbClr val="{d.rule}"/>'), ("hlink", f'<a:srgbClr val="{d.accent}"/>'),
              ("folHlink", f'<a:srgbClr val="{d.ink}"/>'))
    clr = "".join(f"<a:{k}>{v}</a:{k}>" for k, v in colors)
    font = f'<a:latin typeface="{FONT_LATIN}"/><a:ea typeface="{FONT_EA}"/><a:cs typeface=""/><a:font script="Hang" typeface="{FONT_EA}"/>'
    solid = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
    fills = solid * 3
    lines = "".join(f'<a:ln w="{w}" cap="flat" cmpd="sng" algn="ctr">{solid}<a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>' for w in (6350, 12700, 19050))
    effects = "<a:effectStyle><a:effectLst/></a:effectStyle>" * 3
    return (f'<a:theme xmlns:a="{_A}" name="BrewAI {d.id}"><a:themeElements><a:clrScheme name="BrewAI {d.id}">{clr}</a:clrScheme>'
            f'<a:fontScheme name="BrewAI"><a:majorFont>{font}</a:majorFont><a:minorFont>{font}</a:minorFont></a:fontScheme>'
            f'<a:fmtScheme name="BrewAI"><a:fillStyleLst>{fills}</a:fillStyleLst><a:lnStyleLst>{lines}</a:lnStyleLst>'
            f"<a:effectStyleLst>{effects}</a:effectStyleLst><a:bgFillStyleLst>{fills}</a:bgFillStyleLst></a:fmtScheme>"
            "</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>")


def _pptx(spec: dict[str, Any], b: _Budget, d: Design) -> bytes:
    slides: list[tuple[str, int]] = []  # (xml, 레이아웃 번호)
    title, subtitle = b.text(spec.get("title")), b.text(spec.get("subtitle"))
    if title:
        slides.append((_title_slide(title, subtitle, d), 1))
    for s in _list(spec.get("slides"), "slides", MAX_SLIDES):
        if not isinstance(s, dict):
            raise MakeError("bad_shape", "slides 의 칸은 객체여야 한다")
        lay = 1 if s.get("layout") == "title" else 2
        slides.append((_content_slide(s, b, d, len(slides) + 1), lay))
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
        ("ppt/theme/theme1.xml", _theme(d)),
        ("ppt/slideMasters/slideMaster1.xml", _master(d)),
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


def _md_blocks(blocks: Sequence[Norm], shift: int) -> list[str]:
    out: list[str] = []
    for x in blocks:
        k = x[0]
        if k == "title":
            out.append(f"# {x[1]}")
        elif k == "cover":
            out.append(f"# {x[1]}")
            out.extend(part for part in (x[2], " / ".join(m for m in (x[3], x[4]) if m)) if part)
        elif k == "heading":
            out.append("#" * (x[1] + shift) + " " + x[2])
        elif k == "para":
            out.append(x[1])
        elif k == "list":
            lines = []
            n = 0
            for lvl, text in x[2]:
                if not lvl:
                    n += 1
                lines.append("   " * lvl + (f"{n}. " if x[1] and not lvl else "- ") + text)
            out.append("\n".join(lines))
        elif k == "table":
            rows = x[1]
            lines = ["| " + " | ".join(_md_cell(c) for c in rows[0]) + " |", "|" + "---|" * len(rows[0])]
            lines += ["| " + " | ".join(_md_cell(c) for c in r) + " |" for r in rows[1:]]
            out.append("\n".join(lines))
        elif k == "kpis":
            out.append("\n".join(f"- **{v}** {lab}" + (f" ({note})" if note else "") for lab, v, note in x[1]))
        elif k == "callout":
            out.append("\n".join(f"> {line}" for line in ([f"**{x[2]}**"] if x[2] else []) + x[3].split("\n")))
        elif k == "quote":
            out.append("\n".join([*(f"> {line}" for line in x[1].split("\n")), *([f"> — {x[2]}"] if x[2] else [])]))
        elif k in ("divider", "pagebreak"):
            out.append("---")
        elif k == "columns":
            out.extend(_md_blocks([*x[1], *x[2]], shift))
    return out


def _md(spec: dict[str, Any], b: _Budget, d: Design) -> bytes:
    _, blocks = _doc_blocks(spec, b)
    shift = 1 if any(x[0] in ("title", "cover") for x in blocks) else 0
    return ("\n\n".join(_md_blocks(blocks, shift)) + "\n").encode("utf-8")


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


def _csv(spec: dict[str, Any], b: _Budget, d: Design) -> bytes:
    _, rows = _sheets(spec, b)[0]
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    for r in rows:
        w.writerow([_csv_cell(c) for c in r])
    return ("\ufeff" + buf.getvalue()).encode("utf-8")  # BOM = Excel 이 한글을 바로 읽는다


# ── pdf (정리한 블록 → pdfmake 블록) ──

def _pdf_blocks(blocks: Sequence[Norm], d: Design) -> list[pm.Block]:
    numbers = _heading_numbers(blocks) if d.heading == "number" else {}
    out: list[pm.Block] = []
    for i, x in enumerate(blocks):
        k = x[0]
        if k == "title":
            out.append(("title", _runs(x[1])))
        elif k == "cover":
            out.append(("cover", _plain(x[1]), _plain(x[2]), x[3], x[4]))
        elif k == "heading":
            out.append(("heading", x[1], _runs(x[2]), numbers.get(i, "")))
        elif k == "para":
            out.append(("para", _runs(x[1])))
        elif k == "list":
            counts = [0, 0, 0]
            for lvl, text in x[2]:
                counts[lvl] += 1
                for deeper in range(lvl + 1, 3):
                    counts[deeper] = 0
                marker = ("•", "◦", "–")[lvl] if not x[1] else _number(counts[lvl], lvl)
                out.append(("item", lvl, marker, _runs(text)))
        elif k == "table":
            out.append(("table", x[1]))
        elif k == "kpis":
            out.append(("kpis", [(_plain(a), _plain(v), _plain(n)) for a, v, n in x[1]]))
        elif k == "callout":
            bar, bg = ds.tone(d, x[1])
            out.append(("callout", bar, bg, _plain(x[2]), _runs(x[3])))
        elif k == "quote":
            out.append(("quote", _runs(x[1]), x[2]))
        elif k == "divider":
            out.append(("divider",))
        elif k == "columns":
            out.append(("columns", _pdf_blocks(x[1], d), _pdf_blocks(x[2], d)))
        elif k == "pagebreak":
            out.append(("pagebreak",))
    return out


def _pdf(spec: dict[str, Any], b: _Budget, d: Design) -> bytes:
    title, blocks = _doc_blocks(spec, b)
    try:
        return pm.render(_pdf_blocks(blocks, d), title=title or str(spec.get("name") or ""), design=d)
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
    """make_file 인자 → 파일. 틀리면 MakeError (모델에게 한 줄로 돌려준다). design = 모르는 이름이면 깔끔."""
    if not isinstance(spec, dict):
        raise MakeError("bad_shape", "인자는 객체여야 한다")
    kind = spec.get("kind")
    if kind not in KINDS:
        raise MakeError("bad_kind", f"kind 는 {', '.join(KINDS)} 중 하나")
    b = _Budget()
    raw = b.text(spec.get("name")).strip() or b.text(spec.get("title")).strip() or "문서"
    stem = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', " ", raw).strip().removesuffix(f".{kind}").strip()[:80] or "문서"
    data = _WRITERS[kind](spec, b, ds.get(spec.get("design")))
    return Made(kind=kind, name=f"{stem}.{kind}", data=data, mime=MIME[kind])
