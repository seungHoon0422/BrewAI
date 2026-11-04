"""문서 디자인 4종 (make_file design · slice 08) — 색 · 표지 · 제목 모양 한 벌을 docx · pptx · pdf · xlsx 가 같이 쓴다.

색은 6자리 hex (RRGGBB · # 없음). 색은 아껴 쓴다: 강조색 = 제목 장식 · 표 머리 · 숫자 카드 값 · 표지 면 하나. 본문 글은 늘 짙은 회색.
cover = 표지 쪽 모양 (none 흰 쪽에 큰 제목 + 선 · band 위에 강조색 띠 · dark 진한 면 · tint 옅은 면)
heading = 제목 모양 (bold 굵게 · bar 왼쪽 띠 · number 번호 + 아래 선 · underline 강조색 밑줄)
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Literal

Cover = Literal["none", "band", "dark", "tint"]
Heading = Literal["bold", "bar", "number", "underline"]


@dataclass(frozen=True)
class Design:
    id: str
    label: str
    description: str
    accent: str  # 강조 (제목 장식 · 표 머리 · 숫자 값)
    ink: str  # 제목 글
    text: str  # 본문 글
    muted: str  # 옅은 글 (설명 · 쪽 번호)
    soft: str  # 옅은 바탕 (카드 · 강조 상자)
    zebra: str  # 표 줄무늬
    rule: str  # 선 · 테두리
    head_fill: str  # 표 머리 바탕
    head_text: str  # 표 머리 글
    cover: Cover
    cover_bg: str  # 표지 면 (dark · tint) · 띠 (band)
    cover_text: str  # 표지 위 제목 글
    cover_sub: str  # 표지 위 부제 글
    heading: Heading

    def public(self) -> dict[str, Any]:
        d = asdict(self)
        return {"id": d["id"], "label": d["label"], "description": d["description"],
                "colors": {k: f"#{d[k]}" for k in ("accent", "ink", "soft", "cover_bg")}}


DESIGNS: dict[str, Design] = {d.id: d for d in (
    Design("clean", "깔끔", "흰 바탕에 회색 한 가지. 무엇에나 어울리는 기본",
           accent="334155", ink="0F172A", text="1E293B", muted="64748B", soft="F1F5F9", zebra="F8FAFC", rule="CBD5E1",
           head_fill="F1F5F9", head_text="0F172A", cover="none", cover_bg="334155", cover_text="0F172A", cover_sub="475569", heading="bold"),
    Design("report", "보고서", "남색 띠 표지와 왼쪽 띠 제목. 보고, 기획서, 공문",
           accent="1E3A5F", ink="1E3A5F", text="1F2933", muted="5F6B7A", soft="EAF0F6", zebra="F5F8FB", rule="C5D1DE",
           head_fill="1E3A5F", head_text="FFFFFF", cover="band", cover_bg="1E3A5F", cover_text="1E3A5F", cover_sub="3E5673", heading="bar"),
    Design("modern", "모던", "진한 표지에 파란 포인트, 번호 붙은 제목. 발표, 제안, 기술 문서",
           accent="2563EB", ink="0B1220", text="1F2937", muted="6B7280", soft="EEF3FE", zebra="F7F9FC", rule="D7DEE8",
           head_fill="0B1220", head_text="FFFFFF", cover="dark", cover_bg="0B1220", cover_text="FFFFFF", cover_sub="A9B8D0", heading="number"),
    Design("warm", "따뜻함", "베이지 표지와 주황 밑줄. 안내문, 사내 소식, 행사",
           accent="C8582A", ink="3B2416", text="3A2E27", muted="8A7262", soft="FBF0E7", zebra="FDF8F3", rule="EAD8C8",
           head_fill="F6E6D6", head_text="3B2416", cover="tint", cover_bg="F5E9DC", cover_text="3B2416", cover_sub="8A5A3C", heading="underline"),
)}
DEFAULT = "clean"
TONES: dict[str, tuple[str, str]] = {  # 강조 상자 tone → (띠 · 바탕)
    "ok": ("1F8A4C", "E9F6EF"),
    "warn": ("B7791F", "FDF4E3"),
}


def get(design: Any) -> Design:
    """모르는 이름 · 빈 값 = 깔끔."""
    return DESIGNS.get(str(design or "").strip().lower(), DESIGNS[DEFAULT])


def tone(d: Design, name: Any) -> tuple[str, str]:
    """강조 상자 색 (info = 그 디자인의 강조색)."""
    return TONES.get(str(name or ""), (d.accent, d.soft))


def rgb(hex6: str) -> tuple[float, float, float]:
    return tuple(int(hex6[i : i + 2], 16) / 255 for i in (0, 2, 4))  # type: ignore[return-value]


def listing() -> list[dict[str, Any]]:
    return [d.public() for d in DESIGNS.values()]


# 디자인 견본 (GET /api/designs/{id}/preview.png) — 같은 글을 디자인마다 (표지 · 숫자 카드 · 제목 · 강조 상자 · 표)
SAMPLE_BLOCKS: list[dict[str, Any]] = [
    {"type": "cover", "title": "3분기 사업 보고", "subtitle": "매출과 고객, 다음 분기 계획", "date": "2026년 10월", "by": "전략기획팀"},
    {"type": "heading", "text": "요약", "level": 1},
    {"type": "kpis", "cards": [{"label": "매출", "value": "12%", "note": "지난 분기보다"}, {"label": "신규 고객", "value": "40곳"},
                               {"label": "재계약률", "value": "91%"}]},
    {"type": "paragraph", "text": "3분기 매출은 **12% 늘었고** 비용은 4% 줄었다. 기업 고객 비중이 커지면서 평균 계약 금액도 함께 올랐다."},
    {"type": "callout", "tone": "info", "title": "다음 분기 핵심", "text": "기업 고객 온보딩 기간을 2주에서 1주로 줄인다."},
    {"type": "heading", "text": "세부 수치", "level": 2},
    {"type": "table", "rows": [["항목", "3분기", "2분기", "변화"], ["매출", "1,200", "1,071", "+12%"], ["비용", "800", "830", "-4%"],
                               ["영업이익", "400", "241", "+66%"]]},
]
