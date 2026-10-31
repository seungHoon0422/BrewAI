// 대화 화면 문구 한곳 (한국어). 서버 글은 그대로 띄우지 않고 code → 문구.
// 사용자 앱이라 '관리자' 같은 말은 쓰지 않는다 (e2e desktop.spec). 고치는 곳(LiteLLM 관리 화면 · .env)은 P1 이라 같이 보여 준다.
import type { Failure } from '../../lib/api';

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
  provider_unavailable: { text: '모델 쪽 서버가 지금 응답하지 않아요', hint: '잠시 뒤 다시 시도해 주세요' },
};

// 서버가 준 detail 은 DETAIL 에 있는 키만 쓴다 ('constructor' 같은 Object 기본 속성에 걸리지 않게)
export const detailText = (detail: string | null | undefined) =>
  detail && Object.prototype.hasOwnProperty.call(DETAIL, detail) ? DETAIL[detail] : undefined;

// ── 단계 이름 · 지금 하는 일 (상태 줄 · 진행 상황 화면) ──
// 문구는 시간으로만 고른다 (결정적 · 테스트가 본다). 무작위로 돌리지 않는다.

// 단계 이름 → 화면 이름. 툴 이름은 /api/tools 의 label (계산기 · 현재 시각) · 스킬은 /api/skills 의 label (스킬: 요약)
export function stepLabel(name: string, tools: Record<string, string>, skills: Record<string, string> = {}): string {
  if (name === 'thinking') return '생각';
  if (name === 'writing') return '답 쓰기';
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
const TOOL_PHRASE: Record<string, string> = {
  calculator: '계산하는 중',
  current_time: '지금 시각을 확인하는 중',
  unit_convert: '단위를 바꾸는 중',
  date_calc: '날짜를 세는 중',
  text_stats: '글자를 세는 중',
};
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
  if (name?.startsWith('tool:')) {
    const tool = name.slice(5);
    return TOOL_PHRASE[tool] ?? `${tools[tool] ?? tool} 쓰는 중`;
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
      `요청 ${u.requests}회`,
      u.input_tokens != null || u.output_tokens != null ? `토큰 입력 ${u.input_tokens ?? '—'} / 출력 ${u.output_tokens ?? '—'}` : '',
      u.reasoning_tokens ? `생각 토큰 ${u.reasoning_tokens}` : '',
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
  state: { running: '실행 중', done: '완료', error: '실패', cancelled: '멈춤' },
  rows: {
    expression: '수식', timezone: '시간대', skill: '스킬', convert: '변환', calc: '계산', text: '글', input: '입력', error: '오류', result: '결과',
  },
  defaultTimezone: 'Asia/Seoul',
  days: (d: string) => `${d}일`,
  received: (n: number) => `${n}자 받음`,
  skillLoaded: (lines: number | null) => `지침 불러옴${lines != null ? ` (${lines}줄)` : ''}`,
  dayCount: (text: string, days: string) => `${text} (${days}일)`,
  textStats: (r: { characters: string; noSpaces: string; words: string; lines: string }) =>
    `${r.characters}자, 공백 빼고 ${r.noSpaces}자, 단어 ${r.words}, ${r.lines}줄`,
  // 한 응답에서 같이 불려 동시에 돈 도구 묶음 (머리 줄 · 칸 나눔)
  parallel: (n: number) => `동시에 ${n}개`,
  parallelRunning: (n: number) => `${n}개 실행 중`,
  wall: (t: string) => `실행 ${t}`,
  serial: (t: string) => `하나씩이면 ${t}`,
  lanes: '도구마다 부른 때와 실행한 때', // 시간 막대 (화면 읽기 이름)
} as const;

// 대화 화면 (홈 · 대화 · 입력창 · 실패)
export const CHAT = {
  homeTitle: '무엇을 맡길까요?', // e2e 계약 (첫 화면 h1)
  log: '대화 내용',
  placeholderHome: '예: 이번 주 메일에서 할 일만 뽑아줘',
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

// 새 대화 홈의 제안 — 누르면 입력창에 넣지 않고 바로 보낸다
export type Starter = { icon: 'mail' | 'team' | 'calendar' | 'clock' | 'ruler' | 'layers'; text: string; prompt: string; need?: string; tag?: string };
export const SUGGESTIONS: readonly Starter[] = [
  { icon: 'mail', text: "'견적 요청' 메일에 답장 초안 쓰기", prompt: "'견적 요청' 메일에 답장 초안 써줘", need: '연결 필요' },
  { icon: 'team', text: '노트북 3종 비교표 — 여럿이 나눠서 조사', prompt: '노트북 3종 가격, 무게, 배터리 비교표 만들어줘' },
  { icon: 'calendar', text: '내일 10시 회의 자료 준비', prompt: '내일 10시 회의 자료 준비해줘', need: '연결 필요' },
];

// 도구 시험 — 도구 · 스킬 실행 흐름을 바로 확인하는 질문 (진짜 모델이 자연스럽게 도구를 부르게 쓴 글 · E2E 는 mock 표시로 본다)
export const TOOL_TRY = {
  label: '도구 시험',
  parallel: '동시 실행',
  chain: '여러 단계',
} as const;
export const TOOL_STARTERS: readonly Starter[] = [
  { icon: 'clock', text: '서울과 뉴욕 지금 시각, 시차까지', prompt: '서울이랑 뉴욕 지금 몇 시인지 알려 주고 시차도 계산해 줘', tag: TOOL_TRY.parallel },
  { icon: 'ruler', text: '마일, 섭씨, GiB 세 가지를 한 번에 바꾸기', prompt: '마라톤 42.195km 는 몇 마일인지, 68°F 는 섭씨로 몇 도인지, 2TB 는 몇 GiB 인지 한 번에 알려 줘', tag: TOOL_TRY.parallel },
  {
    icon: 'layers', text: '크리스마스까지 D-day 세고 송년회 준비표 만들기', tag: TOOL_TRY.chain,
    prompt: '오늘 날짜를 확인하고, 올해 크리스마스까지 며칠 남았는지 센 다음, 회의 준비 스킬로 그날 송년회 준비 체크리스트를 만들어 줘',
  },
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
