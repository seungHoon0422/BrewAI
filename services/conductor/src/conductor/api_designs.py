"""문서 디자인 견본 (slice 08) — 설정 › 스킬 화면의 '문서 디자인' 카드.

  GET /api/designs                    [{id, label, description, colors}] (designs.py · 디자인 4종)
  GET /api/designs/{id}/preview.png   그 디자인으로 그린 견본 PDF 의 표지 · 본문 첫 쪽을 나란히 한 PNG (메모리에 한 번만 · 로그인한 사람)
"""

from __future__ import annotations

import threading
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import Response

from . import designs as ds
from . import docmake as dm
from . import files as fl
from .auth.accounts import Principal
from .auth.http import require_user
from .auth.policy import Denied

_cache: dict[str, bytes] = {}
_lock = threading.Lock()


PAGE_H_PX, GAP_PX, BG = 520, 22, (236, 239, 243)


def _side_by_side(pdf: bytes) -> bytes:
    """견본 PDF 의 표지 · 본문 첫 쪽을 나란히 (옅은 회색 바탕 · 쪽 그림자 대신 테두리 1px) → PNG 한 장."""
    import pypdfium2 as pdfium  # 견본을 그릴 때만

    doc = pdfium.PdfDocument(pdf)
    try:
        shots = []
        for i in range(min(2, len(doc))):
            page = doc[i]
            w, h = page.get_size()
            bm = page.render(scale=PAGE_H_PX / h, rev_byteorder=True)
            shots.append((bm.width, bm.height, bm.stride, bytes(bm.buffer)))
            bm.close()
            page.close()
    finally:
        doc.close()
    pw = max(s[0] for s in shots)
    width, height = GAP_PX + len(shots) * (pw + GAP_PX), PAGE_H_PX + GAP_PX * 2
    bg, edge = bytes(BG), bytes((214, 219, 226))
    rows = [bytearray(bg * width) for _ in range(height)]
    for n, (w, h, stride, rgb) in enumerate(shots):
        x0 = GAP_PX + n * (pw + GAP_PX)
        for y in range(-1, h + 1):  # 위아래 1px 테두리
            row = rows[GAP_PX + y]
            if y in (-1, h):
                row[(x0 - 1) * 3 : (x0 + w + 1) * 3] = edge * (w + 2)
                continue
            row[(x0 - 1) * 3 : x0 * 3] = edge
            row[x0 * 3 : (x0 + w) * 3] = rgb[y * stride : y * stride + w * 3]
            row[(x0 + w) * 3 : (x0 + w + 1) * 3] = edge
    return fl._png(width, height, width * 3, b"".join(rows))


def preview(design_id: str) -> bytes:
    """견본 = 표지 + 본문 첫 쪽을 나란히 한 PNG (메모리에 디자인마다 한 번)."""
    with _lock:
        got = _cache.get(design_id)
        if got is None:
            made = dm.make({"kind": "pdf", "name": "견본", "design": design_id, "blocks": ds.SAMPLE_BLOCKS})
            got = _cache[design_id] = _side_by_side(made.data)
        return got


def register(user: APIRouter) -> None:
    @user.get("/api/designs")
    async def list_designs(p: Principal = Depends(require_user)) -> list[dict[str, Any]]:
        return ds.listing()

    @user.get("/api/designs/{design_id}/preview.png")
    def design_preview(design_id: str, p: Principal = Depends(require_user)) -> Response:
        """def = 스레드풀에서 그린다 (채팅 스트림을 막지 않는다)."""
        if design_id not in ds.DESIGNS:
            raise Denied(404, "design_not_found")
        return Response(preview(design_id), media_type="image/png", headers={
            "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=86400", "Content-Security-Policy": "default-src 'none'",
        })
