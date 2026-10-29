// conductor API 클라이언트. 주소는 main 이 app://brewai/config.json 으로 준다 (개발 중엔 Vite 가 같은 모양으로).
// 대화 = POST /api/chat (AG-UI RunAgentInput) → AG-UI SSE. 새 의존성 없이 fetch + ReadableStream 으로 읽는다.
// 키는 없다. 게이트웨이·Langfuse 는 conductor 만 안다 (AGENTS.md).
// BrewAI 가 정한 JSON(REST · CUSTOM value) 은 snake_case, AG-UI 자체 필드는 camelCase (conductor 계약).

export type Reasoning = 'off' | 'low' | 'high';

// GET /api/models = 노출된 대화 모델만. 첫 항목 = 기본 모델 (is_default), 나머지는 관리자 순서
export type Model = {
  id: string;
  label: string;
  provider: string; // 아이콘 키 (providers.tsx)
  provider_label: string;
  family: string | null;
  is_default: boolean;
  supports_reasoning: boolean;
  supports_tools: boolean;
  supports_vision: boolean;
  max_input_tokens: number | null;
};

export type ToolInfo = { name: string; label: string; description: string };

export type StepStatus = 'running' | 'done' | 'error' | 'cancelled';
// name = thinking | tool:<이름> | writing · started_ms = 실행 시작부터
export type Step = { name: string; label: string; status: StepStatus; started_ms: number; duration_ms: number | null };
export type Usage = { input_tokens: number | null; output_tokens: number | null; requests: number; tool_calls: number } | null;

export type ThreadSummary = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  turns: number;
  last_model: string | null;
  running: boolean;
};

export type HistoryPart =
  | { type: 'reasoning'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool'; id: string; name: string; label: string; args: unknown; result: unknown; status: 'done' | 'error' | 'running' };

export type HistoryUser = { id: string; role: 'user'; run_id: string; content: string; created_at: string };
export type HistoryAssistant = {
  id: string;
  role: 'assistant';
  run_id: string;
  content: string;
  reasoning: string | null;
  parts: HistoryPart[];
  model: string;
  model_label: string;
  provider: string;
  provider_label: string;
  reasoning_level: Reasoning;
  duration_ms: number | null;
  usage: Usage;
  created_at: string;
};
export type ThreadDetail = { id: string; title: string; created_at: string; updated_at: string; messages: (HistoryUser | HistoryAssistant)[] };

export type RunStatus = 'running' | 'done' | 'error' | 'cancelled';
export type RunRow = {
  id: string;
  thread_id: string;
  thread_title: string;
  status: RunStatus;
  model: string;
  model_label: string;
  provider: string;
  provider_label: string;
  reasoning: Reasoning;
  steps: Step[];
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  error_code: string | null;
  usage: Usage;
};

// 화면이 보여 줄 실패 종류. 서버 글을 그대로 띄우지 않고 code → 문구로 바꾼다 (chat/text.ts)
export type Failure =
  | 'offline' | 'gateway' | 'config' | 'no_models' | 'model_gone' | 'busy' | 'too_long' | 'run_limit' | 'not_found' | 'cut' | 'server';
export class ApiError extends Error {
  constructor(readonly kind: Failure, readonly code?: string) {
    super(code ?? kind);
  }
}

// *_auth_failed = 키 설정 문제 (다시 해도 안 됨) · 나머지 gateway_* = 게이트웨이 문제 (잠시 뒤 다시)
export const kindOf = (code?: string): Failure =>
  code === 'no_models' ? 'no_models'
  : code === 'unknown_model' ? 'model_gone' // 숨김 · 사라짐 · 없는 모델 (서버가 일부러 구분하지 않는다)
  : code === 'thread_busy' ? 'busy'
  : code === 'message_too_long' ? 'too_long'
  : code === 'run_limit' ? 'run_limit'
  : code === 'thread_not_found' ? 'not_found'
  : code && /^(gateway|provider)_auth_failed$/.test(code) ? 'config'
  : code?.startsWith('gateway_') ? 'gateway'
  : 'server';

let base: Promise<string | null> | undefined;
export function apiBase(): Promise<string | null> {
  base ??= fetch('./config.json', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { apiUrl?: unknown } | null) => (typeof j?.apiUrl === 'string' ? j.apiUrl : null))
    .catch(() => null);
  return base;
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const b = await apiBase();
  if (!b) throw new ApiError('offline', 'no_api_url');
  let res: Response;
  try {
    res = await fetch(new URL(path, b), { ...init, credentials: 'omit', redirect: 'error' });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError('offline'); // 꺼짐 · CORS 거절 · CSP 차단 = 모두 TypeError
  }
  if (!res.ok) {
    const code = await res.json().then((j: { detail?: unknown }) => (typeof j.detail === 'string' ? j.detail : undefined), () => undefined);
    throw new ApiError(kindOf(code), code);
  }
  return res;
}

async function json(path: string, signal?: AbortSignal): Promise<unknown> {
  const res = await call(path, { signal });
  try {
    return await res.json();
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError('server', 'bad_json');
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const reasoningOf = (v: unknown): Reasoning => (v === 'low' || v === 'high' ? v : 'off');

export function toSteps(v: unknown): Step[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isObj).map((s) => ({
    name: str(s.name),
    label: str(s.label, str(s.name)),
    status: (['running', 'done', 'error', 'cancelled'] as const).find((x) => x === s.status) ?? 'done',
    started_ms: num(s.started_ms) ?? 0,
    duration_ms: num(s.duration_ms),
  }));
}

export function toUsage(v: unknown): Usage {
  if (!isObj(v)) return null;
  return { input_tokens: num(v.input_tokens), output_tokens: num(v.output_tokens), requests: num(v.requests) ?? 0, tool_calls: num(v.tool_calls) ?? 0 };
}

export async function listModels(signal?: AbortSignal): Promise<Model[]> {
  const data = await json('/api/models', signal);
  if (!Array.isArray(data)) return [];
  return data
    .filter((m): m is Record<string, unknown> => isObj(m) && typeof m.id === 'string' && typeof m.label === 'string')
    .map((m) => ({
      id: m.id as string,
      label: (m.label as string).trim() || (m.id as string),
      provider: str(m.provider, 'other'),
      provider_label: str(m.provider_label),
      family: typeof m.family === 'string' ? m.family : null,
      is_default: m.is_default === true,
      supports_reasoning: m.supports_reasoning === true,
      supports_tools: m.supports_tools === true,
      supports_vision: m.supports_vision === true,
      max_input_tokens: num(m.max_input_tokens),
    }));
}

export async function listTools(signal?: AbortSignal): Promise<ToolInfo[]> {
  const data = await json('/api/tools', signal);
  return Array.isArray(data)
    ? data.filter(isObj).map((t) => ({ name: str(t.name), label: str(t.label, str(t.name)), description: str(t.description) })).filter((t) => t.name)
    : [];
}

export async function listThreads(signal?: AbortSignal): Promise<ThreadSummary[]> {
  const data = await json('/api/threads?limit=50', signal);
  return Array.isArray(data)
    ? data.filter((t) => isObj(t) && typeof t.id === 'string').map((t) => {
        const r = t as Record<string, unknown>;
        return {
          id: r.id as string,
          title: str(r.title).trim() || '제목 없는 대화',
          created_at: str(r.created_at),
          updated_at: str(r.updated_at),
          turns: num(r.turns) ?? 0,
          last_model: typeof r.last_model === 'string' ? r.last_model : null,
          running: r.running === true,
        };
      })
    : [];
}

function toPart(p: Record<string, unknown>): HistoryPart | null {
  if (p.type === 'reasoning' || p.type === 'text') return { type: p.type, text: str(p.text) };
  if (p.type === 'tool') {
    const status = p.status === 'error' ? 'error' : p.status === 'running' ? 'running' : 'done';
    return { type: 'tool', id: str(p.id), name: str(p.name), label: str(p.label, str(p.name)), args: p.args ?? null, result: p.result ?? null, status };
  }
  return null;
}

export async function getThread(id: string, signal?: AbortSignal): Promise<ThreadDetail> {
  const data = await json(`/api/threads/${encodeURIComponent(id)}`, signal);
  if (!isObj(data) || !Array.isArray(data.messages)) throw new ApiError('server', 'bad_shape');
  const messages = data.messages.filter(isObj).flatMap((m): (HistoryUser | HistoryAssistant)[] => {
    if (m.role === 'user') return [{ id: str(m.id), role: 'user', run_id: str(m.run_id), content: str(m.content), created_at: str(m.created_at) }];
    if (m.role !== 'assistant') return [];
    const parts = Array.isArray(m.parts) ? m.parts.filter(isObj).map(toPart).filter((p): p is HistoryPart => p !== null) : [];
    return [{
      id: str(m.id), role: 'assistant', run_id: str(m.run_id), content: str(m.content),
      reasoning: typeof m.reasoning === 'string' ? m.reasoning : null,
      parts: parts.length ? parts : [{ type: 'text', text: str(m.content) }],
      model: str(m.model), model_label: str(m.model_label, str(m.model)), provider: str(m.provider, 'other'),
      provider_label: str(m.provider_label), reasoning_level: reasoningOf(m.reasoning_level),
      duration_ms: num(m.duration_ms), usage: toUsage(m.usage), created_at: str(m.created_at),
    }];
  });
  return { id: str(data.id, id), title: str(data.title), created_at: str(data.created_at), updated_at: str(data.updated_at), messages };
}

export async function listRuns(signal?: AbortSignal): Promise<RunRow[]> {
  const data = await json('/api/runs?limit=30', signal);
  if (!Array.isArray(data)) return [];
  return data.filter((r) => isObj(r) && typeof r.id === 'string').map((x) => {
    const r = x as Record<string, unknown>;
    return {
      id: r.id as string,
      thread_id: str(r.thread_id),
      thread_title: str(r.thread_title).trim() || '제목 없는 대화',
      status: (['running', 'done', 'error', 'cancelled'] as const).find((s) => s === r.status) ?? 'done',
      model: str(r.model),
      model_label: str(r.model_label, str(r.model)),
      provider: str(r.provider, 'other'),
      provider_label: str(r.provider_label),
      reasoning: reasoningOf(r.reasoning),
      steps: toSteps(r.steps),
      started_at: str(r.started_at),
      finished_at: typeof r.finished_at === 'string' ? r.finished_at : null,
      duration_ms: num(r.duration_ms),
      error_code: typeof r.error_code === 'string' ? r.error_code : null,
      usage: toUsage(r.usage),
    };
  });
}

// AG-UI 이벤트 (필요한 칸만 읽는다. 모르는 type 은 그냥 지나간다)
export type AgUiEvent = { type: string } & Record<string, unknown>;

// 한 번 실행 (run). 이벤트마다 onEvent. RUN_FINISHED 면 끝, RUN_ERROR 면 ApiError, 끝 신호 없이 닫히면 'cut'.
// 서버가 대화 기록의 원본이라 이번 질문(마지막 user 메시지)만 보낸다. runId 는 시도마다 새로, threadId 는 대화마다 하나.
export async function runChat(opts: {
  threadId: string;
  runId: string;
  text: string;
  model?: string;
  reasoning: Reasoning;
  signal: AbortSignal;
  onEvent: (ev: AgUiEvent) => void;
}): Promise<void> {
  const body = {
    threadId: opts.threadId,
    runId: opts.runId,
    state: {},
    messages: [{ id: `${opts.runId}:user`, role: 'user', content: opts.text }],
    tools: [], // 툴은 conductor 가 갖는다 (승인·정책). 프런트 툴은 서버가 400
    context: [],
    forwardedProps: { ...(opts.model ? { model: opts.model } : {}), reasoning: opts.reasoning },
  };
  const res = await call('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.body) throw new ApiError('server', 'no_body');
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<string>;
      try {
        chunk = await reader.read();
      } catch (e) {
        if ((e as Error).name === 'AbortError' || opts.signal.aborted) throw new DOMException('aborted', 'AbortError');
        throw new ApiError('cut');
      }
      if (chunk.done) throw new ApiError('cut'); // 끝 신호 없이 닫힘
      buf += chunk.value.replace(/\r\n?/g, '\n');
      let cut: number;
      while ((cut = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, cut);
        buf = buf.slice(cut + 2);
        const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
        if (!data) continue;
        let ev: AgUiEvent;
        try {
          ev = JSON.parse(data) as AgUiEvent;
        } catch {
          continue; // 깨진 조각 하나로 대화 전체를 버리지 않는다
        }
        if (!isObj(ev) || typeof ev.type !== 'string') continue;
        if (ev.type === 'RUN_ERROR') throw new ApiError(kindOf(str(ev.code) || undefined), str(ev.code) || undefined); // message 는 안 쓴다
        opts.onEvent(ev);
        if (ev.type === 'RUN_FINISHED') return;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
