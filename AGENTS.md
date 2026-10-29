# AGENTS.md — 에이전트 작업 규칙 (Claude Code · Codex 공통)

## 프로젝트
**BrewAI** — 채팅 중에 에이전트가 필요한 Skill·MCP를 스스로 찾고·설치하고·만들어 쓰고, 사람은 인증·승인만 하는 에이전트 플랫폼.
그림으로 된 전체 구조·로드맵 → `REPORT.html` · 결정 기록 → `docs/adr/` · 완료 기준 → `docs/roadmap.json`

## 사용자와 소통
- 한국어. **글은 짧게.** 채팅 답변은 5줄 이내 + 파일 링크.
- 설명이 길어지면 그림(인라인 SVG/HTML)으로 바꾼다. 문단 대신 표·카드.
- 보고 = root의 `REPORT.html` 갱신. 이전 판은 `reports/YYYY-MM-DD-주제.html` 로 보관.
- 사용자 결정이 필요하면 `HANDOFF.md` "결정 대기"에 한 줄 + 채팅에서 질문 1개.

## 두 PC(회사·집) 이어받기
- 공유 기억은 **레포에만** 있다. 개인 PC 메모리에만 있는 사실은 HANDOFF.md 나 ADR로 옮긴다.
- 시작: fetch → 최신 작업 브랜치로 전환 → `git pull --rebase` → `HANDOFF.md` 읽기 → 3줄 상태 보고.
- 종료: `HANDOFF.md` 갱신 → 커밋 → push. 커밋 안 된 변경을 남긴 채 PC를 떠나지 않는다.
- 루틴(/start·/wrap·/slice)과 squash-merge 는 **main 체크아웃**에서. worktree(orca·exp) 브랜치는 push 하지 않는다 → 그 브랜치에 커밋 → main 체크아웃에서 `git merge --squash <브랜치>`(코드면 slice 브랜치로) → /wrap.
- PC 이름표: `DESKTOP-GSJ7AIO` (Windows) = **집** · `baegseunghun-ui-MacBookPro-2.local` (macOS) = **회사**
- Codex: 슬래시 명령이 없다 → `.claude/skills/<이름>/SKILL.md` 를 읽고 그 단계대로 수행한다.

## 제품 경계 (어기면 안 되는 것)
- 표면 3개: 사용자 웹(`apps/web`) · 사용자 데스크톱(`apps/desktop`, Electron) · 관리자 콘솔(`apps/admin`). 사용자 앱에 관리자 기능·경로를 넣지 않는다. **데스크톱 먼저**, 웹은 당분간 랜딩(다운로드)만 (ADR-0007).
- 모델은 LLM 게이트웨이(LiteLLM)에서 가져온다. 모델을 **등록**하는 코드·화면(가격·컨텍스트·provider 입력)은 만들지 않는다. 우리는 노출 여부·표시 이름·순서만.
- UI는 Codex를 **보고 따라 그린다**(클린룸). Codex 앱 바이너리 추출·디컴파일, 아이콘·문구·CSS 재사용 금지 (ADR-0005).
- 데스크톱 앱에 게이트웨이·Langfuse 키를 넣지 않는다. 데스크톱은 우리 API만 호출.
- trace = Langfuse (로컬 Docker 셀프호스트, ADR-0009). 모든 span에 `user.id`·`session.id`.

## 개발 원칙
- 직접 만드는 건 **conductor 코어 4개**뿐: ① 능력 찾기·설치 ② 승인·정책 ③ Skill 작성·저장소(격리 → 테스트 → 승인) ④ 팀 구성(서브에이전트 자동 편성 + 활동 이벤트).
  실행 루프는 Pydantic AI를 빌려 adapter 1파일에 격리. 게이트웨이·관측·레지스트리·UI 규격·UI 부품은 기성품·표준.
- E2E = Playwright(`e2e/`, TypeScript). projects `web` · `admin` · `desktop`. **기능 개발이 끝난 시점에** 돌린다 = 금요일 데모 스크립트(Playwright 스펙). E2E에서 게이트웨이는 mock.
- 슬라이스는 끝까지 관통하는 얇은 수직 조각: 채팅 → conductor → gateway → tool → trace.
- 모든 LLM·툴·에이전트 호출은 OpenTelemetry GenAI span을 남긴다 (semconv 버전 고정).
- eval: P1은 골든 1 + 제약 2(무승인 실행·비밀 노출). P3까지 제약 5개로. 이후는 금요일 trace에서 찾은 실패만 추가.
  기존 케이스가 깨지면 merge 하지 않는다.
- 되돌리기 어려운 결정은 `docs/adr/NNNN-제목.md` 에 20줄 이내로 남긴다.
- 새 문서를 만들지 않는다. 상태 = HANDOFF·roadmap·REPORT, 결정 = ADR, 아이디어 = `docs/ideas.md` 한 줄.

## 사이클 (1주)
- 월 `/slice` → `docs/slices/NN-이름.md` 1쪽 + `slice/NN-이름` 브랜치
- 화~목 구현. 한 세션 = 기능 하나. 목요일 밤까지 데모가 안 되면 기간 대신 범위를 자른다.
- 금 데모 → trace 20~50개 훑어 실패만 `evals/cases/` 에 추가 → eval CI green 확인 → squash-merge → `docs/roadmap.json` passes 갱신 → `/report`
- 4주마다 반나절 cool-down: 규칙 파일 다이어트 · 의존성 업그레이드(게시 7일 지난 버전만) · `docs/ideas.md` 정리

## Git
- main = 항상 데모 가능. main 직접 커밋은 docs·chore만.
- `slice/NN-이름` 한 번에 하나, WIP push 허용, 금요일 squash-merge
  (gh 없으면 로컬: `git switch main && git merge --squash slice/NN-이름 && git commit`). 실험은 `exp/<이름>` + worktree.
- 커밋: `<type>(<scope>): <요약>` — type: feat · fix · refactor · test · eval · docs · chore · wip(slice 브랜치에서만)
- 비밀값은 `.env` (커밋 금지). 필요한 키 목록은 `.env.example` 에.

## 폴더
- `.claude/skills/` = 개발 루틴(/start /wrap /slice /report) · `runtime/skills/` = 제품이 쓰고 만드는 Skill (섞지 않는다)
- `services/conductor` (유일한 자체 코어) · `apps/{web,admin,desktop}` · `e2e/` · `infra/` (게이트웨이·OTel 설정) · `evals/` · `docs/{adr,slices}` · `reports/`

## 공급망
- 의존성은 `uv.lock` + 정확한 버전 고정 + 해시. LiteLLM 1.82.7 · 1.82.8 · 1.107.0 은 악성 배포 이력 → 금지.
- GitHub Actions 는 전체 커밋 SHA 로 고정. npm 은 `package-lock.json` + `npm ci` + 정확한 버전. 도구(uv·Node)·의존성·액션 모두 게시 7일 지난 버전만 (보안 패치는 ADR-0002 대로 즉시, 사람 승인).
- 에이전트가 설치하는 MCP 서버·Skill 은 버전·해시 고정 + 허용 목록 + 사람 승인.
