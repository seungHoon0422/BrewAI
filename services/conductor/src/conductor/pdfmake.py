"""PDF 쓰기 (make_file kind=pdf · slice 08) — 정리된 블록 → A4 PDF 바이트. 의존성 = fontTools (글꼴 부분 집합) 하나.

글꼴 = runtime/fonts 나눔고딕 (보통 · 굵게 · OFL) · 쓴 글자만 넣는다 (CIDFontType2 · Identity-H · glyph id 그대로 = retain_gids)
· W 배열(글자 폭) · ToUnicode (복사 · 검색 · 우리 files.parse(pypdf) 가 되읽는다).
줄 나눔 = 한글 · 한자 · 가나는 글자 사이 어디서나 · 라틴 낱말은 띄어쓰기에서 (너무 긴 낱말은 글자로) · 닫는 문장 부호는 줄 머리에 안 둔다.
표 = 머리 행(굵게 · 옅은 바탕) · 칸 안 줄 나눔 · 행은 쪽에서 안 자른다 · 다음 쪽에 머리 행을 다시.
같은 입력 = 같은 바이트: 만든 시각 · 무작위 id 없음 · 부분 집합 이름표 = 쓴 글자에서 (글꼴 head 시각도 원본 그대로).
"""

from __future__ import annotations

import hashlib
import io
import os
import re
import zlib
from collections.abc import Sequence
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Literal

FONTS_DIR = Path(os.environ.get("CONDUCTOR_FONTS_DIR") or Path(__file__).resolve().parents[4] / "runtime" / "fonts")
FONT_FILES = {"r": "NanumGothic-Regular.ttf", "b": "NanumGothic-Bold.ttf"}
FONT_NAME = {"r": "NanumGothic", "b": "NanumGothicBold"}

PAGE_W, PAGE_H = 595.28, 841.89  # A4 (pt)
MARGIN_X, MARGIN_TOP, MARGIN_BOTTOM = 62.0, 64.0, 64.0
TEXT_W = PAGE_W - MARGIN_X * 2
MAX_PAGES = 300
BODY, LEADING = 10.5, 1.6
HEAD = {1: 16.0, 2: 13.5, 3: 12.0}
TITLE = 20.0
TABLE_SIZE, CELL_PAD = 9.5, 4.5
INDENT = 16.0  # 목록 한 단계
BORDER_RGB, HEAD_FILL = (0.75, 0.75, 0.75), 0.949
_WIDE = re.compile(r"[ᄀ-ᇿ⺀-鿿가-힯豈-﫿＀-￯　-〿]")
_NO_HEAD = set(".,!?;:)]}%'\"”’」』》〉、。·…")  # 줄 머리에 두지 않는 글자 (앞 조각에 붙인다)

Runs = Sequence[tuple[str, bool]]  # (글, 굵게?)
Block = (
    tuple[Literal["title"], Runs] | tuple[Literal["heading"], int, Runs] | tuple[Literal["para"], Runs]
    | tuple[Literal["item"], int, str, Runs] | tuple[Literal["table"], list[list[str]]] | tuple[Literal["pagebreak"]]
)


class PdfError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message


# ── 글꼴 ──

@dataclass
class _Font:
    key: str  # 'r' | 'b'
    data: bytes
    cmap: dict[int, int]  # 코드 포인트 → glyph id
    adv: list[int]  # glyph id → 폭 (1000 단위)
    upem: int
    ascent: int
    descent: int
    bbox: tuple[int, int, int, int]
    cap: int
    used: dict[int, str] = field(default_factory=dict)  # 이번 문서에서 쓴 glyph id → 글자 (ToUnicode)

    def gid(self, ch: str) -> int:
        g = self.cmap.get(ord(ch))
        if g is None:
            g = self.cmap.get(ord("?"), 0)
            ch = "?"
        self.used.setdefault(g, ch)
        return g

    def width(self, text: str, size: float) -> float:
        cm, adv = self.cmap, self.adv
        q = cm.get(ord("?"), 0)
        return sum(adv[cm.get(ord(c), q)] for c in text) * size / 1000


@lru_cache(maxsize=2)
def _metrics(key: str) -> tuple[bytes, dict[int, int], list[int], int, int, int, tuple[int, int, int, int], int]:
    from fontTools.ttLib import TTFont  # PDF 를 만들 때만

    path = FONTS_DIR / FONT_FILES[key]
    try:
        data = path.read_bytes()
    except OSError as e:
        raise PdfError("font_missing", f"PDF 글꼴이 없다 ({path.name})") from e
    f = TTFont(io.BytesIO(data), recalcTimestamp=False, lazy=True)
    upem = f["head"].unitsPerEm
    order = f.getGlyphOrder()
    hmtx = f["hmtx"].metrics
    adv = [round(hmtx[n][0] * 1000 / upem) for n in order]
    name_to_id = {n: i for i, n in enumerate(order)}
    cmap = {cp: name_to_id[n] for cp, n in f.getBestCmap().items() if n in name_to_id}
    head, hhea, os2 = f["head"], f["hhea"], f["OS/2"]
    s = 1000 / upem
    bbox = (round(head.xMin * s), round(head.yMin * s), round(head.xMax * s), round(head.yMax * s))
    cap = round(getattr(os2, "sCapHeight", 0) * s) or round(hhea.ascent * s * 0.8)
    return data, cmap, adv, upem, round(hhea.ascent * s), round(hhea.descent * s), bbox, cap


def _font(key: str) -> _Font:
    data, cmap, adv, upem, asc, desc, bbox, cap = _metrics(key)
    return _Font(key, data, cmap, adv, upem, asc, desc, bbox, cap)


def _subset(f: _Font) -> bytes:
    from fontTools import subset
    from fontTools.ttLib import TTFont

    font = TTFont(io.BytesIO(f.data), recalcTimestamp=False)
    opts = subset.Options()
    opts.retain_gids = True  # glyph id 그대로 = 글 흐름의 id 를 다시 매기지 않는다
    opts.notdef_outline = True
    opts.name_IDs = []
    opts.layout_features = []
    opts.hinting = False
    opts.drop_tables += ["DSIG", "GSUB", "GPOS", "GDEF", "kern", "vhea", "vmtx"]
    s = subset.Subsetter(opts)
    s.populate(gids=sorted({0, *f.used}))
    s.subset(font)
    out = io.BytesIO()
    font.save(out)
    return out.getvalue()


# ── 줄 나눔 ──

@dataclass
class _Piece:
    text: str
    bold: bool
    space: bool  # 띄어쓰기 (줄 끝 · 줄 머리에선 버린다)


def _pieces(runs: Runs) -> list[_Piece | None]:
    """글 → 나눌 수 있는 조각 (None = 강제 줄바꿈). 한글 · 한자 = 글자 하나씩 · 라틴 = 낱말 · 닫는 부호 = 앞 조각에 붙임."""
    out: list[_Piece | None] = []
    for text, bold in runs:
        for line_no, line in enumerate(text.split("\n")):
            if line_no:
                out.append(None)
            word = ""
            for ch in line:
                if ch in " \t":
                    if word:
                        out.append(_Piece(word, bold, False))
                        word = ""
                    out.append(_Piece(" ", bold, True))
                elif _WIDE.match(ch):
                    if word:
                        out.append(_Piece(word, bold, False))
                        word = ""
                    out.append(_Piece(ch, bold, False))
                elif ch in _NO_HEAD and not word and out and isinstance(out[-1], _Piece) and not out[-1].space and out[-1].bold == bold:
                    out[-1].text += ch
                else:
                    word += ch
            if word:
                out.append(_Piece(word, bold, False))
    return out


Line = list[tuple[str, bool]]  # 한 줄 = (글, 굵게?) 조각들


def wrap(runs: Runs, width: float, size: float, fonts: dict[str, _Font]) -> list[Line]:
    lines: list[Line] = []
    cur: Line = []
    used = 0.0

    def w(p: _Piece) -> float:
        return fonts["b" if p.bold else "r"].width(p.text, size)

    def push() -> None:
        nonlocal cur, used
        while cur and cur[-1][0] == " ":
            cur.pop()
        lines.append(cur)
        cur, used = [], 0.0

    for p in _pieces(runs):
        if p is None:
            push()
            continue
        if p.space and not cur:
            continue
        pw = w(p)
        if used + pw <= width or not cur and pw <= width:
            cur.append((p.text, p.bold))
            used += pw
            continue
        if p.space:
            push()
            continue
        if pw > width:  # 한 줄보다 긴 낱말 = 글자로
            for ch in p.text:
                cw = fonts["b" if p.bold else "r"].width(ch, size)
                if used + cw > width and cur:
                    push()
                cur.append((ch, p.bold))
                used += cw
            continue
        push()
        cur.append((p.text, p.bold))
        used = pw
    if cur or not lines:
        push()
    return lines


# ── 쪽 ──

@dataclass
class _Page:
    ops: list[str] = field(default_factory=list)


class _Doc:
    def __init__(self) -> None:
        self.fonts = {"r": _font("r"), "b": _font("b")}
        self.pages: list[_Page] = [_Page()]
        self.y = PAGE_H - MARGIN_TOP

    @property
    def page(self) -> _Page:
        return self.pages[-1]

    def new_page(self) -> None:
        if len(self.pages) >= MAX_PAGES:
            raise PdfError("too_large", f"PDF 는 {MAX_PAGES}쪽까지")
        self.pages.append(_Page())
        self.y = PAGE_H - MARGIN_TOP

    def room(self, h: float) -> None:
        """h 만큼 자리가 없으면 새 쪽 (쪽 맨 위면 그대로 · 아주 큰 칸이 끝없이 넘기지 않게)."""
        if self.y - h < MARGIN_BOTTOM and self.y < PAGE_H - MARGIN_TOP - 0.1:
            self.new_page()

    def text(self, x: float, y: float, line: Line, size: float) -> None:
        for chunk, bold in line:
            f = self.fonts["b" if bold else "r"]
            hexs = "".join(f"{f.gid(c):04X}" for c in chunk)
            self.page.ops.append(f"BT /F{'2' if bold else '1'} {size:g} Tf 1 0 0 1 {x:.2f} {y:.2f} Tm <{hexs}> Tj ET")
            x += f.width(chunk, size)

    def lines(self, lines: list[Line], x: float, size: float, lead: float, first: str | None = None, first_x: float = 0) -> None:
        for i, line in enumerate(lines):
            self.room(lead)
            base = self.y - size * 0.86 - (lead - size) / 2
            if i == 0 and first:
                self.text(first_x, base, [(first, False)], size)
            self.text(x, base, line, size)
            self.y -= lead

    def block(self, runs: Runs, size: float, before: float, after: float, *, x: float = MARGIN_X, width: float = TEXT_W,
              marker: str | None = None, marker_x: float = 0, keep_next: bool = False) -> None:
        lead = size * LEADING
        wrapped = wrap(runs, width, size, self.fonts)
        if self.y < PAGE_H - MARGIN_TOP - 0.1:
            self.y -= before
        self.room(lead * (min(len(wrapped), 2) + (2 if keep_next else 0)))  # 제목은 다음 줄과 같은 쪽 · 첫 두 줄은 함께
        self.lines(wrapped, x, size, lead, marker, marker_x)
        self.y -= after

    def table(self, rows: list[list[str]]) -> None:
        if not rows:
            return
        f = self.fonts
        cols = len(rows[0])
        head = len(rows) > 1
        nat = [min(max((f["b" if head and r == 0 else "r"].width(row[c], TABLE_SIZE) for r, row in enumerate(rows)), default=0) + CELL_PAD * 2,
                   TEXT_W * 0.6) for c in range(cols)]
        weights = [max(n, 40.0) for n in nat]
        total = sum(weights) or 1.0
        widths = [TEXT_W * wgt / total for wgt in weights]
        lead = TABLE_SIZE * 1.45

        def layout(r: int) -> tuple[list[list[Line]], float]:
            cells = [wrap([(rows[r][c], head and r == 0)], widths[c] - CELL_PAD * 2, TABLE_SIZE, f) for c in range(cols)]
            return cells, max(len(c) for c in cells) * lead + CELL_PAD * 2

        def draw(r: int, cells: list[list[Line]], h: float) -> None:
            x = MARGIN_X
            top = self.y
            ops = self.page.ops
            if head and r == 0:
                ops.append(f"{HEAD_FILL:g} g {MARGIN_X:.2f} {top - h:.2f} {TEXT_W:.2f} {h:.2f} re f 0 g")
            for c in range(cols):
                ops.append("{:g} {:g} {:g} RG 0.5 w {:.2f} {:.2f} {:.2f} {:.2f} re S".format(*BORDER_RGB, x, top - h, widths[c], h))
                y = top - CELL_PAD
                for line in cells[c]:
                    self.text(x + CELL_PAD, y - TABLE_SIZE * 0.86 - (lead - TABLE_SIZE) / 2, line, TABLE_SIZE)
                    y -= lead
                x += widths[c]
            self.y -= h

        if self.y < PAGE_H - MARGIN_TOP - 0.1:
            self.y -= 6
        header = layout(0) if head else None
        for r in range(len(rows)):
            cells, h = layout(r)
            if self.y - h < MARGIN_BOTTOM and self.y < PAGE_H - MARGIN_TOP - 0.1:
                self.new_page()
                if header and r > 0:
                    draw(0, *header)
            draw(r, cells, h)
        self.y -= 10


# ── PDF 조립 ──

def _hex16(s: str) -> str:
    return "<FEFF" + s.encode("utf-16-be").hex().upper() + ">"


def _tounicode(used: dict[int, str]) -> bytes:
    items = sorted(used.items())
    body = []
    for i in range(0, len(items), 100):
        chunk = items[i : i + 100]
        body.append(f"{len(chunk)} beginbfchar")
        body += [f"<{g:04X}> <{ch.encode('utf-16-be').hex().upper()}>" for g, ch in chunk]
        body.append("endbfchar")
    return ("/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def "
            "/CMapName /Adobe-Identity-UCS def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange\n"
            + "\n".join(body) + "\nendcmap CMapName currentdict /CMap defineresource pop end end").encode("ascii")


def _tag(f: _Font) -> str:
    h = hashlib.sha256((f.key + ",".join(map(str, sorted(f.used)))).encode()).digest()
    return "".join(chr(65 + b % 26) for b in h[:6])


def render(blocks: Sequence[Block], *, title: str = "") -> bytes:
    """블록 → PDF 바이트. 자리가 모자라면 새 쪽 · MAX_PAGES 를 넘으면 PdfError."""
    doc = _Doc()
    for i, b in enumerate(blocks):
        nxt = blocks[i + 1][0] if i + 1 < len(blocks) else None
        if b[0] == "title":
            doc.block([(t, True) for t, _ in b[1]], TITLE, 0, 14, keep_next=True)
        elif b[0] == "heading":  # 제목 = 굵게
            size = HEAD.get(b[1], HEAD[3])
            doc.block([(t, True) for t, _ in b[2]], size, size * 0.9, 4, keep_next=nxt not in (None, "pagebreak"))
        elif b[0] == "para":
            doc.block(b[1], BODY, 0, BODY * 0.6)
        elif b[0] == "item":
            lvl, marker, runs = b[1], b[2], b[3]
            x = MARGIN_X + INDENT * (lvl + 1)  # 글 시작 · 글머리표는 그 왼쪽에 오른쪽 맞춤
            doc.block(runs, BODY, 0, BODY * 0.2, x=x, width=TEXT_W - (x - MARGIN_X), marker=marker,
                      marker_x=x - doc.fonts["r"].width(marker, BODY) - 5)
            if nxt != "item":
                doc.y -= BODY * 0.5
        elif b[0] == "table":
            doc.table(b[1])
        elif b[0] == "pagebreak":
            doc.new_page()

    objs: list[bytes] = []

    def add(body: bytes | str) -> int:
        objs.append(body.encode("latin-1") if isinstance(body, str) else body)
        return len(objs)

    def stream(data: bytes, extra: str = "") -> bytes:
        z = zlib.compress(data, 9)
        return f"<< /Length {len(z)} /Filter /FlateDecode{extra} >>\nstream\n".encode() + z + b"\nendstream"

    catalog = add("")  # 1 · 나중에 채움
    pages_id = add("")  # 2
    font_ids: dict[str, int] = {}
    for key in ("r", "b"):
        f = doc.fonts[key]
        if not f.used:
            continue
        name = f"{_tag(f)}+{FONT_NAME[key]}"
        ff = _subset(f)
        file_id = add(stream(ff, f" /Length1 {len(ff)}"))
        desc = add(f"<< /Type /FontDescriptor /FontName /{name} /Flags 4 /FontBBox [{' '.join(map(str, f.bbox))}] /ItalicAngle 0 "
                   f"/Ascent {f.ascent} /Descent {f.descent} /CapHeight {f.cap} /StemV {120 if key == 'b' else 80} /FontFile2 {file_id} 0 R >>")
        w = " ".join(f"{g} [{f.adv[g]}]" for g in sorted(f.used))
        cid = add(f"<< /Type /Font /Subtype /CIDFontType2 /BaseFont /{name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> "
                  f"/FontDescriptor {desc} 0 R /DW 1000 /W [{w}] /CIDToGIDMap /Identity >>")
        tu = add(stream(_tounicode(f.used)))
        font_ids[key] = add(f"<< /Type /Font /Subtype /Type0 /BaseFont /{name} /Encoding /Identity-H /DescendantFonts [{cid} 0 R] /ToUnicode {tu} 0 R >>")
    res = " ".join(f"/F{'1' if k == 'r' else '2'} {v} 0 R" for k, v in font_ids.items())
    kids = []
    for p in doc.pages:
        content = add(stream("\n".join(p.ops).encode("latin-1")))
        kids.append(add(f"<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 {PAGE_W:g} {PAGE_H:g}] "
                        f"/Resources << /Font << {res} >> >> /Contents {content} 0 R >>"))
    objs[pages_id - 1] = f"<< /Type /Pages /Kids [{' '.join(f'{k} 0 R' for k in kids)}] /Count {len(kids)} >>".encode()
    objs[catalog - 1] = f"<< /Type /Catalog /Pages {pages_id} 0 R >>".encode()
    info = add(f"<< /Title {_hex16(title)} /Producer (BrewAI) >>" if title else "<< /Producer (BrewAI) >>")

    out = io.BytesIO()
    out.write(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for n, body in enumerate(objs, 1):
        offsets.append(out.tell())
        out.write(f"{n} 0 obj\n".encode() + body + b"\nendobj\n")
    xref = out.tell()
    out.write(f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode())
    out.write("".join(f"{o:010d} 00000 n \n" for o in offsets).encode())
    doc_id = hashlib.md5(out.getvalue()).hexdigest().upper()  # 같은 내용 = 같은 id
    out.write(f"trailer\n<< /Size {len(objs) + 1} /Root {catalog} 0 R /Info {info} 0 R /ID [<{doc_id}> <{doc_id}>] >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return out.getvalue()


def has_font() -> bool:
    return all((FONTS_DIR / f).is_file() for f in FONT_FILES.values())


