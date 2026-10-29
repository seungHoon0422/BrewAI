// conductor API 클라이언트. 주소는 main 이 app://brewai/config.json 으로 준다 (개발 중엔 Vite 가 같은 모양으로).
// 대화 = POST /api/chat (AG-UI RunAgentInput) → AG-UI SSE. 새 의존성 없이 fetch + ReadableStream 으로 읽는다.
// 키는 없다. 게이트웨이·Langfuse 는 conductor 만 안다 (AGENTS.md).

export type Model = { id: string; label: string };
export type Turn = { id: string; role: 'user' | 'assistant'; content: string };

// 화면이 보여 줄 실패 종류. 서버 글을 그대로 띄우지 않고 code → 문구로 바꾼다 (Chat.tsx)
export type Failure = 'offline' | 'gateway' | 'config' | 'no_models' | 'cut' | 'server';
export class ApiError extends Error {
  constructor(readonly kind: Failure, readonly code?: string) {
    super(code ?? kind);
  }
}

// *_auth_failed = 키 설정 문제 (다시 해도 안 됨 → 관리자) · 나머지 gateway_* = 게이트웨이 문제 (잠시 뒤 다시)
const kindOf = (code?: string): Failure =>
  code === 'no_models' ? 'no_models'
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

// 첫 항목 = 기본 모델 (conductor 가 정한다. P2: 관리자 순서)
export async function listModels(signal?: AbortSignal): Promise<Model[]> {
  const data: unknown = await (await call('/api/models', { signal })).json();
  return Array.isArray(data) ? data.filter((m): m is Model => typeof m?.id === 'string' && typeof m?.label === 'string') : [];
}

type AgUiEvent = { type: string; delta?: string; code?: string };

// 한 번 실행 (run). onDelta 로 글이 들어올 때마다 부른다. RUN_FINISHED 없이 끝나면 'cut'.
export async function runChat(opts: {
  threadId: string;
  turns: Turn[];
  model?: string;
  signal: AbortSignal;
  onDelta: (text: string) => void;
}): Promise<void> {
  const body = {
    threadId: opts.threadId,
    runId: crypto.randomUUID(),
    state: {},
    messages: opts.turns.map((t) => ({ id: t.id, role: t.role, content: t.content })),
    tools: [], // 툴은 conductor 가 갖는다 (승인·정책). 프런트 툴은 서버가 400
    context: [],
    forwardedProps: opts.model ? { model: opts.model } : {},
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
  for (;;) {
    let chunk: ReadableStreamReadResult<string>;
    try {
      chunk = await reader.read();
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
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
      const ev = JSON.parse(data) as AgUiEvent;
      if (ev.type === 'TEXT_MESSAGE_CONTENT' && ev.delta) opts.onDelta(ev.delta);
      else if (ev.type === 'RUN_ERROR') throw new ApiError(kindOf(ev.code), ev.code); // message 는 안 쓴다
      else if (ev.type === 'RUN_FINISHED') {
        await reader.cancel().catch(() => {});
        return;
      }
    }
  }
}
