"""team.py (순수 파이썬 · slice 06) — 게이트 진리표 · sticky · resume · 역할 · 할 일 정리 · 한도 · 팀원 결과 모양."""

from __future__ import annotations

import json

import pytest

from conductor import team as tm
from conductor.tools import step_label, tool_label

# (질문, 팀 게이트) — 규칙: 12자 이상 + (나눠 하기 낱말) 또는 (비교 · 조사 낱말 + 항목 2개 이상)
TRUTH = [
    ("hello", False),
    ("안녕", False),
    ("서울이랑 뉴욕", False),  # 짧다 (12자 아래)
    ("버그 이슈 찾아줘", False),
    ("노트 둘 다 보여줘", False),
    ("오늘 서울 날씨 알려줘 자세하게", False),  # 낱말 없음
    ("노트북 3종 비교표 여럿이 나눠서 조사해 줘", True),  # 데모 질문
    ("이 세 가지 일을 각각 따로 해 줘 부탁해", True),  # 나눠 하기 낱말
    ("팀으로 이 보고서를 검토해 줘요", True),
    ("아이폰과 갤럭시 비교해서 정리해 줘", True),  # 비교 + '과'
    ("아이폰 vs 갤럭시 차이를 비교해 줘", True),
    ("서울, 부산, 대구 인구 조사해서 알려줘", True),  # 조사 + 쉼표
    ("카페 5곳 조사해서 추천해 줘", True),  # N곳 N≥2
    ("카페 1곳 조사해서 추천해 줘요", False),  # N=1
    ("이 문서 내용을 조사해서 요약해 줘", False),  # 조사지만 항목 1개
    ("canvas 와 devs 차이 정리해 줘", False),  # vs 는 낱말 경계로만
    ("비교할 것:\n- 맥북 에어\n- 갤럭시북", True),  # 줄바꿈 목록
    ("https://a.example/x/y 페이지 조사해 줘", False),  # 주소의 / 는 항목 구분이 아니다
]


@pytest.mark.parametrize(("prompt", "want"), TRUTH)
def test_offer_team_truth_table(prompt: str, want: bool) -> None:
    assert tm.offer_team(prompt) is want


def test_rule_tables_are_sorted_constants() -> None:
    assert list(tm.SPLIT_WORDS) == sorted(tm.SPLIT_WORDS) and list(tm.COMPARE_WORDS) == sorted(tm.COMPARE_WORDS)
    assert tm.MIN_PROMPT_CHARS == 12


def test_sticky_resume_and_no_tools() -> None:
    assert tm.offer_team("hello", used=True) is True  # 팀을 쓴 대화 = 이후 턴마다 (도구 배열 고정)
    assert tm.offer_team("노트북 3종 비교표 여럿이 나눠서 조사해 줘", resume=True) is False  # 이어서 하기 = 질문은 안 본다 (used 만)
    assert tm.offer_team("hello", used=True, resume=True) is True  # 이어서 하기 = 멈춘 실행과 같은 도구 배열 (sticky 그대로)
    assert tm.offer_team("hello", used=True, tools=False) is False
    assert tm.offer_team("노트북 3종 비교표 여럿이 나눠서 조사해 줘", tools=False) is False
    assert tm.team_used(["use_skill", "delegate"]) and not tm.team_used(["use_app", "tool:delegate"])


def test_clean_role_and_task() -> None:
    assert tm.clean_role(" 가격·조사 ", 1) == "가격 조사"  # 가운뎃점 → 공백 (화면 문구 규칙)
    assert tm.clean_role("a\x00b\nc​d", 1) == "a b c d"  # 제어 · 서식 문자 → 공백
    assert tm.clean_role("", 2) == "팀원 2" and tm.clean_role(None, 3) == "팀원 3" and tm.clean_role(" \t ", 1) == "팀원 1"
    assert len(tm.clean_role("가" * 50, 1)) == tm.ROLE_MAX
    assert tm.clean_role("가격", 2, ["가격"]) == "가격 2" and tm.clean_role("가격", 3, ["가격", "가격 2"]) == "가격 3"
    long = tm.clean_role("나" * 30, 2, ["나" * 20])
    assert long.endswith(" 2") and len(long) <= tm.ROLE_MAX
    assert tm.clean_task("  첫 줄\n\n둘째\x07 줄  ") == "첫 줄\n둘째 줄"
    assert len(tm.clean_task("일" * 500)) == tm.TASK_MAX and tm.clean_task("일" * 500).endswith("…")


def test_roster_numbers_limits_and_rejects() -> None:
    r = tm.Roster()
    a = r.member("c1", "가격", "찾기")
    assert r.member("c1", "다른 이름") is a and a.agent == "a1"  # 처음 본 쪽이 정한다 (스트림 · call_tool 같은 답)
    b, c, d = r.member("c2", "가격"), r.member("c3", ""), r.member("c4", "넷째")
    assert (b.role, c.role, d.agent) == ("가격 2", "팀원 3", "a4")
    assert [r.admit(x) for x in (a, b, c, d)] == [True, True, True, False]  # 실행당 3명
    assert [m.agent for m in r.ran] == ["a1", "a2", "a3"]
    assert tm.rejected("team_full")["error"] == "team_full" and "2명 이상" in tm.rejected("team_too_small")["message"]
    assert (tm.MAX_MEMBERS, tm.MIN_MEMBERS, tm.MEMBER_REQUEST_LIMIT, tm.MEMBER_TIMEOUT_S) == (3, 2, 4, 90.0)


def test_member_result_is_untrusted_first_and_capped() -> None:
    m = tm.Member(call_id="c1", agent="a1", role="가격 조사", task="찾기", status="done", answer="가" * 3000, needs_app=["tracker"])
    out = m.result()
    assert list(out)[:2] == ["untrusted", "source"] and out["untrusted"] is True and out["source"] == "team:a1"
    assert len(out["answer"].encode()) <= tm.RESULT_BYTES and out["needs_app"] == ["tracker"]
    bad = tm.Member(call_id="c2", agent="a2", role="사양", task="찾기", status="error", code="member_timeout").result()
    assert bad["error"] == "member_timeout" and "answer" not in bad and bad["untrusted"] is True
    assert len(json.dumps(out, ensure_ascii=False).encode()) <= tm.RESULT_BYTES + 200


def test_error_codes_keep_gateway_keys_only() -> None:
    assert tm.error_code("gateway_auth_failed") == "gateway_auth_failed"
    assert tm.error_code("run_limit") == "member_limit"
    assert tm.error_code("model_error") == "member_model_error" and tm.error_code("whatever") == "member_model_error"


def test_labels() -> None:
    assert tool_label("delegate") == "팀원에게 맡기기"
    assert step_label("agent:a2") == "팀원 2" and step_label("agent:a1", {"agent:a1": "가격 조사"}) == "가격 조사"


def test_team_offered_counts_gated_prompts_without_the_now_line() -> None:
    ask = "아이폰과 갤럭시 비교해서 정리해 줘"
    assert tm.complex_signal(ask)
    assert tm.team_offered(["hello", ask]) and tm.team_offered(["지금: 2026-11-03 (화) 10:00 KST\n" + ask])
    assert not tm.team_offered(["hello", "지금: 2026-11-03 (화) 10:00 KST", "고마워"])  # 날짜 줄만으로는 안 켜진다
    assert not tm.team_offered([])
