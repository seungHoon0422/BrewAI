"""PDF 쓰기 (make_file kind=pdf · slice 08) — 정리된 블록 → A4 PDF 바이트. 의존성 = fontTools (글꼴 부분 집합) 하나.

글꼴 = runtime/fonts 나눔고딕 (보통 · 굵게 · OFL) · 쓴 글자만 넣는다 (CIDFontType2 · Identity-H · glyph id 그대로 = retain_gids)
· W 배열(글자 폭) · ToUnicode (복사 · 검색 · 우리 files.parse(pypdf) 가 되읽는다).
줄 나눔 = 한글 · 한자 · 가나는 글자 사이 어디서나 · 라틴 낱말은 띄어쓰기에서 (너무 긴 낱말은 글자로) · 닫는 문장 부호는 줄 머리에 안 둔다.
표 = 머리 행(디자인 색) · 줄무늬 · 가로줄만 · 숫자 칸 오른쪽 맞춤 · 칸 안 줄 나눔 · 행은 쪽에서 안 자른다 · 다음 쪽에 머리 행을 다시.
디자인 (designs.py) = 색 · 표지 · 제목 모양 · 꾸밈 블록 (표지 · 숫자 카드 · 강조 상자 · 인용 · 구분선 · 두 단) · 쪽 번호 (표지 빼고).
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
from typing import Any

from .designs import DESIGNS, Design

FONTS_DIR = Path(os.environ.get("CONDUCTOR_FONTS_DIR") or Path(__file__).resolve().parents[4] / "runtime" / "fonts")
FONT_FILES = {"r": "NanumGothic-Regular.ttf", "b": "NanumGothic-Bold.ttf"}
FONT_NAME = {"r": "NanumGothic", "b": "NanumGothicBold"}

PAGE_W, PAGE_H = 595.28, 841.89  # A4 (pt)
MARGIN_X, MARGIN_TOP, MARGIN_BOTTOM = 62.0, 64.0, 64.0
TEXT_W = PAGE_W - MARGIN_X * 2
MAX_PAGES = 300
BODY, LEADING = 10.5, 1.62
HEAD = {1: 17.0, 2: 13.5, 3: 11.5}
TITLE = 22.0
TABLE_SIZE, CELL_PAD = 9.5, 5.0
INDENT = 16.0  # 목록 한 단계
_WIDE = re.compile(r"[ᄀ-ᇿ⺀-鿿가-힯豈-﫿＀-￯　-〿]")
_NO_HEAD = set(".,!?;:)]}%'\"”’」』》〉、。·…")  # 줄 머리에 두지 않는 글자 (앞 조각에 붙인다)

Runs = Sequence[tuple[str, bool]]  # (글, 굵게?)
# 블록 (docmake._pdf 가 만든다): ("title", runs) · ("cover", 제목, 부제, 날짜, 쓴 곳) · ("heading", 수준, runs, 번호 글) · ("para", runs)
# · ("item", 단계, 글머리, runs) · ("table", 행들) · ("kpis", [(이름, 값, 설명)]) · ("callout", 띠 색, 바탕 색, 제목, runs) · ("quote", runs, 누가)
# · ("divider",) · ("columns", 왼쪽 블록들, 오른쪽 블록들) · ("pagebreak",)
Block = tuple[Any, ...]


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

Color = tuple[float, float, float]


def _c(hex6: str) -> Color:
    return tuple(int(hex6[i : i + 2], 16) / 255 for i in (0, 2, 4))  # type: ignore[return-value]


def _rg(c: Color) -> str:
    return f"{c[0]:.3f} {c[1]:.3f} {c[2]:.3f}"


@dataclass
class _Page:
    ops: list[str] = field(default_factory=list)
    cover: bool = False  # 표지 = 쪽 번호 없음


class _Doc:
    def __init__(self, design: Design, fonts: dict[str, _Font] | None = None) -> None:
        self.d = design
        self.fonts = fonts or {"r": _font("r"), "b": _font("b")}
        self.pages: list[_Page] = [_Page()]
        self.y = PAGE_H - MARGIN_TOP
        self.x0, self.w = MARGIN_X, TEXT_W  # 지금 쓰는 칸 (두 단 = 반쪽씩)
        self.ink, self.body, self.muted = _c(design.ink), _c(design.text), _c(design.muted)
        self.accent, self.rule = _c(design.accent), _c(design.rule)

    @property
    def page(self) -> _Page:
        return self.pages[-1]

    @property
    def at_top(self) -> bool:
        return self.y >= PAGE_H - MARGIN_TOP - 0.1

    def new_page(self) -> None:
        if len(self.pages) >= MAX_PAGES:
            raise PdfError("too_large", f"PDF 는 {MAX_PAGES}쪽까지")
        self.pages.append(_Page())
        self.y = PAGE_H - MARGIN_TOP

    def room(self, h: float) -> None:
        """h 만큼 자리가 없으면 새 쪽 (쪽 맨 위면 그대로 · 아주 큰 칸이 끝없이 넘기지 않게)."""
        if self.y - h < MARGIN_BOTTOM and not self.at_top:
            self.new_page()

    # 그리기
    def fill(self, x: float, y: float, w: float, h: float, c: Color, r: float = 0) -> None:
        self.page.ops.append(f"{_rg(c)} rg {_rrect(x, y, w, h, r)} f 0 g")

    def line(self, x1: float, y1: float, x2: float, y2: float, c: Color, width: float = 0.6) -> None:
        self.page.ops.append(f"{_rg(c)} RG {width:g} w {x1:.2f} {y1:.2f} m {x2:.2f} {y2:.2f} l S")

    def text(self, x: float, y: float, line: Line, size: float, color: Color | None = None, page: _Page | None = None) -> None:
        col = color or self.body
        ops = (page or self.page).ops
        for chunk, bold in line:
            f = self.fonts["b" if bold else "r"]
            hexs = "".join(f"{f.gid(c):04X}" for c in chunk)
            ops.append(f"BT {_rg(col)} rg /F{'2' if bold else '1'} {size:g} Tf 1 0 0 1 {x:.2f} {y:.2f} Tm <{hexs}> Tj ET")
            x += f.width(chunk, size)

    def width(self, line: Line, size: float) -> float:
        return sum(self.fonts["b" if bold else "r"].width(t, size) for t, bold in line)

    def lines(self, lines: list[Line], x: float, size: float, lead: float, *, color: Color | None = None, first: str | None = None,
              first_x: float = 0, first_color: Color | None = None, align: str = "left", width: float = 0) -> None:
        for i, line in enumerate(lines):
            self.room(lead)
            base = self.y - size * 0.86 - (lead - size) / 2
            if i == 0 and first:
                self.text(first_x, base, [(first, False)], size, first_color or color)
            lx = x + (width - self.width(line, size) if align == "right" else 0)
            self.text(lx, base, line, size, color)
            self.y -= lead

    def block(self, runs: Runs, size: float, before: float, after: float, *, x: float | None = None, width: float | None = None,
              marker: str | None = None, marker_x: float = 0, keep_next: bool = False, color: Color | None = None,
              marker_color: Color | None = None, lead: float | None = None) -> None:
        x = self.x0 if x is None else x
        width = self.w if width is None else width
        lead = lead or size * LEADING
        wrapped = wrap(runs, width, size, self.fonts)
        if not self.at_top:
            self.y -= before
        self.room(lead * (min(len(wrapped), 2) + (2 if keep_next else 0)))  # 제목은 다음 줄과 같은 쪽 · 첫 두 줄은 함께
        self.lines(wrapped, x, size, lead, color=color, first=marker, first_x=marker_x, first_color=marker_color)
        self.y -= after

    # 제목 (디자인마다 모양)
    def heading(self, level: int, runs: Runs, number: str, keep_next: bool) -> None:
        d = self.d
        size = HEAD.get(level, HEAD[3])
        bold = [(t, True) for t, _ in runs]
        before = size * (1.5 if level == 1 else 1.1)
        if level == 3:
            self.block(bold, size, before * 0.8, 3, color=self.accent, keep_next=keep_next)
            return
        lead = size * 1.35
        shift = 0.0
        if d.heading == "bar":
            shift = 11.0 if level == 1 else 9.0
        if d.heading == "number" and number:
            shift = self.fonts["b"].width(number, size) + size * 0.6
        wrapped = wrap(bold, self.w - shift, size, self.fonts)
        if not self.at_top:
            self.y -= before
        self.room(lead * (len(wrapped) + (2 if keep_next else 0)))
        top = self.y
        if d.heading == "number" and number:
            self.text(self.x0, top - size * 0.86 - (lead - size) / 2, [(number, True)], size, self.accent)
        self.lines(wrapped, self.x0 + shift, size, lead, color=self.ink)
        if d.heading == "bar":
            self.fill(self.x0, self.y + (lead - size) / 2 - 1, 3.5 if level == 1 else 2.5, top - self.y - (lead - size) + 2, self.accent)
        if level == 1 and d.heading == "number":
            self.y -= 4
            self.line(self.x0, self.y, self.x0 + self.w, self.y, self.rule, 0.8)
            self.y -= 2
        elif d.heading == "underline":
            self.y -= 3
            ww = min(self.w, max(self.width(ln, size) for ln in wrapped)) if level == 1 else min(self.w, 28.0)
            self.line(self.x0, self.y, self.x0 + ww, self.y, self.accent, 2.0 if level == 1 else 1.4)
            self.y -= 2
        self.y -= 6 if level == 1 else 4

    def title(self, runs: Runs) -> None:
        self.block([(t, True) for t, _ in runs], TITLE, 0, 8, color=self.ink, keep_next=True, lead=TITLE * 1.3)
        self.fill(self.x0, self.y - 3, 36, 3, self.accent)
        self.y -= 22

    def cover(self, title: str, subtitle: str, date: str, by: str) -> None:
        """표지 = 첫 쪽 하나 (디자인 cover 모양) → 다음 쪽."""
        d = self.d
        if not self.at_top or len(self.pages) > 1:
            self.new_page()
        self.page.cover = True
        fg, sub = _c(d.cover_text), _c(d.cover_sub)
        if d.cover in ("dark", "tint"):
            self.fill(0, 0, PAGE_W, PAGE_H, _c(d.cover_bg))
        if d.cover == "band":
            self.fill(0, PAGE_H - 168, PAGE_W, 168, _c(d.cover_bg))
            self.fill(0, PAGE_H - 174, PAGE_W, 6, self.accent if d.accent != d.cover_bg else _c(d.soft))
        x, w = MARGIN_X + 6, TEXT_W - 12
        size = 30.0
        lines = wrap([(title, True)], w, size, self.fonts)
        sub_lines = wrap([(subtitle, False)], w, 14, self.fonts) if subtitle else []
        block_h = len(lines) * size * 1.25 + (len(sub_lines) * 14 * 1.5 + 14 if sub_lines else 0)
        top = PAGE_H - 300 if d.cover == "band" else PAGE_H * 0.42 + block_h
        self.fill(x, top + 18, 44, 4, self.accent)  # 짧은 강조 막대
        self.y = top
        self.lines(lines, x, size, size * 1.25, color=fg)
        if sub_lines:
            self.y -= 14
            self.lines(sub_lines, x, 14, 14 * 1.5, color=sub)
        meta = [m for m in (date, by) if m]
        if meta:
            y = MARGIN_BOTTOM + 30
            if d.cover in ("none", "band"):
                self.line(x, y + 22, x + w, y + 22, self.rule, 0.6)
            self.text(x, y, [("   |   ".join(meta), False)], 10.5, sub)
        self.new_page()

    def kpis(self, cards: Sequence[tuple[str, str, str]]) -> None:
        n = len(cards)
        if not n:
            return
        gap = 10.0
        cw = (self.w - gap * (n - 1)) / n
        h = 74.0 if any(c[2] for c in cards) else 62.0
        if not self.at_top:
            self.y -= 8
        self.room(h)
        top = self.y
        soft = _c(self.d.soft)
        for i, (label, value, note) in enumerate(cards):
            x = self.x0 + i * (cw + gap)
            self.fill(x, top - h, cw, h, soft, 6)
            self.text(x + 12, top - 20, wrap([(label, False)], cw - 24, 9, self.fonts)[0], 9, self.muted)
            vsize = 22.0 if self.fonts["b"].width(value, 22) <= cw - 24 else 16.0
            self.text(x + 12, top - 22 - vsize, wrap([(value, True)], cw - 24, vsize, self.fonts)[0], vsize, self.accent)
            if note:
                self.text(x + 12, top - h + 12, wrap([(note, False)], cw - 24, 8.5, self.fonts)[0], 8.5, self.muted)
        self.y = top - h - 14

    def callout(self, bar: Color, bg: Color, title: str, runs: Runs) -> None:
        pad = 12.0
        size = BODY
        lead = size * 1.55
        body = wrap(runs, self.w - pad * 2 - 4, size, self.fonts)
        head = wrap([(title, True)], self.w - pad * 2 - 4, size, self.fonts) if title else []
        h = (len(head) + len(body)) * lead + pad * 2 + (3 if head else 0)
        if not self.at_top:
            self.y -= 6
        self.room(min(h, PAGE_H - MARGIN_TOP - MARGIN_BOTTOM))
        top = self.y
        self.fill(self.x0, top - h, self.w, h, bg, 5)
        self.fill(self.x0, top - h, 3.5, h, bar)
        self.y = top - pad
        if head:
            self.lines(head, self.x0 + pad + 4, size, lead, color=self.ink)
            self.y -= 3
        self.lines(body, self.x0 + pad + 4, size, lead)
        self.y = min(self.y, top - h) - 12

    def quote(self, runs: Runs, by: str) -> None:
        size = 12.5
        lead = size * 1.55
        lines = wrap(runs, self.w - 22, size, self.fonts)
        if not self.at_top:
            self.y -= 6
        self.room(lead * min(len(lines), 3))
        top = self.y
        self.lines(lines, self.x0 + 18, size, lead, color=self.ink)
        if by:
            self.y -= 2
            self.lines(wrap([(f"— {by}", False)], self.w - 22, 9.5, self.fonts), self.x0 + 18, 9.5, 9.5 * 1.6, color=self.muted)
        self.fill(self.x0, self.y + 2, 2.5, top - self.y - 2, self.accent)
        self.y -= 12

    def divider(self) -> None:
        self.y -= 8
        self.room(12)
        self.line(self.x0, self.y, self.x0 + self.w, self.y, self.rule, 0.8)
        self.y -= 12

    def table(self, rows: list[list[str]]) -> None:
        if not rows:
            return
        f = self.fonts
        d = self.d
        cols = len(rows[0])
        head = len(rows) > 1
        nat = [min(max((f["b" if head and r == 0 else "r"].width(row[c], TABLE_SIZE) for r, row in enumerate(rows)), default=0) + CELL_PAD * 2,
                   self.w * 0.6) for c in range(cols)]
        weights = [max(n, 40.0) for n in nat]
        total = sum(weights) or 1.0
        widths = [self.w * wgt / total for wgt in weights]
        lead = TABLE_SIZE * 1.45
        num = [all(_NUMERIC.match(row[c] or "0") for row in rows[1 if head else 0 :]) for c in range(cols)]
        head_fill, head_text, zebra = _c(d.head_fill), _c(d.head_text), _c(d.zebra)

        def layout(r: int) -> tuple[list[list[Line]], float]:
            cells = [wrap([(rows[r][c], head and r == 0)], widths[c] - CELL_PAD * 2, TABLE_SIZE, f) for c in range(cols)]
            return cells, max(len(c) for c in cells) * lead + CELL_PAD * 2 + 2

        def draw(r: int, cells: list[list[Line]], h: float) -> None:
            x = self.x0
            top = self.y
            is_head = head and r == 0
            if is_head:
                self.fill(self.x0, top - h, self.w, h, head_fill)
            elif (r % 2 == 0 and head) or (r % 2 == 1 and not head):
                self.fill(self.x0, top - h, self.w, h, zebra)
            for c in range(cols):
                y = top - CELL_PAD - 1
                for line in cells[c]:
                    tx = x + CELL_PAD
                    if num[c]:
                        tx = x + widths[c] - CELL_PAD - self.width(line, TABLE_SIZE)
                    self.text(tx, y - TABLE_SIZE * 0.86 - (lead - TABLE_SIZE) / 2, line, TABLE_SIZE, head_text if is_head else self.body)
                    y -= lead
                x += widths[c]
            self.line(self.x0, top - h, self.x0 + self.w, top - h, self.rule, 0.5)
            self.y -= h

        if not self.at_top:
            self.y -= 6
        header = layout(0) if head else None
        for r in range(len(rows)):
            cells, h = layout(r)
            if self.y - h < MARGIN_BOTTOM and not self.at_top:
                self.new_page()
                if header and r > 0:
                    draw(0, *header)
            draw(r, cells, h)
        self.y -= 12

    def run(self, blocks: Sequence[Block]) -> None:
        for i, b in enumerate(blocks):
            nxt = blocks[i + 1][0] if i + 1 < len(blocks) else None
            k = b[0]
            if k == "title":
                self.title(b[1])
            elif k == "cover":
                self.cover(b[1], b[2], b[3], b[4])
            elif k == "heading":
                self.heading(b[1], b[2], b[3], keep_next=nxt not in (None, "pagebreak"))
            elif k == "para":
                self.block(b[1], BODY, 0, BODY * 0.7)
            elif k == "item":
                lvl, marker, runs = b[1], b[2], b[3]
                x = self.x0 + INDENT * (lvl + 1)  # 글 시작 · 글머리표는 그 왼쪽에 오른쪽 맞춤
                self.block(runs, BODY, 0, BODY * 0.25, x=x, width=self.w - (x - self.x0), marker=marker,
                           marker_x=x - self.fonts["r"].width(marker, BODY) - 5, marker_color=self.accent)
                if nxt != "item":
                    self.y -= BODY * 0.5
            elif k == "table":
                self.table(b[1])
            elif k == "kpis":
                self.kpis(b[1])
            elif k == "callout":
                self.callout(_c(b[1]), _c(b[2]), b[3], b[4])
            elif k == "quote":
                self.quote(b[1], b[2])
            elif k == "divider":
                self.divider()
            elif k == "columns":
                self.columns(b[1], b[2])
            elif k == "pagebreak":
                self.new_page()

    def columns(self, left: Sequence[Block], right: Sequence[Block]) -> None:
        """두 단 — 먼저 따로 그려 높이를 재고, 이 쪽에 안 들어가면 새 쪽. 한 쪽보다 길면 위아래로 (쪽 사이로 단을 나누지 않는다)."""
        gap = 18.0
        cw = (self.w - gap) / 2

        def height(blocks: Sequence[Block]) -> float:
            probe = _Doc(self.d, self.fonts)
            probe.x0, probe.w = self.x0, cw
            probe.y = PAGE_H - MARGIN_TOP - 1  # 맨 위가 아닌 셈 (앞 간격 포함)
            probe.run(blocks)
            if len(probe.pages) > 1:
                return float("inf")
            return PAGE_H - MARGIN_TOP - 1 - probe.y

        h = max(height(left), height(right))
        if h == float("inf"):
            self.run([*left, *right])
            return
        if not self.at_top:
            self.y -= 4
        self.room(h)
        top, x0, w = self.y, self.x0, self.w
        self.x0, self.w = x0, cw
        self.run(left)
        y_left = self.y
        self.y, self.x0 = top, x0 + cw + gap
        self.run(right)
        self.y = min(y_left, self.y)
        self.x0, self.w = x0, w

    def finish(self) -> None:
        """쪽 번호 (표지 빼고 · 본문 첫 쪽 = 1) — 글 흐름 맨 끝에 (되읽을 때 본문이 먼저)."""
        n = 0
        for p in self.pages:
            if p.cover:
                continue
            n += 1
            label = str(n)
            w = self.fonts["r"].width(label, 8.5)
            self.text(PAGE_W / 2 - w / 2, MARGIN_BOTTOM - 30, [(label, False)], 8.5, self.muted, page=p)


_NUMERIC = re.compile(r"^[\s+\-−]?[$₩€¥]?\s?[\d,.]+\s?(%|원|명|개|곳|건|배|점|만|억|천|[kKmMbB])?$")


def _rrect(x: float, y: float, w: float, h: float, r: float) -> str:
    if r <= 0:
        return f"{x:.2f} {y:.2f} {w:.2f} {h:.2f} re"
    r = min(r, w / 2, h / 2)
    k = r * 0.5523
    x1, y1 = x + w, y + h
    return (f"{x + r:.2f} {y:.2f} m {x1 - r:.2f} {y:.2f} l {x1 - r + k:.2f} {y:.2f} {x1:.2f} {y + r - k:.2f} {x1:.2f} {y + r:.2f} c "
            f"{x1:.2f} {y1 - r:.2f} l {x1:.2f} {y1 - r + k:.2f} {x1 - r + k:.2f} {y1:.2f} {x1 - r:.2f} {y1:.2f} c "
            f"{x + r:.2f} {y1:.2f} l {x + r - k:.2f} {y1:.2f} {x:.2f} {y1 - r + k:.2f} {x:.2f} {y1 - r:.2f} c "
            f"{x:.2f} {y + r:.2f} l {x:.2f} {y + r - k:.2f} {x + r - k:.2f} {y:.2f} {x + r:.2f} {y:.2f} c h")


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


def render(blocks: Sequence[Block], *, title: str = "", design: Design | None = None) -> bytes:
    """블록 → PDF 바이트. 자리가 모자라면 새 쪽 · MAX_PAGES 를 넘으면 PdfError."""
    doc = _Doc(design or DESIGNS["clean"])
    doc.run(blocks)
    if len(doc.pages) > 1 and not doc.pages[-1].ops:  # 마지막이 표지 뒤 빈 쪽 = 뺀다
        doc.pages.pop()
    doc.finish()

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


