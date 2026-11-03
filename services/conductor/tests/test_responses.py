"""게이트웨이 mode = responses 모델 (Azure 사용자 지정 배포 azure/responses/…) = LiteLLM `/v1/responses` 를 바로 (OpenAIResponsesModel).

LiteLLM 1.106.2 의 chat→Responses 다리는 스트림 툴 인자를 두 번 이어 붙여 보냈다 ('{…}{…}' → json_invalid → model_error) →
responses 모델은 다리를 안 탄다. 가짜 LiteLLM (httpx2.MockTransport) 이 두 길을 다 받는다: /v1/responses (Responses SSE) ·
/v1/chat/completions (chat chunk). 진짜 OpenAI SDK · 진짜 Pydantic AI 모델이 바이트를 만든다.
hello · use_app → MCP 도구 (인자 한 번) · 사용량 (캐시 읽기 · 생각) · 생각 끔 / 켬 (요약 → REASONING_*) · 팀원 · 연결 시험 ·
같은 대화에서 chat ↔ responses 모델 바꾸기 (provider id 안 샘) · chat 모델은 여전히 /chat/completions ·
실행 안 툴 루프에 생각을 '<think>' 글로 다시 안 보냄 · 별칭 이름(gpt-5.5)과 상관없는 요청 모양 · 200 본문 실패 연결 시험.
"""

from __future__ import annotations

import json
from typing import Any

from conductor import team as tm
from conductor.agent import INSTRUCTIONS
from conductor.connectors.vault import generate_key

TERRA = "GPT-6.1 Terra"
GPT55 = "gpt-5.5"  # Pydantic AI profile 이 이름으로 encrypted · reasoning context 를 켜는 별칭 (Azure 배포를 이 이름으로 노출)
USAGE = {"input_tokens": 120, "input_tokens_details": {"cached_tokens": 80}, "output_tokens": 30,
         "output_tokens_details": {"reasoning_tokens": 7}, "total_tokens": 150}


def _items(h) -> list[dict[str, Any]]:  # noqa: ANN001
    terra = h.group(TERRA, ["azure"], mode="responses", supports_function_calling=True, supports_reasoning=True, max_output_tokens=128000)
    gpt55 = h.group(GPT55, ["azure"], mode="responses", supports_function_calling=True, supports_reasoning=True, max_output_tokens=128000)
    return [*h.fixture_items(), terra, gpt55]


class Gateway:
    """가짜 LiteLLM. plan(path, body, n) → ('text', 글) | ('tools', [(이름, 인자) …]) · thought = 생각 요약 글 (Responses 만).
    받은 (경로, 본문) 을 sent 에 남긴다. 연결 시험(stream 없음)은 JSON 한 번."""

    def __init__(self, plan: Any = None, *, thought: str | None = None, usage: dict[str, Any] | None = None,
                 probe: dict[str, Any] | None = None) -> None:
        self.sent: list[tuple[str, dict[str, Any]]] = []
        self.plan = plan or (lambda path, body, n: ("text", "안녕하세요"))
        self.thought = thought
        self.usage = usage or USAGE
        self.probe = probe  # 연결 시험 /v1/responses 의 200 본문 덮어쓰기 (status · error · incomplete_details)

    def bodies(self, path: str) -> list[dict[str, Any]]:
        return [b for p, b in self.sent if p == path]

    # ── /v1/responses (Responses SSE · openai 3.36 types/responses) ──
    def _response(self, n: int, status: str, output: list[dict[str, Any]], usage: dict[str, Any] | None) -> dict[str, Any]:
        return {"id": f"resp_{n}", "object": "response", "created_at": 1761696000, "model": TERRA, "status": status, "output": output,
                "parallel_tool_calls": True, "tool_choice": "auto", "tools": [], "usage": usage, "error": None,
                "incomplete_details": None, "instructions": None, "metadata": {}, "temperature": None, "top_p": None}

    def _responses_sse(self, body: dict[str, Any], n: int) -> str:
        kind, value = self.plan("/v1/responses", body, n)
        events: list[dict[str, Any]] = [{"type": "response.created", "response": self._response(n, "in_progress", [], None)}]
        output: list[dict[str, Any]] = []
        if self.thought and "reasoning" in body:
            rid = f"rs_{n}"
            part = {"type": "summary_text", "text": self.thought}
            half = len(self.thought) // 2
            events += [
                {"type": "response.output_item.added", "output_index": 0, "item": {"type": "reasoning", "id": rid, "summary": []}},
                {"type": "response.reasoning_summary_part.added", "item_id": rid, "output_index": 0, "summary_index": 0,
                 "part": {"type": "summary_text", "text": ""}},
                {"type": "response.reasoning_summary_text.delta", "item_id": rid, "output_index": 0, "summary_index": 0,
                 "delta": self.thought[:half]},
                {"type": "response.reasoning_summary_text.delta", "item_id": rid, "output_index": 0, "summary_index": 0,
                 "delta": self.thought[half:]},
                {"type": "response.reasoning_summary_text.done", "item_id": rid, "output_index": 0, "summary_index": 0, "text": self.thought},
                {"type": "response.reasoning_summary_part.done", "item_id": rid, "output_index": 0, "summary_index": 0, "part": part},
                {"type": "response.output_item.done", "output_index": 0, "item": {"type": "reasoning", "id": rid, "summary": [part]}},
            ]
            output.append({"type": "reasoning", "id": rid, "summary": [part]})
        if kind == "tools":
            for i, (name, args) in enumerate(value):
                idx, fid, raw = len(output), f"fc_{n}_{i}", json.dumps(args, ensure_ascii=False)
                item = {"type": "function_call", "id": fid, "call_id": f"call_{n}_{i}", "name": name, "arguments": "", "status": "in_progress"}
                done = item | {"arguments": raw, "status": "completed"}
                events += [
                    {"type": "response.output_item.added", "output_index": idx, "item": item},
                    {"type": "response.function_call_arguments.delta", "item_id": fid, "output_index": idx, "delta": raw[:5]},
                    {"type": "response.function_call_arguments.delta", "item_id": fid, "output_index": idx, "delta": raw[5:]},
                    {"type": "response.function_call_arguments.done", "item_id": fid, "output_index": idx, "arguments": raw, "name": name},
                    {"type": "response.output_item.done", "output_index": idx, "item": done},
                ]
                output.append(done)
        else:
            idx, mid = len(output), f"msg_{n}"
            text = {"type": "output_text", "text": value, "annotations": []}
            item = {"type": "message", "id": mid, "role": "assistant", "status": "in_progress", "content": []}
            events += [
                {"type": "response.output_item.added", "output_index": idx, "item": item},
                {"type": "response.content_part.added", "item_id": mid, "output_index": idx, "content_index": 0,
                 "part": text | {"text": ""}},
                {"type": "response.output_text.delta", "item_id": mid, "output_index": idx, "content_index": 0, "delta": value,
                 "logprobs": []},
                {"type": "response.output_text.done", "item_id": mid, "output_index": idx, "content_index": 0, "text": value,
                 "logprobs": []},
                {"type": "response.content_part.done", "item_id": mid, "output_index": idx, "content_index": 0, "part": text},
                {"type": "response.output_item.done", "output_index": idx, "item": item | {"status": "completed", "content": [text]}},
            ]
            output.append(item | {"status": "completed", "content": [text]})
        events.append({"type": "response.completed", "response": self._response(n, "completed", output, self.usage)})
        return "".join(f"event: {e['type']}\ndata: {json.dumps(e | {'sequence_number': i}, ensure_ascii=False)}\n\n"
                       for i, e in enumerate(events))

    # ── /v1/chat/completions (chat chunk) ──
    def _chat_sse(self, body: dict[str, Any], n: int) -> str:
        kind, value = self.plan("/v1/chat/completions", body, n)

        def chunk(delta: dict[str, Any] | None, finish: str | None = None) -> str:
            c = {"id": "x", "created": 1, "model": body["model"], "object": "chat.completion.chunk",
                 "choices": [] if delta is None else [{"index": 0, "delta": delta, "finish_reason": finish}]}
            return f"data: {json.dumps(c, ensure_ascii=False)}\n\n"

        if kind == "tools":
            calls = [{"index": i, "id": f"chat_{n}_{i}", "type": "function",
                      "function": {"name": name, "arguments": json.dumps(args, ensure_ascii=False)}} for i, (name, args) in enumerate(value)]
            out = chunk({"role": "assistant", "tool_calls": calls}) + chunk({}, "tool_calls")
        else:
            out = chunk({"role": "assistant", "content": value}) + chunk({}, "stop")
        return out + "data: [DONE]\n\n"

    def client(self) -> Any:
        import httpx2
        from openai import AsyncOpenAI

        def handler(req: httpx2.Request) -> httpx2.Response:
            path, body = req.url.path, json.loads(req.content)
            self.sent.append((path, body))
            n = len(self.sent)
            if not body.get("stream"):  # 연결 시험
                if path == "/v1/responses":
                    probe = self.probe or {"status": "incomplete", "incomplete_details": {"reason": "max_output_tokens"}}
                    return httpx2.Response(200, json=self._response(n, "incomplete", [], None) | probe)
                return httpx2.Response(200, json={"id": "x", "object": "chat.completion", "created": 1, "model": body["model"],
                                                  "choices": [{"index": 0, "message": {"role": "assistant", "content": "pong"}, "finish_reason": "length"}]})
            sse = self._responses_sse(body, n) if path == "/v1/responses" else self._chat_sse(body, n)
            return httpx2.Response(200, content=sse.encode(), headers={"content-type": "text/event-stream"})

        return AsyncOpenAI(base_url="http://gateway.invalid/v1", api_key="sk-test-secret-0000", max_retries=0,
                           http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(handler)))


def make(make_api, h, gw: Gateway, fake_mcp: Any = None) -> Any:  # noqa: ANN001, ANN401
    app_kw = {"mcp_transport": fake_mcp.Fake().transport} if fake_mcp is not None else {}
    return make_api(None, _items(h), bootstrap_models=("fake-chat-small", TERRA), openai_client=gw.client(), secret_key=generate_key(),
                    app_kw=app_kw)


def summary(events: list[dict[str, Any]]) -> dict[str, Any]:
    return next(e for e in events if e["type"] == "CUSTOM" and e["name"] == "brewai.run_summary")["value"]


def _think_items(body: dict[str, Any]) -> list[Any]:
    """생각을 다시 실은 항목: '<think>' assistant 글 (id 없이 보낸 ThinkingPart) · reasoning 항목."""
    return [i for i in body["input"] if i.get("type") == "reasoning"
            or (i.get("role") == "assistant" and "<think>" in str(i.get("content")))]


def _ids(body: dict[str, Any]) -> list[str]:
    """요청에 실린 provider id (rs_ · fc_ · msg_ · resp_ = 서버에 저장된 항목 · 응답 이름)."""
    text = json.dumps(body, ensure_ascii=False)
    return [p for p in ("rs_", "fc_", "msg_", "resp_") if f'"{p}' in text]


# ── hello · 사용량 · 생각 끔 ──


def test_responses_model_hello_goes_to_v1_responses(make_api, h) -> None:
    gw = Gateway()
    api = make(make_api, h, gw)
    events = api.chat("hello", model=TERRA)
    assert [p for p, _ in gw.sent] == ["/v1/responses"]  # chat→Responses 다리 (/chat/completions) 를 안 탄다
    body = gw.sent[0][1]
    assert body["model"] == TERRA and body["stream"] is True
    assert body["instructions"] == INSTRUCTIONS  # 시스템 지침 = instructions 칸 (날짜 없음 = 캐시 앞부분)
    assert [m["role"] for m in body["input"]] == ["user", "user"] and body["input"][1]["content"] == "hello"
    assert body["input"][0]["content"].startswith("지금: ")  # 날짜 · 시각 = 사용자 쪽 한 줄 (chat 과 같다)
    assert body["user"] == api.me["id"]  # openai_user → user (LiteLLM 요청 user = users.id)
    # 생각 끔 = reasoning 칸 없음 ('none' 을 안 보낸다) · 끔이면 drop_params 도 없음 (chat 과 같다) · 서버 상태 안 씀
    assert "reasoning" not in body and "drop_params" not in body
    assert "previous_response_id" not in body and "store" not in body and "include" not in body
    assert "".join(e["delta"] for e in events if e["type"] == "TEXT_MESSAGE_CONTENT") == "안녕하세요"
    assert not any(t.startswith("REASONING") for t in h.types(events))
    assert h.types(events)[-1] == "RUN_FINISHED"
    # 사용량 = Responses 모양 (input_tokens_details.cached_tokens · output_tokens_details.reasoning_tokens)
    u = summary(events)["usage"]
    assert u | {"input_tokens": 120, "output_tokens": 30, "requests": 1, "reasoning_tokens": 7, "cache_read_tokens": 80,
                "cache_write_tokens": 0} == u
    row = dict(api.store.query("SELECT * FROM usage_events")[0])
    assert (row["model"], row["input_tokens"], row["output_tokens"], row["reasoning_tokens"], row["cache_read_tokens"]) == (TERRA, 120, 30, 7, 80)


def test_chat_mode_model_still_uses_chat_completions(make_api, h) -> None:
    gw = Gateway()
    api = make(make_api, h, gw)
    api.chat("hello")  # 기본 모델 = fake-chat-small (mode chat)
    assert [p for p, _ in gw.sent] == ["/v1/chat/completions"]
    body = gw.sent[0][1]
    assert body["model"] == "fake-chat-small" and body["messages"][-1] == {"role": "user", "content": "hello"}
    assert not any(k.startswith("openai_") for k in body)


# ── use_app → MCP 도구 (인자 한 번) ──


def test_tool_call_arguments_arrive_once_and_replay_without_provider_ids(make_api, h, fake_mcp) -> None:
    def plan(path: str, body: dict[str, Any], n: int) -> tuple[str, Any]:
        outs = [i for i in body["input"] if i.get("type") == "function_call_output"]
        if not outs:
            return ("tools", [("use_app", {"app": "notes", "need": "따라 말하기"})])
        if len(outs) == 1:
            return ("tools", [("notes__echo", {"text": "안녕 MCP"})])
        return ("text", "끝")

    gw = Gateway(plan)
    api = make(make_api, h, gw, fake_mcp)
    assert api.client.post("/api/me/mcp/servers", json={"url": f"{fake_mcp.OPEN}/mcp", "name": "Notes"}).status_code in (200, 201)
    events = api.chat("노트 앱으로 따라 말해 줘", model=TERRA)
    assert h.types(events)[-1] == "RUN_FINISHED", [e for e in events if e["type"] == "RUN_ERROR"]
    assert [p for p, _ in gw.sent] == ["/v1/responses"] * 3
    # 인자 = 한 번 (다리처럼 '{…}{…}' 가 아니다) → 검사 통과 · 재시도 없음
    args: dict[str, str] = {}
    for e in events:
        if e["type"] == "TOOL_CALL_ARGS":
            args[e["toolCallId"]] = args.get(e["toolCallId"], "") + e["delta"]
    assert [json.loads(a) for a in args.values()] == [{"app": "notes", "need": "따라 말하기"}, {"text": "안녕 MCP"}]
    assert [e["stepName"] for e in events if e["type"] == "STEP_STARTED"][:2] == ["app:notes", "tool:notes__echo"]
    result = next(e for e in events if e["type"] == "TOOL_CALL_RESULT" and e["toolCallId"] == "call_2_0")
    assert "안녕 MCP" in result["content"]
    assert not any(i.get("type") == "function_call_output" and "retry" in str(i.get("output")).lower()
                   for b in gw.bodies("/v1/responses") for i in b["input"])
    # 도구 배열 = use_app → 공개된 notes__* (search_tools · additional_tools 없음 · chat 과 같은 고정 앞부분)
    names = [[t["name"] for t in b.get("tools", [])] for b in gw.bodies("/v1/responses")]
    assert names[0] == ["use_app"] and names[1][0] == "use_app" and "notes__echo" in names[1] and "search_tools" not in names[1]
    last = gw.sent[-1][1]
    assert not any(i.get("type") == "additional_tools" for i in last["input"])
    calls = [i for i in last["input"] if i.get("type") == "function_call"]
    assert [(c["call_id"], c["name"]) for c in calls] == [("call_1_0", "use_app"), ("call_2_0", "notes__echo")]
    assert all("id" not in c for c in calls) and _ids(last) == []  # 지난 응답 = 글 그대로 (fc_ · resp_ id 안 보냄)


# ── 생각 켬 (요약 → REASONING_*) ──


def test_reasoning_summary_becomes_ag_ui_reasoning(make_api, h) -> None:
    gw = Gateway(thought="질문을 둘로 나눠 본다.")
    api = make(make_api, h, gw)
    events = api.chat("어려운 질문", model=TERRA, reasoning="high")
    body = gw.sent[0][1]
    assert body["reasoning"] == {"effort": "high", "summary": "auto"} and body["drop_params"] is True
    assert "max_output_tokens" not in body  # 출력 한도는 Anthropic · Bedrock · Google 만 (chat 과 같다)
    kinds = h.types(events)
    assert kinds.index("REASONING_START") < kinds.index("REASONING_MESSAGE_CONTENT") < kinds.index("REASONING_END") < kinds.index("TEXT_MESSAGE_CONTENT")
    assert "".join(e["delta"] for e in events if e["type"] == "REASONING_MESSAGE_CONTENT") == "질문을 둘로 나눠 본다."
    assert [e["stepName"] for e in events if e["type"] == "STEP_STARTED"] == ["thinking", "writing"]
    run = next(e for e in events if e["type"] == "CUSTOM" and e["name"] == "brewai.run")["value"]
    assert run["reasoning"] == "high" and summary(events)["usage"]["reasoning_tokens"] == 7
    thread = api.client.get("/api/threads/thread-1").json()
    assert thread["messages"][1]["reasoning"] == "질문을 둘로 나눠 본다."
    # 보통(low) = medium (chat 과 같은 표)
    api.chat("다음", model=TERRA, reasoning="low")
    assert gw.sent[-1][1]["reasoning"] == {"effort": "medium", "summary": "auto"}
    assert _ids(gw.sent[-1][1]) == []  # 지난 턴 생각은 기록에서 뺀다 (load_history) · rs_ id 없음


# ── 같은 대화에서 모델 바꾸기 ──


def test_thread_switches_between_chat_and_responses_models(make_api, h) -> None:
    from conductor import tools as tools_mod

    def plan(path: str, body: dict[str, Any], n: int) -> tuple[str, Any]:
        if path == "/v1/responses":
            done = any(i.get("type") == "function_call_output" and i["call_id"] == "call_1_0" for i in body["input"])
            return ("text", "응답 모델 답") if done or n > 1 else ("tools", [("now", {})])
        return ("text", "채팅 모델 답")

    gw = Gateway(plan, thought="잠깐 생각")
    def now() -> dict[str, Any]:
        return {"time": "14:30"}

    spec = tools_mod.ToolSpec(name="now", label="지금", description="현재 시각", function=now)
    api = make_api(None, _items(h), bootstrap_models=("fake-chat-small", TERRA), openai_client=gw.client(), tools=(spec,))
    e1 = api.chat("몇 시야?", thread="sw", model=TERRA, reasoning="high")
    assert h.types(e1)[-1] == "RUN_FINISHED"
    e2 = api.chat("고마워", thread="sw", model="fake-chat-small")
    assert h.types(e2)[-1] == "RUN_FINISHED"
    chat = gw.bodies("/v1/chat/completions")[0]
    # Responses 가 만든 기록 → chat 메시지: call_id 그대로 · 생각(rs_) 은 뺐다 · fc_ · msg_ id 는 안 샌다
    assistant = [m for m in chat["messages"] if m["role"] == "assistant"]
    assert assistant[0]["tool_calls"][0]["id"] == "call_1_0" and assistant[-1]["content"] == "응답 모델 답"
    assert all(set(m) <= {"role", "content", "tool_calls"} for m in assistant) and _ids(chat) == []
    e3 = api.chat("다시", thread="sw", model=TERRA)
    assert h.types(e3)[-1] == "RUN_FINISHED"
    back = gw.sent[-1][1]
    assert gw.sent[-1][0] == "/v1/responses" and _ids(back) == []
    texts = [i["content"] for i in back["input"] if i.get("role") == "assistant"]
    assert texts == ["응답 모델 답", "채팅 모델 답"]  # 지난 답 = 글 그대로 (id 없는 assistant 메시지)
    assert [i["call_id"] for i in back["input"] if i.get("type") == "function_call"] == ["call_1_0"]


# ── 팀원 (slice 06) ──


def test_members_use_responses_too(make_api, h) -> None:
    def plan(path: str, body: dict[str, Any], n: int) -> tuple[str, Any]:
        if (body.get("instructions") or "").startswith(tm.MEMBER_INSTRUCTIONS):
            task = next(i["content"] for i in body["input"] if i.get("role") == "user")
            return ("text", f"{task} 결과")
        if any(i.get("type") == "function_call_output" for i in body["input"]):
            return ("text", "합쳤어요")
        return ("tools", [("delegate", {"role": "가격 조사", "task": "가격 찾기"}), ("delegate", {"role": "사양 조사", "task": "사양 찾기"})])

    gw = Gateway(plan)
    api = make(make_api, h, gw)
    events = api.chat("노트북 3종 비교표 여럿이 나눠서 조사해 줘", model=TERRA)
    assert h.types(events)[-1] == "RUN_FINISHED", [e for e in events if e["type"] == "RUN_ERROR"]
    assert {p for p, _ in gw.sent} == {"/v1/responses"}
    members = [b for b in gw.bodies("/v1/responses") if b["instructions"].startswith(tm.MEMBER_INSTRUCTIONS)]
    assert len(members) == 2
    for b in members:  # 팀원 = 같은 모델 · 추론 끔 · 출력 한도 · user
        assert b["model"] == TERRA and b["max_output_tokens"] == tm.MEMBER_MAX_TOKENS and "reasoning" not in b
        assert b["user"] == api.me["id"]
    done = [e["value"] for e in events if e["type"] == "CUSTOM" and e["name"] == "brewai.team_member" and e["value"]["status"] == "done"]
    assert sorted(v["task"] for v in done) == ["가격 찾기", "사양 찾기"]
    assert all(v["usage"]["input_tokens"] == 120 for v in done)
    u = summary(events)["usage"]
    assert u["requests"] == 4 and u["input_tokens"] == 4 * 120 and u["cache_read_tokens"] == 4 * 80  # 총괄 2 + 팀원 2


# ── 연결 시험 ──


def test_probe_uses_the_same_api_as_chat(make_api, h) -> None:
    gw = Gateway()
    api = make(make_api, h, gw)
    ok = api.client.post(f"/api/admin/models/{TERRA}/test").json()
    assert ok["ok"] is True, ok
    assert gw.sent[-1] == ("/v1/responses", {"model": TERRA, "input": "ping", "max_output_tokens": 16, "drop_params": True})
    ok = api.client.post("/api/admin/models/fake-chat-small/test").json()
    assert ok["ok"] is True and gw.sent[-1][0] == "/v1/chat/completions" and gw.sent[-1][1]["max_tokens"] == 16


def test_probe_reads_a_failure_in_a_200_body(make_api, h) -> None:
    """Responses 는 HTTP 200 + status failed (error) · incomplete (다른 까닭) 로도 실패를 준다 → 연결 시험 실패 · 모델 표 기록."""
    cases = [
        ({"status": "failed", "error": {"code": "server_error", "message": "upstream boom"}}, "provider_unavailable"),
        ({"status": "failed", "error": {"code": "rate_limit_exceeded", "message": "slow down"}}, "provider_rate_limited"),
        ({"status": "incomplete", "incomplete_details": {"reason": "content_filter"}}, "model_error"),
    ]
    for probe, code in cases:
        gw = Gateway(probe=probe)
        api = make(make_api, h, gw)
        res = api.client.post(f"/api/admin/models/{TERRA}/test").json()
        assert res["ok"] is False, (probe, res)
        row = next(r for r in api.client.get("/api/admin/models").json() if r["id"] == TERRA)
        assert row["last_error_code"] == code, (probe, row)


# ── 실행 안 툴 루프: 생각을 '<think>' 글로 다시 안 보냄 ──


def _tool_then_text(path: str, body: dict[str, Any], n: int) -> tuple[str, Any]:
    if any(i.get("type") == "function_call_output" for i in body["input"]):
        return ("text", "14시 30분이에요")
    return ("tools", [("now", {})])


def _now_api(make_api, h, gw: Gateway) -> Any:  # noqa: ANN001, ANN401
    from conductor import tools as tools_mod

    def now() -> dict[str, Any]:
        return {"time": "14:30"}

    spec = tools_mod.ToolSpec(name="now", label="지금", description="현재 시각", function=now)
    return make_api(None, _items(h), bootstrap_models=("fake-chat-small", TERRA, GPT55), openai_client=gw.client(), tools=(spec,))


def test_reasoning_is_not_replayed_as_think_text_inside_the_tool_loop(make_api, h) -> None:
    gw = Gateway(_tool_then_text, thought="plan: call tool")
    api = _now_api(make_api, h, gw)
    events = api.chat("몇 시야?", model=TERRA, reasoning="high")
    assert h.types(events)[-1] == "RUN_FINISHED", [e for e in events if e["type"] == "RUN_ERROR"]
    first, second = gw.bodies("/v1/responses")
    assert first["reasoning"] == {"effort": "high", "summary": "auto"} and second["reasoning"] == first["reasoning"]
    # 두 번째 요청 = 사용자 · 툴 호출 · 툴 결과 (생각 = '<think>…</think>' assistant 글로 안 들어간다 · rs_ id 없음)
    assert _think_items(second) == [] and "<think>" not in json.dumps(second, ensure_ascii=False) and _ids(second) == []
    assert [i.get("type") or i.get("role") for i in second["input"]][-2:] == ["function_call", "function_call_output"]
    # 화면 · 기록의 생각은 그대로 (보낼 때만 뺀다)
    assert "plan: call tool" in "".join(e["delta"] for e in events if e["type"] == "REASONING_MESSAGE_CONTENT")
    assert "<think>" not in "".join(e["delta"] for e in events if e["type"] == "TEXT_MESSAGE_CONTENT")


def test_alias_name_does_not_change_the_request_shape(make_api, h) -> None:
    """'gpt-5.5' 이름 = Pydantic AI profile 이 encrypted · reasoning context 를 켠다 → conductor 가 끈다 (TERRA 와 같은 모양)."""
    gw = Gateway(_tool_then_text, thought="잠깐 생각")
    api = _now_api(make_api, h, gw)
    events = api.chat("몇 시야?", model=GPT55)  # 생각 끔
    assert h.types(events)[-1] == "RUN_FINISHED", [e for e in events if e["type"] == "RUN_ERROR"]
    for b in gw.bodies("/v1/responses"):  # reasoning {context: 'all_turns'} 없음 · include reasoning.encrypted_content 없음
        assert b["model"] == GPT55 and "reasoning" not in b and "include" not in b
    gw.sent.clear()
    events = api.chat("다시 몇 시야?", thread="thread-2", model=GPT55, reasoning="high")  # 새 대화 (앞 툴 결과 없음)
    assert h.types(events)[-1] == "RUN_FINISHED", [e for e in events if e["type"] == "RUN_ERROR"]
    first, second = gw.bodies("/v1/responses")
    assert first["reasoning"] == {"effort": "high", "summary": "auto"} and "include" not in first  # context 없음
    assert _think_items(second) == [] and _ids(second) == []  # '<think>\n\n</think>' 같은 빈 생각 항목도 없다


def test_responses_reasoning_rejection_is_reasoning_unsupported() -> None:
    """Responses 400 = error.param 이 거절한 칸 (문구에 이름이 없어도) · 200 본문 실패 = classify_response."""
    from conductor import diagnose as dx

    body = {"error": {"message": "This model does not support this option.", "type": "invalid_request_error", "param": "reasoning.summary"}}
    assert dx.classify_http(400, "invalid_request_error", body, reasoning=True).detail == "reasoning_unsupported"
    assert dx.classify_http(400, "invalid_request_error", body).detail == "provider_bad_request"  # 생각 칸을 안 실은 요청 (끔 · 연결 시험)
    other = {"error": {"message": "Invalid 'input[0]'.", "type": "invalid_request_error", "param": "input"}}
    assert dx.classify_http(400, "invalid_request_error", other, reasoning=True).detail == "provider_bad_request"
    assert dx.classify_response("incomplete", None, None, "max_output_tokens") is None  # 짧은 한도 = 성공
    assert dx.classify_response("completed", None, None, None) is None
    failed = dx.classify_response("failed", "invalid_prompt", "bad prompt", None)
    assert failed is not None and (failed.code, failed.detail, failed.status, failed.error_type) == (
        "provider_rejected", "provider_bad_request", 200, "invalid_prompt")
