"""파일 (slice 07 · ADR-0015): 형식 판정 · 뽑기 · 거절 · 전달 계획 · API 권한 · 대화에 싣기 · 지난 턴 원본 안 보냄 · read_file · hello 그대로."""

from __future__ import annotations

import io
import json
import zipfile
from datetime import UTC, datetime
from typing import Any

import pytest

from conductor import files as fl
from conductor import tools as tools_mod
from conductor.skills import load_skills

from .test_tokens import Wire

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def pdf(pages: list[str]) -> bytes:
    """글이 든 아주 작은 PDF (Helvetica · 쪽마다 한 줄)."""
    objs: list[bytes] = []
    kids = " ".join(f"{3 + 2 * i} 0 R" for i in range(len(pages)))
    objs.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objs.append(f"<< /Type /Pages /Kids [{kids}] /Count {len(pages)} >>".encode())
    font = 3 + 2 * len(pages)
    for i, text in enumerate(pages):
        stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode()
        objs.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {4 + 2 * i} 0 R /Resources << /Font << /F1 {font} 0 R >> >> >>".encode())
        objs.append(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for n, body in enumerate(objs, 1):
        offsets.append(out.tell())
        out.write(f"{n} 0 obj\n".encode() + body + b"\nendobj\n")
    xref = out.tell()
    out.write(f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode())
    for o in offsets:
        out.write(f"{o:010d} 00000 n \n".encode())
    out.write(f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return out.getvalue()


def office(entries: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, body in entries.items():
            z.writestr(name, body)
    return buf.getvalue()


W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
DOCX = office({"word/document.xml": f"<w:document {W}><w:body><w:p><w:r><w:t>회의록 첫 줄</w:t></w:r></w:p><w:p><w:r><w:t>결정: 금요일 배포</w:t></w:r></w:p></w:body></w:document>"})
S = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
XLSX = office({
    "xl/workbook.xml": f'<workbook {S} {R}><sheets><sheet name="매출" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                                  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/sharedStrings.xml": f"<sst {S}><si><t>제품</t></si><si><t>노트북</t></si></sst>",
    "xl/worksheets/sheet1.xml": f'<worksheet {S}><sheetData><row r="1"><c t="s"><v>0</v></c><c><v>금액</v></c></row>'
                                f'<row r="2"><c t="s"><v>1</v></c><c><v>1200</v></c></row></sheetData></worksheet>',
})
A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
PPTX = office({"ppt/presentation.xml": "<p/>", "ppt/slides/slide2.xml": f"<s {A}><a:p><a:r><a:t>둘째 장</a:t></a:r></a:p></s>",
               "ppt/slides/slide1.xml": f"<s {A}><a:p><a:r><a:t>첫 장 제목</a:t></a:r></a:p></s>"})


# ── 형식 · 뽑기 · 거절 ──
def test_sniff_by_bytes_not_extension() -> None:
    assert fl.sniff(PNG) == ("image", "image/png")
    assert fl.sniff(b"\xff\xd8\xff\xe0rest")[1] == "image/jpeg"
    assert fl.sniff(b"RIFF\x00\x00\x00\x00WEBPVP8 ")[1] == "image/webp"
    assert fl.sniff(pdf(["A"]))[0] == "pdf"
    assert fl.sniff("가나다 hello".encode())[0] == "text"
    assert [fl.sniff(x)[0] for x in (DOCX, XLSX, PPTX)] == ["docx", "xlsx", "pptx"]
    for bad in (b"\x00\x01\x02binary", b"\xff\xfe\x00\x00", office({"a.txt": "x"})):  # 바이너리 · 깨진 UTF-8 · 그냥 zip
        with pytest.raises(fl.FileError) as e:
            fl.sniff(bad)
        assert e.value.code == "unsupported_type"


def test_extract_office_pdf_text() -> None:
    assert fl.parse(DOCX).chunks[0].text == "회의록 첫 줄\n결정: 금요일 배포"
    x = fl.parse(XLSX).chunks
    assert x[0].label == "시트 매출" and x[0].text == "제품 | 금액\n노트북 | 1200"
    p = fl.parse(PPTX)
    assert [c.label for c in p.chunks] == ["슬라이드 1", "슬라이드 2"] and p.chunks[0].text == "첫 장 제목" and p.pages == 2  # 번호 순
    d = fl.parse(pdf(["Hello page one", "Second page"]))
    assert d.pages == 2 and [c.label for c in d.chunks] == ["1쪽", "2쪽"] and "Hello page one" in d.chunks[0].text


def test_reject_bombs_doctype_and_size() -> None:
    bomb = office({"word/document.xml": "<w:document/>", "pad.bin": "0" * (fl.ZIP_MAX_UNCOMPRESSED + 1)})
    with pytest.raises(fl.FileError) as e:
        fl.parse(bomb)
    assert e.value.code == "file_too_complex"
    xxe = office({"word/document.xml": '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]><w:document>&a;</w:document>'})
    with pytest.raises(fl.FileError) as e:
        fl.parse(xxe)
    assert e.value.code == "bad_file"
    with pytest.raises(fl.FileError) as e:
        fl.parse(b"")
    assert e.value.code == "empty_file"
    with pytest.raises(fl.FileError) as e:
        fl.parse(PNG + b"\x00" * fl.IMAGE_MAX)
    assert e.value.code == "image_too_large"
    assert fl.clean_name("../../etc/pa\x00sswd") == "passwd" and fl.clean_name("") == "파일"
    assert fl.clean_name("\u1100\u1161\u11a8.png") == "각.png"  # 맥 NFD → NFC


def test_provider_rejections_for_attachments_are_not_blamed_on_thinking() -> None:
    from conductor import diagnose as dx

    big = "litellm.BadRequestError: AnthropicException - messages.0.content.1.image.source.base64.data: image dimensions exceed max allowed size: 8000 pixels"
    assert dx.classify_http(400, "invalid_request_error", {"message": big}, reasoning=True).detail == "image_rejected"
    pdf_msg = "AnthropicException - document: PDF exceeds maximum of 100 pages"
    assert dx.classify_http(400, "invalid_request_error", {"message": pdf_msg}, reasoning=True).detail == "file_rejected"


# ── 전달 계획 ──
def row(kind: str, *, size: int = 1000, pages: int | None = None, tokens: int = 100) -> fl.FileRow:
    return fl.FileRow("f_" + "0" * 20, "u", "s", None, None, None, "a", kind, "m", size, "h", pages, tokens, "t")  # type: ignore[arg-type]


def test_plan_per_model() -> None:
    vision_pdf, plain = fl.Caps(vision=True, pdf=True), fl.Caps(vision=False, pdf=False)
    assert fl.plan(row("image"), vision_pdf).mode == "original"
    assert fl.plan(row("image"), plain).row() == {"mode": "blocked", "tokens": 0, "reason": "vision_unsupported"}
    assert fl.plan(row("pdf", pages=3), vision_pdf).mode == "original"
    assert fl.plan(row("pdf", pages=3), plain).row()["mode"] == "text" and fl.plan(row("pdf", pages=3), plain).reason == "pdf_unsupported"
    big = fl.plan(row("pdf", pages=fl.PDF_NATIVE_PAGES + 1, tokens=50_000), vision_pdf)
    assert (big.mode, big.reason) == ("outline", "pdf_too_big") and big.tokens < fl.INLINE_TOKENS
    assert fl.plan(row("docx", tokens=200), plain).mode == "text"
    assert fl.plan(row("text", tokens=fl.INLINE_TOKENS + 1), vision_pdf).row()["reason"] == "too_long"


# ── API · 대화 ──
@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(tools_mod, "_now", lambda: datetime(2026, 11, 3, 5, 0, tzinfo=UTC))


def items(h: Any) -> list[dict[str, Any]]:
    return [h.group("fake-chat-small", ["openai"], supports_vision=True, supports_function_calling=True),
            h.group("fake-pdf", ["anthropic"], supports_vision=True, supports_pdf_input=True, supports_function_calling=True),
            h.group("fake-plain", ["openai"], supports_vision=False, supports_function_calling=True)]


def make(make_api: Any, h: Any, wire: Wire) -> Any:
    return make_api(None, items(h), openai_client=wire.client(), skills=load_skills(h.SKILLS_DIR),
                    bootstrap_models=("fake-chat-small", "fake-pdf", "fake-plain"))


def upload(c: Any, data: bytes, name: str, **q: str) -> Any:
    return c.put("/api/files", params={"name": name, **q}, content=data)


def user_parts(body: dict[str, Any]) -> list[Any]:
    last = [m for m in body["messages"] if m["role"] == "user"][-1]["content"]
    return last if isinstance(last, list) else [{"type": "text", "text": last}]


def test_upload_list_permissions_delete(make_api, h, clock) -> None:
    api = make(make_api, h, Wire())
    res = upload(api.client, DOCX, "회의록.docx")
    assert res.status_code == 201, res.text
    f = res.json()
    assert (f["kind"], f["name"], f["where"]["kind"]) == ("docx", "회의록.docx", "draft") and f["text_tokens"] > 0
    assert api.client.get(f"/api/files/{f['id']}").json()["labels"] == ["1"]
    # 남 = 아직 안 보낸 내 첨부를 못 본다 (404 · 있는지 숨김)
    api.add_user("bob@brewai.test")
    bob = api.login("bob@brewai.test")
    assert bob.get(f"/api/files/{f['id']}").status_code == 404
    assert bob.get(f"/api/files/{f['id']}/content").status_code == 404
    assert bob.delete(f"/api/files/{f['id']}").status_code == 404
    content = api.client.get(f"/api/files/{f['id']}/content")
    assert content.status_code == 200 and content.content == DOCX and content.headers["content-disposition"].startswith("attachment")
    assert "회의록" not in content.headers["content-disposition"]  # 이름은 헤더에 넣지 않는다
    assert [x["id"] for x in api.client.get("/api/files").json()] == [f["id"]]
    assert upload(api.client, b"\x00\x01binary", "a.exe").json() == {"detail": "unsupported_type"}
    assert api.client.delete(f"/api/files/{f['id']}").status_code == 204
    assert api.client.get(f"/api/files/{f['id']}").status_code == 404


def test_project_files_listed_and_readable_by_members(make_api, h, clock) -> None:
    wire = Wire(lambda body, n: ("tools", [("read_file", {"file": "회의록", "query": "배포"})]) if n == 1 else ("text", "금요일이에요"))
    api = make(make_api, h, wire)
    space = api.client.get("/api/spaces").json()["spaces"][0]["id"]
    proj = api.client.post(f"/api/spaces/{space}/projects", json={"name": "출시"}).json()["id"]
    f = upload(api.client, DOCX, "회의록.docx", space=space, project=proj).json()
    assert f["where"] == {"kind": "project", "id": proj, "title": "출시"}
    events = api.chat("배포 언제야?", projectId=proj, spaceId=space)
    first = wire.sent[0]
    system = "\n".join(m["content"] for m in first["messages"] if m["role"] == "system")
    assert f"프로젝트 파일 (read_file 로 읽는다" in system and f"회의록.docx ({f['id']})" in system
    assert "read_file" in [t["function"]["name"] for t in first["tools"]]
    result = next(e for e in events if e["type"] == "TOOL_CALL_RESULT")
    got = json.loads(result["content"])
    assert got["untrusted"] is True and "금요일 배포" in got["text"] and got["parts"] == ["1"]


def test_attach_image_goes_as_original_to_vision_model_and_not_resent(make_api, h, clock) -> None:
    wire = Wire()
    api = make(make_api, h, wire)
    img = upload(api.client, PNG, "화면.png").json()
    api.chat("이 화면 뭐야?", model="fake-chat-small", files=[img["id"]], thread="t-img")
    parts = user_parts(wire.sent[0])
    assert parts[0] == {"type": "text", "text": "이 화면 뭐야?"}
    assert any(p.get("type") == "image_url" and p["image_url"]["url"].startswith("data:image/png;base64,") for p in parts)
    assert "read_file" in [t["function"]["name"] for t in wire.sent[0]["tools"]]  # 파일이 있는 대화 = read_file
    # 다음 턴: 원본을 다시 보내지 않는다 (이름 한 줄)
    api.chat("고마워", model="fake-chat-small", thread="t-img")
    replay = json.dumps(wire.sent[-1]["messages"], ensure_ascii=False)
    assert "base64" not in replay and "[첨부 원본: 화면.png" in replay
    # 다시 열기 = 내 말풍선의 첨부 칩
    msgs = api.client.get("/api/threads/t-img").json()["messages"]
    assert [x["name"] for x in msgs[0]["files"]] == ["화면.png"] and "files" not in msgs[2]
    # 저장된 기록에도 바이트가 없다
    assert "iVBOR" not in json.dumps([r["messages"] for r in api.store.thread_runs("t-img")])


def test_attach_to_plain_model_text_pdf_and_blocked_image(make_api, h, clock) -> None:
    wire = Wire()
    api = make(make_api, h, wire)
    doc = upload(api.client, pdf(["Quarterly numbers"]), "q.pdf").json()
    img = upload(api.client, PNG, "a.png").json()
    plan = api.client.post("/api/files/plan", json={"model": "fake-plain", "files": [doc["id"], img["id"]]}).json()
    assert [(p["mode"], p["reason"]) for p in plan] == [("text", "pdf_unsupported"), ("blocked", "vision_unsupported")]
    assert [p["mode"] for p in api.client.post("/api/files/plan", json={"model": "fake-pdf", "files": [doc["id"], img["id"]]}).json()] == ["original", "original"]
    api.chat("요약해 줘", model="fake-plain", files=[doc["id"], img["id"]], thread="t-plain")
    parts = user_parts(wire.sent[0])
    texts = "\n".join(p.get("text", "") for p in parts)
    assert "Quarterly numbers" in texts and "받을 수 없어 이름만" in texts
    assert not any(p.get("type") in ("image_url", "file") for p in parts)


def test_pdf_original_to_pdf_model(make_api, h, clock) -> None:
    wire = Wire()
    api = make(make_api, h, wire)
    doc = upload(api.client, pdf(["Hello"]), "a.pdf").json()
    api.chat("봐 줘", model="fake-pdf", files=[doc["id"]], thread="t-pdf")
    parts = user_parts(wire.sent[0])
    assert any(p.get("type") == "file" and p["file"]["file_data"].startswith("data:application/pdf;base64,") for p in parts)


def test_files_must_be_mine_and_unbound(make_api, h, clock) -> None:
    api = make(make_api, h, Wire())
    mine = upload(api.client, b"hello", "a.txt").json()
    api.chat("봐", files=[mine["id"]], thread="t-a")
    res = api.client.post("/api/chat", json=h.chat_body("다른 대화", thread="t-b", run="r-b", files=[mine["id"]]))
    assert res.json() == {"detail": "bad_files"}  # 다른 대화에 이미 묶인 파일
    api.add_user("bob@brewai.test")
    bob = api.login("bob@brewai.test")
    res = bob.post("/api/chat", json=h.chat_body("훔치기", thread="t-c", run="r-c", files=[mine["id"]]))
    assert res.json() == {"detail": "bad_files"}
    assert api.client.post("/api/chat", json=h.chat_body("x", thread="t-d", run="r-d", files=["nope"])).json() == {"detail": "bad_files"}


def test_hello_without_files_has_no_read_file(make_api, h, clock) -> None:
    wire = Wire()
    api = make(make_api, h, wire)
    api.chat("hello")
    assert [t["function"]["name"] for t in wire.sent[0]["tools"]] == ["use_skill"]
    assert all("파일" not in m["content"] for m in wire.sent[0]["messages"] if m["role"] == "system")


def test_only_files_message_gets_default_prompt(make_api, h, clock) -> None:
    wire = Wire()
    api = make(make_api, h, wire)
    f = upload(api.client, b"memo text", "memo.txt").json()
    res = api.client.post("/api/chat", json=h.chat_body("", thread="t-e", run="r-e", files=[f["id"]]))
    assert res.status_code == 200, res.text
    assert user_parts(wire.sent[0])[0]["text"] == "첨부한 파일을 살펴봐 줘."
