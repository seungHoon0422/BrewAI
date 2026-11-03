// 대화 화면 문구 한곳 (한국어). 서버 글은 그대로 띄우지 않고 code → 문구.
// 사용자 앱이라 '관리자' 같은 말은 쓰지 않는다 (e2e desktop.spec). 고치는 곳(LiteLLM 관리 화면 · .env)은 P1 이라 같이 보여 준다.
import type { Failure } from '../../lib/api';
import { count } from '../../lib/format';

export const UNTITLED = '제목 없는 대화';
export const CONV_FALLBACK = '대화';

export const FAILURE_TEXT: Record<Failure, string> = {
  offline: '서버에 연결할 수 없어요',
  gateway: '모델에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요',
  config: '이 모델을 지금 쓸 수 없어요. 관리자에게 알려 주세요',
  no_models: '쓸 수 있는 모델이 없어요. 관리자에게 알려 주세요',
  model_gone: '고른 모델을 더 이상 쓸 수 없어요. 다른 모델을 골라 다시 시도해 주세요',
  busy: '이 대화에서 아직 답을 쓰는 중이에요. 끝난 뒤 다시 보내 주세요',
  too_long: '질문이 너무 길어요. 나눠서 보내 주세요',
  run_limit: '단계가 너무 많아 멈췄어요. 질문을 나눠서 다시 시도해 주세요',
  not_found: '대화를 찾지 못했어요',
  auth: '다시 로그인해 주세요',
  forbidden: '이 대화에 이어 쓸 권한이 없어요',
  conflict: '보관됐거나 옮겨진 곳이라 지금은 보낼 수 없어요',
  cut: '답이 중간에 끊겼어요',
  server: '답을 받지 못했어요',
};

// 왜 안 됐는지 (RUN_ERROR.detail) → 한 줄 + 고치는 곳. 모르는 detail 이면 FAILURE_TEXT 그대로.
// reasoningOff = 생각을 끄고 다시 하면 될 수 있다 (버튼 '생각 끄고 다시')
export const DETAIL: Record<string, { text: string; hint: string; reasoningOff?: boolean }> = {
  provider_key_missing: {
    text: '이 모델의 API 키가 설정돼 있지 않아요',
    hint: 'LiteLLM 관리 화면 › Models › 이 모델의 Credential 키 확인 (config.yaml 모델이면 .env 의 ANTHROPIC_API_KEY 또는 OPENAI_API_KEY)',
  },
  provider_key_invalid: {
    text: '이 모델의 API 키가 틀렸거나 권한이 없어요',
    hint: 'LiteLLM 관리 화면 › Models › 이 모델의 Credential 키 확인',
  },
  provider_model_not_found: {
    text: '모델 이름이 provider 에 없어요',
    hint: 'LiteLLM 관리 화면 › Models › 이 모델의 LiteLLM 모델 이름 확인 (예: anthropic/claude-sonnet-5-5)',
  },
  reasoning_unsupported: {
    text: '이 모델이 생각 깊이 설정을 받지 않아요',
    hint: '생각 깊이를 끄기로 바꾸고 다시 시도해 주세요',
    reasoningOff: true,
  },
  provider_bad_request: {
    text: '모델이 요청을 거절했어요',
    hint: '생각 깊이를 끄고 다시 해 보고, 계속되면 다른 모델로',
    reasoningOff: true,
  },
  gateway_key_invalid: {
    text: '게이트웨이 키가 맞지 않아요',
    hint: '.env 의 LLM_GATEWAY_KEY (또는 LITELLM_MASTER_KEY) 와 LiteLLM 키가 같은지 확인',
  },
  gateway_model_denied: {
    text: '지금 키로는 이 모델을 쓸 수 없어요',
    hint: 'LiteLLM 관리 화면 › Virtual Keys › 이 키의 허용 모델 확인',
  },
  gateway_model_missing: {
    text: '게이트웨이에 이 모델이 없어요',
    hint: 'LiteLLM 관리 화면 › Models 에 모델이 있는지 확인하고, 지웠다면 다른 모델을 골라 주세요',
  },
  gateway_budget_exceeded: {
    text: '게이트웨이 사용 한도(예산)를 넘었어요',
    hint: 'LiteLLM 관리 화면 › Virtual Keys 또는 Teams 의 Max Budget 확인',
  },
  provider_rate_limited: { text: '요청이 많아 모델이 잠시 막혔어요', hint: '잠시 뒤 다시 시도해 주세요' },
  // 앱 연결 뒤 이어서 하기 (POST /api/chat forwardedProps.resume 의 409)
  app_not_connected: { text: '앱이 아직 연결되지 않았어요', hint: '연결된 앱에서 연결을 마친 뒤 다시 시도해 주세요' },
  nothing_to_resume: { text: '이어서 할 작업이 없어요', hint: '이미 이어서 했거나 새 질문으로 넘어갔어요. 다시 질문해 주세요' },
  provider_unavailable: { text: '모델 쪽 서버가 지금 응답하지 않아요', hint: '잠시 뒤 다시 시도해 주세요' },
};

// 서버가 준 detail 은 DETAIL 에 있는 키만 쓴다 ('constructor' 같은 Object 기본 속성에 걸리지 않게)
export const detailText = (detail: string | null | undefined) =>
  detail && Object.prototype.hasOwnProperty.call(DETAIL, detail) ? DETAIL[detail] : undefined;

// ── 단계 이름 · 지금 하는 일 (상태 줄 · 진행 상황 화면) ──
// 문구는 시간으로만 고른다 (결정적 · 테스트가 본다). 무작위로 돌리지 않는다.

// 단계 이름 → 화면 이름. 툴 이름은 /api/tools 의 label (스킬 사용) · 스킬은 /api/skills 의 label (스킬: 요약)
// 앱 = app:<handle> → '앱: <이름>' (연결된 앱 목록의 이름 · 모르면 handle) · MCP 도구 이름표는 brewai.app_tool 이 바꾼다
export const appStepLabel = (name: string) => `앱: ${name}`;
export function stepLabel(name: string, tools: Record<string, string>, skills: Record<string, string> = {}, apps: Record<string, string> = {}): string {
  if (name === 'thinking') return '생각';
  if (name === 'writing') return '답 쓰기';
  if (name.startsWith('agent:')) return TEAM.memberN(name.slice(6)); // 팀원 단계 = 역할 이름 (brewai.team_member 가 바꾼다)
  if (name.startsWith('app:')) {
    const app = name.slice(4);
    return app === 'unknown' ? '앱' : appStepLabel(apps[app] ?? app);
  }
  if (name.startsWith('tool:')) {
    const tool = name.slice(5);
    return tools[tool] ?? tool;
  }
  if (name.startsWith('skill:')) {
    const skill = name.slice(6);
    return `스킬: ${skills[skill] ?? skill}`;
  }
  return name;
}

export const WAITING_PHRASE = '질문을 살펴보는 중';
export const READING_RESULT = '결과를 살펴보는 중';
export function thinkingPhrase(ms: number): string {
  if (ms < 4000) return '질문을 살펴보는 중';
  if (ms < 10_000) return '생각을 정리하는 중';
  return '깊이 따져 보는 중';
}
const skillPhrase = (label: string) => `'${label}' 스킬을 펼치는 중`;
// 도구 여럿이 동시에 도는 중 (병렬 툴 · 한 응답에서 같이 불렸다)
export const parallelPhrase = (n: number) => `도구 ${n}개를 동시에 쓰는 중`;

// 단계 이름 → 지금 하는 일 한 줄. inStepMs = 그 단계가 시작된 뒤 지난 시간 (생각 문구를 고른다)
export function stepPhrase(name: string | null, inStepMs: number, tools: Record<string, string>, skills: Record<string, string> = {}): string {
  if (name === 'thinking') return thinkingPhrase(inStepMs);
  if (name === 'writing') return '답을 다듬는 중';
  if (name?.startsWith('skill:')) {
    const skill = name.slice(6);
    return skillPhrase(skills[skill] ?? skill);
  }
  if (name?.startsWith('app:')) return '쓸 앱 도구를 고르는 중';
  if (name?.startsWith('agent:')) return TEAM.forming;
  if (name?.startsWith('tool:')) {
    const tool = name.slice(5);
    return `${tools[tool] ?? tool} 쓰는 중`;
  }
  return WAITING_PHRASE;
}

// 끝난 줄 요약 조각 (trace.ts 가 모은다 · 화면은 조각마다 칸을 나눈다)
export const TRACE = {
  thought: (t: string) => (t ? `${t} 동안 생각함` : '생각함'),
  noThink: '생각 없이 바로 답함',
  stopped: '중간에 멈춤',
  toolsMany: (n: number) => `도구 ${n}회`,
  toolCount: (label: string, n: number) => `${label} ${n}회`,
  appLinked: (name: string | null) => (name ? `${name} 연결` : '앱 연결'), // 앱 도구만 고르고 끝난 답 (연결 기다림 등)
  appMissed: (name: string | null) => (name ? `${name} 연결 못 함` : '앱 연결 못 함'), // 앱 고르기가 실패 · 취소로 끝난 답
  // 줄 · 패널
  openTitle: '생각과 도구 사용 과정 보기',
  closeTitle: '과정 접기',
  region: '생각과 도구 사용 과정',
  think: '생각',
  thinkBody: '생각 내용',
  thinkSilent: '모델이 생각 내용을 보내지 않았어요',
  noneLive: '아직 생각이나 도구 사용이 없어요',
  noneDone: '생각이나 도구 사용이 없었어요',
  tool: '도구',
  // 패널 아래 사용량 = 칸 나눔 (가운뎃점 없이 · 화면이 칸마다 span 으로 띄운다)
  usage: (u: { requests: number; input_tokens: number | null; output_tokens: number | null; reasoning_tokens: number | null }): string[] =>
    [
      `요청 ${count(u.requests)}회`,
      u.input_tokens != null || u.output_tokens != null
        ? `토큰 입력 ${u.input_tokens == null ? '—' : count(u.input_tokens)} / 출력 ${u.output_tokens == null ? '—' : count(u.output_tokens)}` : '',
      u.reasoning_tokens ? `생각 토큰 ${count(u.reasoning_tokens)}` : '',
    ].filter(Boolean),
} as const;

// 요약 조각을 한 줄 글로 (버튼 이름 · 화면 읽기 · 진행 상황). 화면은 조각마다 칸을 나눠 그린다
export const joinParts = (parts: readonly string[]) => parts.filter(Boolean).join(', ');

// 답 글 (마크다운)
export const MD = {
  code: '코드',
  copyCode: '코드 복사',
  copied: '복사했어요',
} as const;

// 도구 카드 (패널 안)
export const TOOL = {
  skillGroup: '스킬 사용',
  group: (label: string) => `${label} 도구`,
  state: { running: '실행 중', done: '완료', error: '실패', cancelled: '멈춤', waiting: '연결 기다림' },
  useApp: '앱 고르기',
  appGroup: (label: string) => `${label} 앱 도구`,
  write: '쓰기',
  writeTitle: '앱의 데이터를 바꾸는 도구예요',
  waitingAuth: '앱 연결을 기다려요',
  rows: { skill: '스킬', input: '입력', error: '오류', result: '결과', state: '상태' },
  skillLoaded: (lines: number | null) => `지침 불러옴${lines != null ? ` (${count(lines)}줄)` : ''}`,
  found: (n: number) => `${count(n)}개`,
  none: '결과 없음',
  more: (n: number) => `외 ${count(n)}개`,
  links: '결과 목록',
  raw: '원문',
  rawShow: '원문 보기',
  rawHide: '원문 접기',
  // 앱 도구 고르기 = 카드 대신 한 줄 메모 (TraceView AppNote)
  appNote: (app: string, n: number) => (n ? `${app} 연결, 도구 ${n}개` : `${app}에서 맞는 도구를 찾지 못했어요`),
  appPicking: (app: string) => `${app} 도구를 고르는 중`,
  appPickingAny: '쓸 앱 도구를 고르는 중',
  appWaiting: (app: string) => `${app} 연결을 기다려요`,
  appStopped: '앱 도구 고르기를 멈췄어요',
  appFailed: (why: string) => `앱 도구를 고르지 못했어요${why ? `: ${why}` : ''}`,
  // 도구 오류 = 사람이 읽는 문구 (서버 message 는 모델에게 주는 지시라 화면에 안 쓴다 · tool_error 만 앱이 준 글 그대로)
  errors: {
    app_not_found: '맞는 앱이 없어요',
    needs_import: '공유된 앱이에요. 설정 › 연결된 앱에서 가져와 주세요',
    app_unavailable: '지금 쓸 수 없는 앱이에요',
    unknown_tool: '이 대화에서 꺼내지 않은 도구예요',
    tool_hidden: '관리자가 숨긴 도구예요',
    auth_failed: '앱 로그인 정보를 읽지 못했어요. 설정 › 연결된 앱에서 다시 연결해 주세요',
    not_connected: '앱이 연결되지 않았어요. 설정 › 연결된 앱에서 연결해 주세요',
    app_unreachable: '앱 서버에 닿지 못했어요',
    app_timeout: '앱 서버가 너무 늦게 답했어요',
    app_blocked: '허용되지 않는 앱 주소예요',
    app_forbidden: '앱 서버가 권한이 없다고 거절했어요',
    app_server_error: '앱 서버에 오류가 났어요',
    app_protocol: '앱 서버의 답을 읽지 못했어요',
    unknown_skill: '없는 스킬이에요',
    cancelled: '이어서 하지 않았어요',
    retry: '도구 입력이 맞지 않아 다시 시도했어요',
  } as Record<string, string>,
  failed: '도구가 실패했어요',
  appAny: '앱',
  // 한 응답에서 같이 불려 동시에 돈 도구 묶음 (머리 줄 · 칸 나눔)
  parallel: (n: number) => `동시에 ${n}개`,
  parallelRunning: (n: number) => `${n}개 실행 중`,
  wall: (t: string) => `실행 ${t}`,
  serial: (t: string) => `하나씩이면 ${t}`,
  lanes: '도구마다 실행한 시간', // 시간 막대 (화면 읽기 이름 · 모두 같은 때 시작)
} as const;

// 에이전트 팀 (slice 06) — 상태 줄 · 답 안 팀 묶음(TraceView TeamGroup) · 오른쪽 진행 상황(TeamPanel). '관리자' 없음 · 가운뎃점 없음
export const TEAM = {
  delegate: '팀원에게 맡기기', // delegate 도구 (역할이 오기 전 이름)
  memberN: (n: string) => `팀원 ${n.replace(/^a/, '')}`, // 역할이 오기 전 단계 이름 (agent:a1 → 팀원 1)
  // 상태 줄 (흐르는 중 → 끝 요약 조각)
  forming: '팀을 꾸리는 중',
  working: (n: number) => `팀원 ${count(n)}명이 나눠서 하는 중`,
  gathering: '팀 결과를 모으는 중',
  chip: (n: number) => `팀원 ${count(n)}명`,
  // 답 안 묶음 (ParallelGroup 모양)
  group: (n: number) => `팀원 ${count(n)}명이 나눠서`,
  running: (n: number) => `${count(n)}명 작업 중`,
  openPanel: '오른쪽에서 보기',
  // 오른쪽 진행 상황
  panel: '진행 상황',
  toggle: '진행 상황 열고 닫기', // 대화 머리 토글 (e2e 계약)
  close: '진행 상황 닫기',
  splitting: '일을 나누는 중',
  together: (n: number) => `${count(n)}명이 함께 일하는 중`,
  finished: (n: number) => `${count(n)}명이 함께 끝냈어요`, // 모두 완료일 때만
  partly: (n: number, done: number) => `${count(n)}명 중 ${count(done)}명이 끝냈어요`, // 일부 실패 (+ Meta 'k명 실패')
  allFailed: (n: number) => `${count(n)}명 모두 하지 못했어요`,
  cut: '팀 작업이 중간에 끊겼어요', // 실행 전체가 실패 (총괄 쪽 연결 · 게이트웨이) = 팀원 탓으로 쓰지 않는다
  stopped: '함께 하던 일을 멈췄어요',
  failedN: (n: number) => `${count(n)}명 실패`,
  tree: '팀 구성',
  lead: '총괄',
  leadRole: '일 나누고 확인',
  tools: (role: string) => `${role} 도구 사용`,
  details: (role: string) => `${role} 자세히`,
  state: { waiting: '대기', running: '작업 중', done: '완료', error: '실패', cancelled: '멈춤', waiting_user: '내 확인 필요' },
  // 팀원 펼침
  task: '맡은 일',
  model: '모델',
  given: '받은 도구',
  noTools: '도구 없음',
  usage: '사용량',
  requests: (n: number) => `요청 ${count(n)}회`,
  tokens: (i: number, o: number) => `토큰 입력 ${count(i)}, 출력 ${count(o)}`,
  // 실패 이유 (짧게 · 제공자 원문 없음 · 모르는 code = 모델이 응답하지 못함)
  reasons: {
    member_timeout: '시간이 너무 걸려 멈췄어요',
    member_limit: '요청 한도에 닿았어요',
    member_model_error: '모델이 응답하지 못했어요',
  } as Record<string, string>,
  reasonFallback: '모델이 응답하지 못했어요',
} as const;
// 실패 이유 한 줄 (서버 code 는 reasons 에 있는 키만 · 'constructor' 같은 기본 속성에 걸리지 않게)
export const teamReason = (code: string | null) =>
  code && Object.prototype.hasOwnProperty.call(TEAM.reasons, code) ? TEAM.reasons[code] : TEAM.reasonFallback;

// 대화 화면 (홈 · 대화 · 입력창 · 실패)
export const CHAT = {
  homeTitle: '무엇을 맡길까요?', // e2e 계약 (첫 화면 h1)
  log: '대화 내용',
  placeholderHome: '예: 이 글을 세 줄로 요약해 줘',
  placeholderThread: '이어서 요청하거나 질문하세요',
  placeholderLoading: '대화 기록을 불러오는 중이에요',
  loadingHistory: '대화 기록을 불러오는 중…',
  historyGone: '대화를 찾지 못했어요. 지워졌을 수 있어요',
  historyFailed: (why: string) => `대화 기록을 불러오지 못했어요: ${why}`,
  retry: '다시 시도',
  retryNoThink: '생각 끄고 다시',
  input: '요청 입력',
  attach: '파일 첨부',
  attachSoon: '파일 첨부 (준비 중)',
  voice: '음성 입력',
  voiceSoon: '음성 입력 (준비 중)',
  send: '보내기',
  stop: '멈추기',
  connectApps: '앱 연결하기',
  readOnly: (name: string) => `${name} 님이 공유한 대화예요. 보기만 할 수 있어요`,
  moveFailed: '옮기지 못했어요',
} as const;

// 새 대화 홈의 제안 — 누르면 입력창에 넣지 않고 바로 보낸다. 늘 보이는 것 = 스킬(요약 · 비교표) · 앱 제안 = 지금 쓸 수 있는 앱이 있을 때만
export type Starter = { icon: 'text' | 'grid' | 'plug' | 'search' | 'layers'; text: string; prompt: string; tag?: string };
export const SUGGESTIONS: readonly Starter[] = [
  { icon: 'text', text: '재택근무의 장단점 세 줄 요약', prompt: '재택근무의 장점과 단점을 세 줄로 요약해 줘' },
  { icon: 'grid', text: '노트북 3종 가격, 무게, 배터리 비교표', prompt: '노트북 3종 가격, 무게, 배터리 비교표 만들어줘' },
];

// 앱으로 해 보기 — 연결된 앱(첫 번째)으로 도구 흐름을 바로 확인하는 질문 (진짜 모델이 자연스럽게 앱 도구를 부르게 쓴 글 · E2E 는 mock 표시로 본다)
export const TOOL_TRY = {
  label: '앱으로 해 보기',
  parallel: '동시 실행',
  chain: '여러 단계',
} as const;
export const appStarters = (app: string): readonly Starter[] => [
  { icon: 'search', text: `${app}에서 찾아 정리하기`, prompt: `${app} 앱에서 최근 항목을 찾아서 정리해 줘` },
  { icon: 'plug', text: `${app}에서 두 가지를 동시에 찾기`, prompt: `${app} 앱에서 두 가지를 동시에 찾아서 나란히 보여 줘`, tag: TOOL_TRY.parallel },
  { icon: 'layers', text: `${app}에서 찾고 요약 스킬로 정리`, prompt: `${app} 앱에서 찾은 내용을 요약 스킬로 세 줄 정리해 줘`, tag: TOOL_TRY.chain },
];

// 사이드바 최근 대화
export const RECENT = {
  label: '최근', // e2e 계약 (list 이름)
  more: (n: number) => `더 보기 (${n}개)`,
  less: '접기',
  loading: '불러오는 중…',
  empty: '아직 대화가 없어요',
  failed: '기록을 불러오지 못했어요',
  retry: '다시',
  running: '답 쓰는 중',
  sharedBy: (name: string) => `${name} 님이 공유함`,
} as const;

// 프로젝트 화면의 대화 목록
export const THREADS = {
  label: '대화',
  loading: '불러오는 중…',
  failed: '대화 목록을 불러오지 못했어요',
  retry: '다시',
  shared: '공유됨',
} as const;

// 앱 카드 (답 아래 · ADR-0013 slice 05 카드 A~D). 이름 뒤 조사를 피해 '<이름> 앱' 으로 쓴다
export const APP_CARD = {
  region: (name: string) => `${name} 연결`,
  // A = 처음 한 번 묻기
  askTitle: (name: string) => `${name} 연결이 필요해요`,
  askBody: '다음부터 연결이 필요하면 바로 로그인 화면을 열까요?',
  askYes: '켜고 로그인',
  askNo: '설정에서 할게요',
  // B = 바로 로그인 화면 (자동)
  autoTitle: (name: string) => `${name} 로그인 화면을 열었어요`,
  autoBody: '브라우저에서 로그인을 마치면 이 대화에서 이어서 할게요.',
  autoLimitedTitle: (name: string) => `${name} 연결이 필요해요`,
  autoLimitedBody: '로그인 화면을 열어 연결하면 이 대화에서 이어서 할게요.',
  reopen: '다시 열기',
  open: '로그인 화면 열기',
  stop: '그만두기',
  // C = 연결된 앱에서 직접
  manualTitle: (name: string) => `${name} 앱이 아직 연결되지 않았어요`,
  manualBody: '연결된 앱에서 연결하면 이어서 할게요.',
  openSettings: '연결된 앱 열기',
  connectNow: '지금 연결',
  resume: '이어서 하기',
  readyBody: '연결됐어요. 이어서 하기를 누르면 멈춘 곳부터 다시 해요.',
  // 쓰기 도구가 기다리던 호출 = 로그인 뒤에도 저절로 잇지 않는다
  writeReadyTitle: (name: string) => `${name} 연결됐어요`,
  writeReadyBody: '연결됐어요. 아래 일은 앱의 데이터를 바꿔요. 확인한 뒤 이어서 하기를 눌러 주세요.',
  willRun: '이어서 할 일',
  writeTool: '쓰기 도구',
  loginAt: (domain: string) => `로그인 ${domain}`,
  // 다시 로그인 · 권한 더
  expiredTitle: (name: string) => `${name} 다시 로그인이 필요해요`,
  scopeTitle: (name: string) => `${name} 권한을 더 받아야 해요`,
  // D = 가져오기 전
  importTitle: (name: string) => `${name} 앱을 먼저 가져와야 해요`,
  importBody: (where: string) => (where ? `${where}에 공유된 앱이에요. 연결된 앱에서 가져온 뒤 쓸 수 있어요.` : '공유된 앱이에요. 연결된 앱에서 가져온 뒤 쓸 수 있어요.'),
  // 상태
  opening: '브라우저에서 로그인 중',
  resuming: '이어서 하는 중',
  stopped: '연결을 그만뒀어요. 연결된 앱에서 언제든 연결할 수 있어요.',
  failed: (why: string) => `연결하지 못했어요. ${why}`,
} as const;
