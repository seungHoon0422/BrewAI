"""제품 스킬 (runtime/skills) — 로더 안전장치 · use_skill 툴 · skill:<이름> 단계 · /api/skills · 관리자 카탈로그 · 연결 시험."""

from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx2
import pytest
from openai import AsyncOpenAI
from pydantic_ai.messages import ModelMessage, ModelRequest, ToolReturnPart, UserPromptPart
from pydantic_ai.models.function import AgentInfo, DeltaToolCall, FunctionModel
from pydantic_ai.models.test import TestModel

from conductor.agent import INSTRUCTIONS
from conductor.skills import MAX_SKILL_BYTES, SkillError, load_skills, parse_skill
from conductor.tools import SKILL_TOOLS, ToolSpec

KNOWN = ["calculator", "unit_convert", "count_chars"]  # known_tools 검사용 이름 (내장 툴은 없다 · 꽂은 툴 이름을 준다고 치고)
STARTERS = ["compare-table", "excel-sheet", "ppt-deck", "summarize", "word-doc"]  # 평소 쓰는 글 스킬 2 + 문서 파일 스킬 3 (slice 08)
DOC_SKILLS = {"excel-sheet", "ppt-deck", "word-doc"}  # tools: [make_file]


def count_chars(text: str) -> dict[str, Any]:
    """글자 수를 센다 (테스트 툴).

    Args:
        text: 셀 글.
    """
    return {"characters": len(text)}


COUNT = ToolSpec(name="count_chars", label="글자 수", description="글자 수를 센다.", function=count_chars)


def skill_md(name: str = "demo", *, description: str = "데모 스킬. 테스트할 때.", extra: str = "", body: str = "# 데모\n\n1. 한다") -> str:
    return f"---\nname: {name}\nlabel: 데모\ndescription: {description}\n{extra}---\n{body}\n"


def write(root: Path, name: str, text: str | bytes) -> Path:
    d = root / name
    d.mkdir(parents=True, exist_ok=True)
    f = d / "SKILL.md"
    f.write_bytes(text if isinstance(text, bytes) else text.encode("utf-8"))
    return f


# ── 스타터 스킬 (레포) ──


def test_starter_skills_load_cleanly(h) -> None:
    reg = load_skills(h.SKILLS_DIR, known_tools=SKILL_TOOLS)
    assert reg.errors == []
    assert [s.name for s in reg.list()] == STARTERS
    for s in reg.list():
        assert len(s.version) == 12 and int(s.version, 16) >= 0
        assert s.label and s.description and s.body and s.builtin and s.source == "runtime/skills"
        assert s.tools == (("make_file",) if s.name in DOC_SKILLS else ())  # 문서 스킬 = 부르면 make_file 이 실린다
        assert "·" not in s.description  # 스킬 화면에 보이는 글 (가운뎃점 금지)
        assert "관리자" not in s.description  # 사용자 앱(스킬 메뉴)에 보이는 글
        for gone in ("text_stats", "unit_convert", "calculator", "current_time", "date_calc"):
            assert gone not in s.body
    # 시스템 프롬프트 = 한 줄 (스킬 수 + 화면 이름 · 이름 순 · 설명 · 본문 없음) · 도구 스키마 = need (스킬 이름 enum 없음 = 스킬이 늘어도 그대로)
    assert reg.prompt() == "\n스킬 5개 (비교표 만들기, Excel 표, 발표 자료, 요약, Word 문서): 맞을 것 같으면 먼저 use_skill {need}"
    schema = reg.tool().schema  # type: ignore[union-attr]
    assert list(schema["properties"]) == ["need", "name"] and schema["required"] == ["need"] and "enum" not in json.dumps(schema)


def test_prompt_and_schema_stay_small_as_skills_grow(tmp_path: Path) -> None:
    for i in range(30):
        write(tmp_path, f"s{i:02d}", skill_md(f"s{i:02d}", description=f"스킬 {i} 설명."))
    reg = load_skills(tmp_path)
    assert len(reg.skills) == 30
    assert reg.prompt().count("데모") == 12 and reg.prompt().endswith("외 18개): 맞을 것 같으면 먼저 use_skill {need}")
    one = tmp_path / "one"
    write(one, "s00", skill_md("s00"))
    assert reg.tool().schema == load_skills(one).tool().schema  # type: ignore[union-attr]  # 스킬 30개 = 1개와 같은 스키마


@pytest.mark.parametrize(("need", "want"), [
    ("분기 보고서를 워드로", "word-doc"), ("회의록 docx 로", "word-doc"), ("엑셀 파일로 정리해 줘", "excel-sheet"), ("csv 로 뽑아 줘", "excel-sheet"),
    ("스프레드시트", "excel-sheet"), ("피피티 만들어 줘", "ppt-deck"), ("PPT 슬라이드", "ppt-deck"), ("발표 자료", "ppt-deck"),
    ("이 글 요약해 줘", "summarize"), ("세 제품 비교", "compare-table"),
])
def test_use_skill_finds_by_need(h, need: str, want: str) -> None:
    out = load_skills(h.SKILLS_DIR, known_tools=SKILL_TOOLS).tool().function(need)  # type: ignore[union-attr]
    assert out["name"] == want and out["instructions"], need
    assert out["tools"] == (["make_file"] if want in DOC_SKILLS else [])


def test_use_skill_no_match_lists_names(h) -> None:
    tool = load_skills(h.SKILLS_DIR).tool()
    out = tool.function("날씨 알려 줘")  # type: ignore[union-attr]
    assert out["error"] == "no_skill" and out["available"][0] == "compare-table 비교표 만들기" and len(out["available"]) == 5
    assert tool.function("", name="summarize")["name"] == "summarize"  # type: ignore[union-attr]  # 이름을 알면 (예전 기록)


# ── 머리말 오류 ──


@pytest.mark.parametrize(
    ("text", "code"),
    [
        ("name: demo\n---\nbody", "frontmatter"),
        ("---\nname: demo\ndescription: x\nbody", "frontmatter"),
        ("---\nname: demo\ndescription: x\nrun: rm -rf /\n---\nbody", "bad_key"),
        ("---\nname: demo\nname: demo\ndescription: x\n---\nbody", "bad_key"),
        ("---\nname: Demo_Skill\ndescription: x\n---\nbody", "bad_name"),
        ("---\nname: other\ndescription: x\n---\nbody", "bad_name"),
        ("---\nname: demo\ndescription:\n---\nbody", "bad_description"),
        ("---\nname: demo\ndescription: " + "가" * 301 + "\n---\nbody", "bad_description"),
        ("---\nname: demo\nlabel: " + "가" * 41 + "\ndescription: x\n---\nbody", "bad_label"),
        ("---\nname: demo\ndescription: x\ntools: [calculator, shell]\n---\nbody", "bad_tools"),
        ("---\nname: demo\ndescription: x\ntools: calculator\n---\nbody", "bad_tools"),
        ("---\nname: demo\ndescription: x\n---\n   \n", "empty_body"),
        ("---\nname demo\ndescription: x\n---\nbody", "frontmatter"),
    ],
)
def test_frontmatter_errors(text: str, code: str) -> None:
    with pytest.raises(SkillError) as e:
        parse_skill(text, dirname="demo", known_tools=KNOWN)
    assert e.value.code == code


def test_frontmatter_forms_and_crlf_version() -> None:
    lf = skill_md(extra="tools:\n  - calculator\n  - unit_convert\n")
    s = parse_skill(lf, dirname="demo", known_tools=KNOWN)
    assert s.tools == ("calculator", "unit_convert") and s.label == "데모" and s.body == "# 데모\n\n1. 한다"
    crlf = parse_skill(lf.replace("\n", "\r\n"), dirname="demo", known_tools=KNOWN)
    assert crlf.version == s.version  # 윈도우 체크아웃(CRLF)도 같은 버전
    quoted = parse_skill(skill_md(description='"따옴표: 안의 콜론"', extra="tools: ['calculator']\n"), dirname="demo", known_tools=KNOWN)
    assert quoted.description == "따옴표: 안의 콜론" and quoted.tools == ("calculator",)
    assert parse_skill(skill_md(), dirname="demo").label == "데모"


# ── 로더 안전장치 ──


def test_loader_skips_bad_skills_and_keeps_good(tmp_path: Path) -> None:
    write(tmp_path, "good", skill_md("good"))
    write(tmp_path, "big", skill_md("big", body="가" * (MAX_SKILL_BYTES // 3 + 10)))  # 16KB 넘음
    write(tmp_path, "Bad_Dir", skill_md("bad-dir"))
    write(tmp_path, "latin", "---\nname: latin\ndescription: x\n---\nb".encode("utf-8") + b"\xff\xfe")
    write(tmp_path, "wrong", skill_md("other"))
    (tmp_path / "empty").mkdir()
    (tmp_path / "file.md").write_text("x", encoding="utf-8")  # 폴더 아님
    (tmp_path / ".hidden").mkdir()  # 숨김 폴더는 조용히 건너뛴다
    reg = load_skills(tmp_path, known_tools=KNOWN)
    assert [s.name for s in reg.list()] == ["good"]
    assert {e["dir"]: e["code"] for e in reg.errors} == {
        "Bad_Dir": "bad_name", "big": "too_large", "empty": "missing_file", "file.md": "not_a_dir",
        "latin": "not_utf8", "wrong": "bad_name",
    }
    assert load_skills(tmp_path / "nope").list() == [] and load_skills(None).list() == []


@pytest.mark.skipif(os.name == "nt", reason="윈도우는 심볼릭 링크에 권한이 필요하다")
def test_loader_rejects_links_out_of_root(tmp_path: Path) -> None:
    root, outside = tmp_path / "skills", tmp_path / "outside"
    root.mkdir()
    secret = write(outside, "leak", skill_md("leak"))
    (root / "leak").symlink_to(outside / "leak", target_is_directory=True)  # 폴더 링크
    (root / "inner").mkdir()
    (root / "inner" / "SKILL.md").symlink_to(secret)  # 파일 링크 → root 밖
    write(root, "ok", skill_md("ok"))
    reg = load_skills(root, known_tools=KNOWN)
    assert [s.name for s in reg.list()] == ["ok"]
    assert {e["dir"]: e["code"] for e in reg.errors} == {"leak": "not_a_dir", "inner": "outside_root"}


def test_use_skill_tool_only_returns_registered_skills(tmp_path: Path) -> None:
    write(tmp_path, "demo", skill_md())
    reg = load_skills(tmp_path, known_tools=KNOWN)
    tool = reg.tool()
    assert tool is not None and tool.name == "use_skill" and tool.label == "스킬 사용"
    assert tool.function("", name="demo") == {"name": "demo", "label": "데모", "tools": [], "instructions": "# 데모\n\n1. 한다"}
    assert tool.function("데모 해 줘")["name"] == "demo"  # need 로 찾음
    for bad in ("../x", "x/../../etc", "/etc/passwd", "", "y" * 200):
        out = tool.function(bad, name=bad)
        assert out["error"] == "no_skill" and out["available"] == ["demo 데모"], bad
    assert load_skills(None).tool() is None  # 스킬 없음 = 툴도 없음


# ── 대화: use_skill → skill:<이름> 단계 · 기록 · 사용 횟수 ──


def _skill_then_tool_model(seen: dict[str, Any]) -> FunctionModel:
    """use_skill(summarize) → count_chars(테스트 툴) → 답. (mock 게이트웨이 [fake:skill] 과 같은 흐름)"""

    async def stream(messages: list[ModelMessage], info: AgentInfo) -> AsyncIterator[Any]:
        seen.setdefault("instructions", info.instructions)
        seen.setdefault("tools", [t.name for t in info.function_tools])
        last_user = max(i for i, m in enumerate(messages) if isinstance(m, ModelRequest) and any(isinstance(p, UserPromptPart) for p in m.parts))
        returns = [p for m in messages[last_user:] if isinstance(m, ModelRequest) for p in m.parts if isinstance(p, ToolReturnPart)]
        if not returns:
            yield {0: DeltaToolCall(name="use_skill", json_args='{"need": ', tool_call_id=f"s{len(messages)}")}
            yield {0: DeltaToolCall(json_args='"글 요약"}', tool_call_id=f"s{len(messages)}")}
            return
        if len(returns) == 1:
            seen["skill_result"] = returns[0].content
            yield {0: DeltaToolCall(name="count_chars", json_args='{"text": "가나다 라"}', tool_call_id=f"t{len(messages)}")}
            return
        yield f"요약 끝 ({returns[-1].content['characters']}자)"

    return FunctionModel(stream_function=stream)


def test_chat_uses_a_skill_with_skill_step(make_api, h) -> None:
    seen: dict[str, Any] = {}
    api = make_api(lambda _: _skill_then_tool_model(seen), skills=load_skills(h.SKILLS_DIR), tools=[COUNT])
    events = api.chat("이 글 요약해 줘")
    t = h.types(events)
    assert events[-1]["type"] == "RUN_FINISHED"
    steps = [e["stepName"] for e in events if e["type"] == "STEP_STARTED"]
    assert steps == ["skill:summarize", "tool:count_chars", "writing"]
    # 단계가 언제나 그 단계 첫 이벤트보다 먼저 (인자를 다 받은 뒤 스킬 이름으로 연다)
    i_step = next(i for i, e in enumerate(events) if e.get("stepName") == "skill:summarize")
    i_start = next(i for i, e in enumerate(events) if e["type"] == "TOOL_CALL_START" and e["toolCallName"] == "use_skill")
    assert i_step < i_start and t[i_start + 1 : i_start + 4] == ["TOOL_CALL_ARGS", "TOOL_CALL_ARGS", "TOOL_CALL_END"]
    assert events[1]["value"]["skills"] == STARTERS and "use_skill" in events[1]["value"]["tools"]
    assert seen["instructions"].startswith(INSTRUCTIONS) and "요약, Word 문서" in seen["instructions"]
    assert "use_skill" in seen["tools"]
    assert seen["skill_result"]["name"] == "summarize" and "3줄" in seen["skill_result"]["instructions"]  # 본문은 그때 준다
    run = api.client.get("/api/runs").json()[0]
    assert [(s["name"], s["label"]) for s in run["steps"]] == [
        ("skill:summarize", "스킬: 요약"), ("tool:count_chars", "글자 수"), ("writing", "답 쓰기"),
    ]
    parts = api.client.get("/api/threads/thread-1").json()["messages"][1]["parts"]
    card = parts[0]
    assert card["name"] == "use_skill" and card["label"] == "스킬 사용" and card["args"] == {"need": "글 요약"}
    assert "instructions" not in card["result"] and card["result"]["label"] == "요약" and card["result"]["lines"] > 3  # 화면엔 본문 안 보냄
    assert parts[1]["name"] == "count_chars" and parts[1]["result"]["characters"] == 5
    used = {s["name"]: s["used"] for s in api.client.get("/api/skills").json()}
    assert used == {"compare-table": 0, "excel-sheet": 0, "ppt-deck": 0, "summarize": 1, "word-doc": 0}
    api.chat("한 번 더 요약")
    assert {s["name"]: s["used"] for s in api.client.get("/api/skills").json()}["summarize"] == 2


def test_unknown_skill_name_still_closes_the_step(make_api, h) -> None:
    async def stream(messages: list[ModelMessage], info: AgentInfo) -> AsyncIterator[Any]:
        if not any(isinstance(p, ToolReturnPart) for m in messages if isinstance(m, ModelRequest) for p in m.parts):
            yield {0: DeltaToolCall(name="use_skill", json_args='{"name": "../../etc/passwd"}', tool_call_id="s1")}
            return
        yield "없는 스킬이에요"

    api = make_api(lambda _: FunctionModel(stream_function=stream), skills=load_skills(h.SKILLS_DIR))
    events = api.chat("아무거나")
    assert [e["stepName"] for e in events if e["type"] == "STEP_STARTED"] == ["skill:unknown", "writing"]
    result = next(e for e in events if e["type"] == "TOOL_CALL_RESULT")
    assert json.loads(result["content"])["error"] == "no_skill"
    assert api.client.get("/api/runs").json()[0]["steps"][0]["status"] == "done"


def test_skills_endpoints_and_admin_catalog(make_api, h) -> None:
    api = make_api(lambda _: TestModel(), skills=load_skills(h.SKILLS_DIR))
    desk = api.client.get("/api/skills").json()
    assert [s["name"] for s in desk] == STARTERS
    assert set(desk[0]) == {"name", "label", "description", "tools", "builtin", "used"}  # 데스크톱엔 버전·출처 없음
    admin = api.client.get("/api/admin/skills").json()
    assert admin["source"] == "runtime/skills" and admin["errors"] == []
    row = admin["skills"][0]
    assert row | {"name": "compare-table", "source": "runtime/skills", "builtin": True, "used": 0} == row
    assert len(row["version"]) == 12
    # 사용자 앱 ↔ 관리자 분리: 관리자 카탈로그는 관리자 출처만
    assert api.client.get("/api/admin/skills", headers={"origin": "app://brewai"}).status_code == 403
    tools = api.client.get("/api/tools").json()
    assert [t["name"] for t in tools] == ["use_skill", "make_file"] and tools[1]["label"] == "파일 만들기"  # 문서 스킬이 여는 도구 = 스킬 화면 이름
    assert make_api(lambda _: TestModel()).client.get("/api/skills").json() == []  # 스킬 폴더 없음 = 빈 목록


# ── 관리자 '연결 시험' ──


def _probe_client(handler) -> AsyncOpenAI:
    return AsyncOpenAI(
        base_url="http://gateway.invalid/v1", api_key="sk-test-secret-0000", max_retries=0,
        http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(handler)),
    )


def test_model_probe_ok_and_failure_are_recorded(make_api, h) -> None:
    sent: list[dict[str, Any]] = []
    fail = {"on": False}

    def handler(req: httpx2.Request) -> httpx2.Response:
        body = json.loads(req.content)
        sent.append(body)
        if fail["on"]:
            return httpx2.Response(401, json={"error": {
                "message": "litellm.AuthenticationError: Missing Anthropic API Key - A call is being made to anthropic but no key is set",
                "type": "authentication_error", "param": None, "code": "401",
            }})
        return httpx2.Response(200, json={
            "id": "x", "object": "chat.completion", "created": 1, "model": body["model"],
            "choices": [{"index": 0, "message": {"role": "assistant", "content": "pong"}, "finish_reason": "length"}],
        })

    api = make_api(lambda _: TestModel(), openai_client=_probe_client(handler))
    c = api.client
    ok = c.post("/api/admin/models/fake-chat-small/test").json()
    assert ok | {"model": "fake-chat-small", "ok": True, "code": None, "detail": None} == ok and ok["at"]
    assert isinstance(ok["duration_ms"], int) and ok["duration_ms"] >= 0  # 응답 시간 (관리자 연결 칸 · 자세히 페이지)
    assert sent[0]["max_tokens"] == 16 and sent[0]["drop_params"] is True and sent[0]["messages"][0]["content"] == "ping"
    assert "tools" not in sent[0] and "reasoning_effort" not in sent[0]
    row = next(r for r in c.get("/api/admin/models").json() if r["id"] == "fake-chat-small")
    assert row["last_ok_at"] == ok["at"] and row["last_error_code"] is None

    fail["on"] = True
    bad = c.post("/api/admin/models/fake-chat-large/test").json()  # 숨긴 모델·후보도 시험할 수 있다
    assert (bad["ok"], bad["code"], bad["detail"], bad["status"]) == (False, "provider_auth_failed", "provider_key_missing", 401)
    assert isinstance(bad["duration_ms"], int) and bad["duration_ms"] >= 0
    assert "sk-test" not in json.dumps(bad) and "Missing" not in json.dumps(bad)
    row = next(r for r in c.get("/api/admin/models").json() if r["id"] == "fake-chat-large")
    assert row["last_error_code"] == "provider_key_missing" and row["last_error_at"] == bad["at"]

    assert c.post("/api/admin/models/gpt-9/test").json() == {"detail": "model_not_found"}
    assert c.post("/api/admin/models/fake-embed/test").json() == {"detail": "not_chat_model"}
    assert c.post("/api/admin/models/fake-chat-small/test", headers={"origin": "app://brewai"}).status_code == 403


def test_model_probe_gateway_down(make_api) -> None:
    def handler(req: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("refused", request=req)

    api = make_api(lambda _: TestModel(), openai_client=_probe_client(handler))
    res = api.client.post("/api/admin/models/fake-chat-small/test").json()
    assert (res["ok"], res["code"], res["detail"]) == (False, "gateway_unreachable", None)
    row = next(r for r in api.client.get("/api/admin/models").json() if r["id"] == "fake-chat-small")
    assert row["last_error_code"] == "gateway_unreachable"


def test_chat_success_records_model_ok(make_api) -> None:
    api = make_api(lambda _: TestModel(custom_output_text="ok", call_tools=[]))
    api.chat()
    row = next(r for r in api.client.get("/api/admin/models").json() if r["id"] == "fake-chat-small")
    assert row["last_ok_at"] and row["last_error_code"] is None
