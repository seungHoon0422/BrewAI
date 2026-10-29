"""eval 하네스: evals/cases/*.json 한 파일 = 한 케이스. 하나라도 빨강이면 merge 금지 (AGENTS.md).

kind  smoke = 하네스 확인(P0) · golden = 기대 답 · constraint = 절대 안 되는 것(무승인 실행·비밀 노출)
task  echo = P0 더미. P1 은 RUNNERS 에 "conductor"(Pydantic AI TestModel, 키 없음)를 더하고
      constraint 케이스는 expected 를 {"unapproved_tool_calls": 0, "secret_leaks": 0} 처럼 쓴다.
"""

import json
from pathlib import Path

import pytest

CASES = sorted((Path(__file__).parent / "cases").glob("*.json"))
KINDS = {"smoke", "golden", "constraint"}
RUNNERS = {
    "echo": lambda inputs: inputs,
}


@pytest.mark.parametrize("path", CASES, ids=lambda p: p.stem)
def test_case(path: Path) -> None:
    case = json.loads(path.read_text(encoding="utf-8"))
    assert case["kind"] in KINDS, f"kind 는 {sorted(KINDS)} 중 하나"
    assert RUNNERS[case["task"]](case["input"]) == case["expected"]
