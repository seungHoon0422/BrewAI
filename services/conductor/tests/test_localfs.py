"""로컬 폴더 (slice 09 · ADR-0016): 고르는 규칙 · 폴더 밖 · 링크 · 비밀 파일 · 무거운 폴더 · .gitignore · 상한 · API 권한 · 이 PC 만 · 대화 도구."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pytest

from conductor import localfs as lfs
from conductor.localfs import Folder, FolderError, check_root

from conductor.skills import load_skills

from .test_files import clock, items
from .test_tokens import Wire

__all__ = ["clock"]
SECRET = "sk-live-DO-NOT-LEAK-1234"


@pytest.fixture
def home(tmp_path: Path) -> Path:
    h = tmp_path / "home"
    proj = h / "code" / "shop"
    (proj / "src").mkdir(parents=True)
    (proj / "src" / "app.py").write_text("def main():\n    # TODO 결제 붙이기\n    return 1\n", encoding="utf-8")
    (proj / "README.md").write_text("# shop\n쇼핑몰 예제\n", encoding="utf-8")
    (proj / ".env").write_text(f"API_KEY={SECRET}\n", encoding="utf-8")
    (proj / ".env.example").write_text("API_KEY=\n", encoding="utf-8")
    (proj / "deploy.pem").write_text(f"-----BEGIN {SECRET}\n", encoding="utf-8")
    (proj / ".git").mkdir()
    (proj / ".git" / "config").write_text(f"url = https://x:{SECRET}@github.com\n", encoding="utf-8")
    (proj / "node_modules" / "pkg").mkdir(parents=True)
    (proj / "node_modules" / "pkg" / "index.js").write_text("// TODO 남의 코드\n", encoding="utf-8")
    (proj / "logs").mkdir()
    (proj / "logs" / "run.log").write_text("TODO 로그\n", encoding="utf-8")
    (proj / ".gitignore").write_text("logs/\n*.tmp\n", encoding="utf-8")
    (proj / "blob.bin").write_bytes(b"\x00\x01\x02TODO")
    (h / "notes.txt").write_text(f"{SECRET}\n", encoding="utf-8")
    (h / ".ssh").mkdir()
    (h / "Library").mkdir()
    return h


def folder(home: Path) -> Folder:
    return Folder(check_root(str(home / "code" / "shop"), home))


def test_check_root_rules(home: Path, tmp_path: Path) -> None:
    assert check_root(str(home / "code" / "shop"), home) == (home / "code" / "shop").resolve()
    cases = {
        "code/shop": "not_absolute", str(home / "nope"): "not_found", str(home / "notes.txt"): "not_dir",
        str(home): "too_broad", str(tmp_path): "outside_home", str(home / ".ssh"): "hidden", str(home / "Library"): "system",
        "/": "too_broad",
    }
    for raw, code in cases.items():
        with pytest.raises(FolderError) as e:
            check_root(raw, home)
        assert e.value.code == code, raw


def test_list_hides_secrets_and_marks_heavy(home: Path) -> None:
    got = folder(home).list(".", 2)
    paths = {e["path"]: e for e in got["entries"]}
    assert got["untrusted"] is True and got["source"] == "folder" and got["folder"] == "shop"
    assert {"src", "src/app.py", "README.md", ".env.example", ".gitignore", "blob.bin"} <= set(paths)
    assert not {".env", "deploy.pem", ".git", ".git/config", "logs", "logs/run.log"} & set(paths)
    assert paths["node_modules"]["skipped"] is True and "node_modules/pkg" not in paths
    assert paths["src/app.py"]["size"] > 0 and paths["src"]["type"] == "dir"


def test_read_lines_and_refusals(home: Path) -> None:
    f = folder(home)
    got = f.read("src/app.py")
    assert got["text"].splitlines()[1] == "2:     # TODO 결제 붙이기" and got["total_lines"] == 3 and "truncated" not in got
    part = f.read("src/app.py", start=2, lines=1)
    assert part["text"] == "2:     # TODO 결제 붙이기" and part["truncated"] is True and "start=3" in part["note"]
    for path, code in {".env": "blocked", "deploy.pem": "blocked", ".git/config": "blocked", "../../notes.txt": "outside_folder",
                       str(home / "notes.txt"): "outside_folder", "src": "is_dir", "blob.bin": "binary", "nope.py": "not_found"}.items():
        res = f.read(path)
        assert res["error"] == code, path
        assert SECRET not in json.dumps(res, ensure_ascii=False)
    assert f.read(str(home / "code" / "shop" / "README.md"))["path"] == "README.md"  # 폴더 안 절대 경로는 된다
    assert "API_KEY=" in f.read(".env.example")["text"]


def test_symlinks_cannot_escape(home: Path) -> None:
    proj = home / "code" / "shop"
    try:
        os.symlink(home / "notes.txt", proj / "out.txt")
        os.symlink(home, proj / "homelink", target_is_directory=True)
        os.symlink(proj / ".env", proj / "env-link")
    except OSError:
        pytest.skip("이 PC 는 링크를 만들 권한이 없다 (윈도우 개발자 모드 꺼짐)")
    f = folder(home)
    assert f.read("out.txt")["error"] == "outside_folder"
    assert f.read("homelink/notes.txt")["error"] == "outside_folder"
    assert f.read("env-link")["error"] == "blocked"
    assert f.list("homelink")["error"] == "outside_folder"
    hits = f.search("sk-live")
    assert hits["matches"] == [] and SECRET not in json.dumps(f.list(".", 3), ensure_ascii=False)


def test_search_content_and_names(home: Path) -> None:
    f = folder(home)
    got = f.search("todo")
    assert [(m["path"], m["line"]) for m in got["matches"]] == [("src/app.py", 2)]  # node_modules · .gitignore(logs) · 바이너리 건너뜀
    assert f.search(glob="*.py")["files"] == ["src/app.py"]
    assert f.search("def \\w+", regex=True)["matches"][0]["text"] == "def main():"
    assert f.search("(", regex=True)["error"] == "bad_regex"
    assert f.search()["error"] == "empty_query"
    assert SECRET not in json.dumps(f.search("API_KEY"), ensure_ascii=False)


def test_read_caps(home: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    proj = home / "code" / "shop"
    (proj / "big.txt").write_text("\n".join(f"줄 {i}" for i in range(1, 1001)), encoding="utf-8")
    got = folder(home).read("big.txt")
    assert got["end"] == lfs.READ_LINES and got["total_lines"] == 1000 and got["truncated"] is True
    monkeypatch.setattr(lfs, "READ_BYTES", 10)
    assert folder(home).read("big.txt")["error"] == "too_big"


# ── API · 대화 ──
def project(api: Any, c: Any) -> tuple[str, str]:
    space = c.get("/api/spaces").json()["spaces"][0]["id"]
    return str(c.post(f"/api/spaces/{space}/projects", json={"name": "쇼핑몰"}).json()["id"]), space


def test_folder_api_rules(make_api, h, home: Path) -> None:
    api = make_api(None, local_home=str(home))
    me = api.login(h.ADMIN_EMAIL, h.ADMIN_PASSWORD)  # 이 PC (loopback) 에서 온 요청
    pid, _ = project(api, me)
    assert me.get(f"/api/projects/{pid}/folder").json() == {"enabled": True, "folder": None}
    labels = {t["name"]: t["label"] for t in me.get("/api/tools").json()}
    assert labels["folder_search"] == "폴더 검색" and "folder_search" not in {t["name"] for t in api.client.get("/api/tools").json()}
    res = me.put(f"/api/projects/{pid}/folder", json={"path": str(home / "code" / "shop")})
    assert res.status_code == 200, res.text
    assert res.json()["folder"] == {"name": "shop", "path": str((home / "code" / "shop").resolve()), "ok": True}
    assert me.put(f"/api/projects/{pid}/folder", json={"path": str(home)}).json() == {"detail": "too_broad"}
    assert me.put(f"/api/projects/{pid}/folder", json={"path": "/etc"}).json() == {"detail": "outside_home"}
    # 남: 같은 프로젝트를 못 보면 404 · 내 폴더 경로는 남에게 안 보인다
    api.add_user("bob@brewai.test")
    bob = api.login("bob@brewai.test")
    assert bob.get(f"/api/projects/{pid}/folder").status_code == 404
    # 이 PC 밖에서 온 요청 = 꺼짐 (testclient 주소)
    assert api.client.get(f"/api/projects/{pid}/folder").json()["enabled"] is False
    assert api.client.put(f"/api/projects/{pid}/folder", json={"path": str(home / "code" / "shop")}).json() == {"detail": "local_folders_off"}
    assert me.delete(f"/api/projects/{pid}/folder").status_code == 204
    assert me.get(f"/api/projects/{pid}/folder").json()["folder"] is None


def test_folder_off_when_conductor_not_local(make_api, h, home: Path) -> None:
    api = make_api(None, local_home=str(home), public_url="https://brewai.example.com")
    me = api.login(h.ADMIN_EMAIL, h.ADMIN_PASSWORD)
    pid, _ = project(api, me)
    assert me.put(f"/api/projects/{pid}/folder", json={"path": str(home / "code" / "shop")}).json() == {"detail": "local_folders_off"}


def test_chat_gets_folder_tools_only_in_linked_project(make_api, h, clock, home: Path) -> None:
    def plan(body: dict[str, Any], n: int) -> tuple[str, Any]:
        names = [t["function"]["name"] for t in body.get("tools", [])]
        if "folder_search" not in names:
            return "text", "폴더 없음"
        done = sum(m["role"] == "tool" for m in body["messages"])
        return [("tools", [("folder_search", {"query": "TODO"})]), ("tools", [("folder_read", {"path": ".env"})])][done] if done < 2 else ("text", "결제가 남았어요")

    wire = Wire(plan)
    api = make_api(None, items(h), openai_client=wire.client(), skills=load_skills(h.SKILLS_DIR),
                   bootstrap_models=("fake-chat-small", "fake-pdf", "fake-plain"), local_home=str(home))
    me = api.login(h.ADMIN_EMAIL, h.ADMIN_PASSWORD)
    pid, space = project(api, me)
    assert me.put(f"/api/projects/{pid}/folder", json={"path": str(home / "code" / "shop")}).status_code == 200
    # 프로젝트 밖 대화 = 도구 · 지침 0
    res = me.post("/api/chat", json=h.chat_body("hello", thread="t-plain", run="r1"))
    assert res.status_code == 200
    first = wire.sent[-1]
    assert not any(t["function"]["name"].startswith("folder_") for t in first["tools"])
    assert all("로컬 폴더" not in m["content"] for m in first["messages"] if m["role"] == "system")
    # 프로젝트 대화 = 도구 3개 + 지침 한 줄 · .env 는 막힌다
    wire.sent.clear()
    res = me.post("/api/chat", json=h.chat_body("할 일 찾아줘", thread="t-proj", run="r2", projectId=pid, spaceId=space))
    assert res.status_code == 200, res.text
    body = wire.sent[0]
    names = [t["function"]["name"] for t in body["tools"]]
    assert {"folder_list", "folder_read", "folder_search"} <= set(names)
    system = "\n".join(m["content"] for m in body["messages"] if m["role"] == "system")
    assert "로컬 폴더 'shop'" in system and str(home) not in system  # 경로는 모델에 안 보낸다 (이름만)
    events = h.sse_events(res.text)
    results = [json.loads(e["content"]) for e in events if e["type"] == "TOOL_CALL_RESULT"]
    assert results[0]["matches"][0]["path"] == "src/app.py" and results[0]["untrusted"] is True
    assert results[1]["error"] == "blocked"
    assert SECRET not in res.text and all(SECRET not in json.dumps(b, ensure_ascii=False) for b in wire.sent)
    steps = [e["stepName"] for e in events if e["type"] == "STEP_STARTED"]
    assert "tool:folder_search" in steps and "tool:folder_read" in steps


def test_team_members_get_folder_read_tools(make_api, fake_mcp, h, home: Path) -> None:
    from .test_team_chat import ASK, Team, two_then_text, world

    def member(task: str, messages: Any, info: Any, n: int) -> Any:
        if not any(getattr(p, "part_kind", "") == "tool-return" for m in messages for p in getattr(m, "parts", [])):
            return [("folder_search", {"query": "TODO"})]
        return f"{task}: src/app.py"

    team = Team(two_then_text, member)
    api, _ = world(make_api, fake_mcp, team, local_home=str(home))
    me = api.login(h.ADMIN_EMAIL, h.ADMIN_PASSWORD)
    pid, space = project(api, me)
    assert me.put(f"/api/projects/{pid}/folder", json={"path": str(home / "code" / "shop")}).status_code == 200
    res = me.post("/api/chat", json=h.chat_body(ASK, thread="t-team", run="r1", projectId=pid, spaceId=space))
    assert res.status_code == 200, res.text
    members = team.of("member")
    assert members and all({"folder_list", "folder_read", "folder_search"} <= set(r["tools"]) for r in members)
    assert all("로컬 폴더 'shop'" in r["instructions"] for r in members)
    assert SECRET not in res.text
    rows = [e["value"] for e in h.sse_events(res.text) if e["type"] == "CUSTOM" and e["name"] == "brewai.agent_step"]
    assert any(r.get("name") == "tool:folder_search" or r.get("step") == "tool:folder_search" for r in rows), rows[:2]
