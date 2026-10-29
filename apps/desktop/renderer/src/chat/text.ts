// 대화 화면 문구 한곳 (한국어). 서버 글은 그대로 띄우지 않고 code → 문구.
import type { Failure, Reasoning, RunStatus, Step, StepStatus } from '../api';

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
  cut: '답이 중간에 끊겼어요',
  server: '답을 받지 못했어요',
};

// 왜 안 됐는지 (RUN_ERROR.detail) → 한 줄 + 고치는 곳. 모르는 detail 이면 FAILURE_TEXT 그대로.
// 사용자 앱이지만 P1 은 쓰는 사람 = 설정하는 사람이라 고치는 곳(LiteLLM 관리 화면 · .env)을 같이 보여 준다
// reasoningOff = 생각을 끄고 다시 하면 될 수 있다 (버튼 '생각 끄고 다시')
export const DETAIL: Record<string, { text: string; hint: string; reasoningOff?: boolean }> = {
  provider_key_missing: {
    text: '이 모델의 API 키가 설정돼 있지 않아요',
    hint: 'LiteLLM 관리 화면 › Models › 이 모델의 Credential 키 확인 (config.yaml 모델이면 .env 의 ANTHROPIC_API_KEY · OPENAI_API_KEY)',
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
    hint: '생각 깊이를 끄고 다시 · 계속되면 다른 모델로',
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
    hint: 'LiteLLM 관리 화면 › Models 에 모델이 있는지 확인 · 지웠다면 다른 모델을 골라 주세요',
  },
  gateway_budget_exceeded: {
    text: '게이트웨이 사용 한도(예산)를 넘었어요',
    hint: 'LiteLLM 관리 화면 › Virtual Keys · Teams 의 Max Budget 확인',
  },
  provider_rate_limited: { text: '요청이 많아 모델이 잠시 막혔어요', hint: '잠시 뒤 다시 시도해 주세요' },
  provider_unavailable: { text: '모델 쪽 서버가 지금 응답하지 않아요', hint: '잠시 뒤 다시 시도해 주세요' },
};

// 서버가 준 detail 은 DETAIL 에 있는 키만 쓴다 ('constructor' 같은 Object 기본 속성에 걸리지 않게)
export const detailText = (detail: string | null | undefined) =>
  detail && Object.prototype.hasOwnProperty.call(DETAIL, detail) ? DETAIL[detail] : undefined;

// 진행 상황 목록의 짧은 실패 이유 (error_code). 사용자 앱이라 '관리자' 같은 말은 쓰지 않는다
const RUN_ERROR_TEXT: Record<string, string> = {
  provider_auth_failed: '모델 키 문제',
  gateway_auth_failed: '게이트웨이 인증 실패',
  provider_rejected: '모델 설정 문제',
  gateway_unreachable: '모델에 연결 못 함',
  run_limit: '단계가 너무 많음',
  model_error: '모델 오류',
  internal_error: '서버 오류',
  client_disconnected: '중간에 멈춤',
  interrupted: '서버가 다시 켜져 멈춤',
};
export const runErrorText = (code: string | null) => (code && RUN_ERROR_TEXT[code]) || '실패';

export const REASONING: readonly { id: Reasoning; label: string; sub: string }[] = [
  { id: 'off', label: '끄기', sub: '바로 답해요' },
  { id: 'low', label: '보통', sub: '필요할 때 생각하고 답해요' }, // 게이트웨이에는 effort medium (agent.py REASONING_EFFORT)
  { id: 'high', label: '깊게', sub: '오래 생각해요 · 느려요' },
];
export const reasoningLabel = (r: Reasoning) => REASONING.find((x) => x.id === r)?.label ?? '끄기';

export const RUN_STATUS: Record<RunStatus, { label: string; dot: 'run' | 'ok' | 'fail' | 'stop' }> = {
  running: { label: '진행 중', dot: 'run' },
  done: { label: '완료', dot: 'ok' },
  error: { label: '실패', dot: 'fail' },
  cancelled: { label: '멈춤', dot: 'stop' },
};
export const STEP_DOT: Record<StepStatus, 'run' | 'ok' | 'fail' | 'stop'> = { running: 'run', done: 'ok', error: 'fail', cancelled: 'stop' };

// 단계 이름 → 화면 이름. 툴 이름은 /api/tools 의 label (계산기 · 현재 시각) · 스킬은 /api/skills 의 label (스킬 · 요약)
export function stepLabel(name: string, tools: Record<string, string>, skills: Record<string, string> = {}): string {
  if (name === 'thinking') return '생각';
  if (name === 'writing') return '답 쓰기';
  if (name.startsWith('tool:')) {
    const tool = name.slice(5);
    return tools[tool] ?? tool;
  }
  if (name.startsWith('skill:')) {
    const skill = name.slice(6);
    return `스킬 · ${skills[skill] ?? skill}`;
  }
  return name;
}

// ── 생각 · 도구 상태 줄 (chat/Answer.tsx .trace-line · 진행 상황 화면) ──
// 문구는 시간으로만 고른다 (결정적 · 테스트가 본다). 무작위로 돌리지 않는다.
export const WAITING_PHRASE = '질문을 살펴보는 중';
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

// 트레이스 계산에 필요한 답의 모양만 (session.ts Answer 와 같은 칸 — 순환 import 를 피한다)
type TraceReasoning = { kind: 'reasoning'; text: string; live: boolean; ms: number | null; at: number };
type TraceTool = { kind: 'tool'; name: string; label: string; status: 'running' | 'done' | 'error' | 'cancelled'; args: unknown };
type TracePart = TraceReasoning | TraceTool | { kind: 'text' };
export type TraceAnswer = {
  status: 'sending' | 'running' | 'done' | 'failed' | 'stopped';
  reasoning: Reasoning;
  parts: readonly TracePart[];
  steps: readonly Step[];
  startedAt: number;
  durationMs: number | null;
  usage: { reasoning_tokens: number | null } | null;
  fromHistory: boolean;
};
export type TracePhase = 'live' | 'done' | 'stopped';
export type Trace = { step: string; phase: TracePhase; text: string };

const isTool = (p: TracePart): p is TraceTool => p.kind === 'tool';
const isReasoning = (p: TracePart): p is TraceReasoning => p.kind === 'reasoning';
// 생각을 했나 = 생각 글이 왔거나, 글은 없어도 생각 토큰이 있다
export const thought = (a: TraceAnswer) => a.parts.some(isReasoning) || (a.usage?.reasoning_tokens ?? 0) > 0;
// 생각 깊이를 켰는데 모델이 생각 없이 바로 답했다 (adaptive 모델이 쉬운 질문에서 건너뜀 · 생각 토큰 0) = 고장이 아니라 모델의 선택
export const skippedThinking = (a: TraceAnswer) =>
  a.status === 'done' && a.reasoning !== 'off' && !thought(a) && a.usage?.reasoning_tokens === 0;
export const NO_THINK = '생각 없이 바로 답함';

// 도구 쓴 횟수 한 조각: '계산기 1회' · '계산기 1회 · 단위 변환 2회' · 세 종류 이상이면 '도구 3회'
export function toolTally(a: TraceAnswer, tools: Record<string, string> = {}): string {
  const used = a.parts.filter(isTool);
  if (!used.length) return '';
  const counts = new Map<string, number>();
  for (const p of used) {
    const label = tools[p.name] ?? p.label ?? p.name;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  if (counts.size > 2) return `도구 ${used.length}회`;
  return [...counts].map(([label, n]) => `${label} ${n}회`).join(' · ');
}

// 끝난 답의 요약 한 줄. 아무것도 없으면 '' (트레이스 줄을 안 그린다)
export function doneSummary(a: TraceAnswer, tools: Record<string, string> = {}): string {
  const tally = toolTally(a, tools);
  if (thought(a)) {
    // 생각한 시간 = 생각 글이 흐른 시간 → 없으면 'thinking' 단계 시간. 둘 다 없으면(생각 글 없음 · 기록) 시간을 쓰지 않는다
    // (전체 실행 시간은 답 쓰기까지 들어 있어 생각 시간이 아니다)
    const sum = (xs: (number | null)[]) => xs.reduce<number | null>((t, x) => (x == null ? t : (t ?? 0) + x), null);
    const ms = sum(a.parts.filter(isReasoning).map((p) => p.ms)) ?? sum(a.steps.filter((st) => st.name === 'thinking').map((st) => st.duration_ms));
    const t = seconds(ms);
    return [t ? `${t} 동안 생각함` : '생각함', tally].filter(Boolean).join(' · ');
  }
  if (skippedThinking(a)) return [NO_THINK, tally, a.fromHistory ? '' : seconds(a.durationMs)].filter(Boolean).join(' · ');
  if (tally) return [tally, a.fromHistory ? '' : seconds(a.durationMs)].filter(Boolean).join(' · ');
  return '';
}

// 상태 줄 한 칸 = 단계 훅(data-step) · 국면(data-phase) · 글. 진행 상황 화면도 같은 문구를 쓴다
export function tracePhrase(a: TraceAnswer, now: number, tools: Record<string, string>, skills: Record<string, string> = {}): Trace {
  const live = a.status === 'sending' || a.status === 'running';
  if (!live) {
    if (a.status === 'done') return { step: 'done', phase: 'done', text: doneSummary(a, tools) };
    return { step: 'stopped', phase: 'stopped', text: ['중간에 멈춤', seconds(a.durationMs)].filter(Boolean).join(' · ') };
  }
  const elapsed = now - a.startedAt;
  const step = a.steps.findLast((s) => s.status === 'running');
  if (!step) {
    // 단계 사이 (앞 단계는 끝났고 다음 단계 전) = 앞 단계의 말을 이어 간다 (도구 뒤 = 결과를 읽는 중)
    const prev = a.steps.at(-1);
    if (!prev) return { step: 'waiting', phase: 'live', text: WAITING_PHRASE };
    if (prev.name.startsWith('tool:')) return { step: prev.name, phase: 'live', text: '결과를 살펴보는 중' };
    return { step: prev.name, phase: 'live', text: stepPhrase(prev.name, prev.duration_ms ?? 0, tools, skills) };
  }
  // 도구 결과가 이미 왔는데 다음 단계 전 = 모델이 결과를 읽는 중. 스킬은 지침을 읽는 동안 '펼치는 중' 그대로
  if (step.name.startsWith('tool:')) {
    const name = step.name.slice(5);
    const tool = a.parts.findLast((p): p is TraceTool => isTool(p) && p.name === name);
    if (tool && tool.status !== 'running') return { step: step.name, phase: 'live', text: '결과를 살펴보는 중' };
  }
  return { step: step.name, phase: 'live', text: stepPhrase(step.name, elapsed - step.started_ms, tools, skills) };
}

// 모델 연결 실패 짧은 이유 (모델 메뉴 경고 · /api/models health_code). 데스크톱 사용자 말로
export const HEALTH_SHORT: Record<string, string> = {
  provider_key_missing: '키 없음',
  provider_key_invalid: '키 틀림',
  provider_model_not_found: '모델 이름 없음',
  reasoning_unsupported: '생각 설정 거절',
  provider_bad_request: '요청 거절',
  gateway_budget_exceeded: '사용 한도 초과',
  gateway_key_invalid: '게이트웨이 키 틀림',
  gateway_model_denied: '이 키로 못 씀',
  gateway_model_missing: '게이트웨이에 없음',
  provider_rate_limited: '요청 제한',
  provider_unavailable: '모델 서버 응답 없음',
  gateway_unreachable: '게이트웨이 꺼짐',
  gateway_auth_failed: '게이트웨이 인증 실패',
  provider_auth_failed: '키 문제',
  provider_rejected: '설정 문제',
  model_error: '모델 오류',
};
export const healthShort = (code: string | null | undefined) =>
  (code && Object.prototype.hasOwnProperty.call(HEALTH_SHORT, code) ? HEALTH_SHORT[code] : null) ?? '연결 실패';

// 128000 → 128K · 1000000 → 1M
export const tokensShort = (n: number | null | undefined) =>
  n == null ? null : n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n);

// 걸린 시간: 0.4초 · 12초 · 1분 5초
export function seconds(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '';
  const s = Math.max(0, ms) / 1000;
  if (s < 10) return `${s.toFixed(1)}초`;
  if (s < 60) return `${Math.round(s)}초`;
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return r ? `${m}분 ${r}초` : `${m}분`;
}

// '방금' · '3분 전' · '2시간 전' · '10월 28일'
export function ago(iso: string | null | undefined, now = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '';
  const s = Math.round((now - t) / 1000);
  if (s < 45) return '방금';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}분 전`;
  if (s < 86400) return `${Math.round(s / 3600)}시간 전`;
  const d = new Date(t);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

export const titleOf = (text: string) => {
  const line = text.split('\n').map((l) => l.trim()).find(Boolean) ?? text.trim();
  return line.length <= 80 ? line : `${line.slice(0, 79)}…`;
};
