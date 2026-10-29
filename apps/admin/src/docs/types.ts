// 문서 메뉴 데이터 모양. docs-plugin.ts(Node)가 레포 파일에서 만들고 화면(React)이 읽는다.
// 두 쪽이 같이 import 하므로 React · DOM · Node API 를 쓰지 않는다 (값은 ARCH_PATHS 하나뿐).

/** Node 에서 markdown-it(html:false)로 만든 HTML. 원문에 섞인 HTML 은 이스케이프돼 있다 */
export type Html = string;

/** 아키텍처 그림의 칸 → 이 경로가 레포에 있으면 '있음' (빌드할 때 계산) */
export const ARCH_PATHS = [
  'apps/desktop/package.json',
  'apps/admin/package.json',
  'apps/web/index.html',
  'services/conductor',
  'infra/litellm',
  'runtime/skills',
  'evals/cases',
] as const;
export type ArchPath = (typeof ARCH_PATHS)[number];

export type KeyValue = { key: string; value: Html };

/** HANDOFF.md */
export type Handoff = {
  updated: Html | null; // 마지막 갱신
  branch: Html | null; // 활성 브랜치
  phase: Html[]; // Phase (' · ' 로 나눈 것)
  next: Html[]; // 다음 할 일 ('1) … · 2) …' 를 나눈 것)
  blocked: Html[]; // 막힘 ([] = 없음)
  pending: Html[]; // 결정 대기 ([] = 없음)
  settled: Html[]; // 확정
  memo: Html[]; // 📥 사용자 메모
  log: { date: string | null; html: Html }[]; // 🕘 최근 기록
  rows: KeyValue[]; // 표에서 위에 없는 칸
};

export type PhaseState = 'done' | 'now' | 'next'; // 완료(passes) · 진행 중(HANDOFF Phase 에 있음) · 예정

/** docs/roadmap.json 의 phase 하나 */
export type Phase = {
  id: string;
  name: string;
  weeks: number | null;
  goal: string;
  criteria: { id: string; text: string }[]; // exit_criteria ('P1-2 …' → id · text)
  hints: string[]; // slice_hint
  passes: boolean;
  state: PhaseState;
};

export type Roadmap = { updated: string | null; rule: string | null; phases: Phase[] };

/** docs/slices/ 에서 번호가 가장 큰 것 */
export type Slice = {
  file: string; // docs/slices/01-menu-shell.md
  num: string; // 01
  branch: string; // slice/01-menu-shell
  title: string; // h1 에서 'slice 01 · ' 을 뗀 것
  goal: Html | null;
  meta: KeyValue[]; // 첫 h2 앞의 '- 이름: 값' 줄 (목표 말고)
  criteria: string[]; // 연결된 완료 기준 id (P1-5 …)
  done: { done: boolean; html: Html }[]; // ## done 체크리스트
  html: Html; // h1 을 뺀 전체 (제목 단계는 두 칸 내림)
};

/** docs/adr/*.md */
export type Adr = {
  key: string; // 0007 (번호 없는 파일은 파일 이름) → #/docs/adr/<key>
  file: string;
  title: string;
  status: string | null; // '- 상태:' 줄의 첫 말 (확정 · 제안 …)
  date: string | null;
  note: Html | null; // 상태 줄의 나머지
  html: Html; // h1 · 상태 줄을 뺀 본문 (제목 단계는 한 칸 내림)
};

/** .github/workflows/*.yml */
export type Workflow = {
  file: string;
  name: string;
  on: string[];
  runsOn: string | null;
  steps: { name: string | null; run: string | null; uses: string | null; pin: string | null; sha: boolean }[];
};

/** 표 한 줄: 이름 · 값 · 어느 파일에서 */
export type Row = { name: string; value: string; from: string };

export type Stack = {
  scripts: { name: string; cmd: string }[]; // 루트 package.json scripts
  runtimes: Row[]; // Node · Python · uv …
  npm: { name: string; version: string; dev: boolean; workspaces: string[] }[]; // 워크스페이스 package.json
  python: { name: string; version: string; direct: boolean }[]; // uv.lock
  services: { path: string; label: string; exists: boolean; plan: string | null; deps: { name: string; version: string }[] }[];
  folders: { path: string; role: string | null; exists: boolean }[]; // AGENTS.md 폴더
  ci: Workflow[];
  supply: Row[]; // 공급망 규칙의 실제 값
  banned: string[]; // 금지 LiteLLM 버전 (AGENTS.md)
};

export type DocsData = {
  errors: string[]; // 없거나 해석하지 못한 파일
  handoff: Handoff | null;
  roadmap: Roadmap | null;
  slice: Slice | null;
  adrs: Adr[];
  exists: Record<ArchPath, boolean>;
  stack: Stack;
  report: { title: string | null; bytes: number } | null; // 본문은 virtual:brewai-docs/report (보고서 탭에서만)
};
