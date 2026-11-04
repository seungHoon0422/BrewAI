"""링크 미리보기 (답 아래 링크 카드 · linkpreview.py) — 데스크톱은 바깥 사이트 · 그림을 직접 부르지 않는다 (CSP).

  GET /api/links/preview?url=   {url, title, description, site, image: '/api/links/image/<sha>' | null} · 못 만듦 = 404 no_preview
                                · 막힌 주소 = 422 blocked · 1분 30번 넘음 = 429 rate_limited (로그인한 사람)
  GET /api/links/image/{sha}    미리보기를 만들 때 받아 둔 그림만 (png · jpeg · webp · gif) · 없으면 404 — 이 경로로는 아무 데도 나가지 않는다
"""

from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response

from .auth.accounts import Principal
from .auth.http import require_user
from .auth.policy import Denied
from .linkpreview import Blocked, LinkPreviewer, RateLimited

_SHA = re.compile(r"^[0-9a-f]{32}$")


def register(user: APIRouter, *, links: LinkPreviewer) -> None:
    @user.get("/api/links/preview")
    async def link_preview(url: str = Query(..., max_length=2048), p: Principal = Depends(require_user)) -> dict[str, Any]:
        try:
            got = await links.preview(url, user=p.user_id)
        except Blocked as e:
            raise Denied(422, "blocked") from e
        except RateLimited as e:
            raise Denied(429, "rate_limited") from e
        if got is None:
            raise Denied(404, "no_preview")
        return got.body()

    @user.get("/api/links/image/{sha}")
    async def link_image(sha: str, p: Principal = Depends(require_user)) -> Response:
        got = links.image(sha) if _SHA.match(sha) else None
        if got is None:
            raise Denied(404, "image_not_found")
        mime, data = got
        return Response(data, media_type=mime, headers={
            "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=86400", "Content-Security-Policy": "default-src 'none'",
        })
