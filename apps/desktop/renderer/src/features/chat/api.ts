// 대화 API — 최근 대화 · 대화 기록 · 한 번 실행(AG-UI SSE).
// 대화 = POST /api/chat (AG-UI RunAgentInput) → AG-UI SSE. 새 의존성 없이 fetch + ReadableStream 으로 읽는다.
import { toFile, type FileItem } from '../files/api';
import { ApiError, bool, call, isObj, json, kindOf, list, num, reasoningOf, send, str, strOrNull, type Reasoning } from '../../lib/api';
import type { ScopePath } from '@brewai/ui';
import { toScopePath } from '../scope/api';
export { toVia, type Via } from '../connections/api';
import { UNTITLED } from './copy';
import type { MemberStatus, MemberStep, MemberTool, MemberUsage, TeamMember } from './model';

export type StepStatus = 'running' | 'done' | 'error' | 'cancelled' | 'waiting';
// name = thinking | tool:<이름> | skill:<스킬> | app:<앱> | writing · started_ms = 실행 시작부터 · waiting = 앱 연결을 기다리며 멈춘 툴 단계
// call_id · batch = 툴 단계만 (같은 batch = 한 모델 응답에서 같이 불려 동시에 돌았다)
// agent:<a1> = 팀원 단계 (slice 06) · parent · agent = 팀원 도구 줄 (자식 줄 · parent = 그 delegate 호출 id) · app = 앱 handle
export type Step = {
  name: string; label: string; status: StepStatus; started_ms: number; duration_ms: number | null; call_id?: string; batch?: number;
  parent?: string; agent?: string; app?: string;
};
// reasoning_tokens = 생각 토큰 (글이 안 와도 >0 이면 생각은 했다 · display omitted · redacted)
export type Usage = { input_tokens: number | null; output_tokens: number | null; requests: number; tool_calls: number; reasoning_tokens: number | null } | null;

// 대화가 어디에 있고 누구 것인지 (스페이스 · 프로젝트 · 공개 · 만든 사람 닉네임)
export type ThreadScope = {
  space_id: string | null;
  project_id: string | null; // null = 프로젝트 없음
  visibility: 'private' | 'shared';
  mine: boolean;
  owner_name: string | null;
};

export type ThreadSummary = ThreadScope & {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  turns: number;
  last_model: string | null;
  running: boolean;
  path: ScopePath;
};

// MCP 도구 · use_app 카드 = + app (handle) · app_name · write (쓰기 도구) · delegate = + team (팀원 요약 · slice 06)
export type HistoryPart =
  | { type: 'reasoning'; text: string }
  | { type: 'text'; text: string }
  | {
    type: 'tool'; id: string; name: string; label: string; args: unknown; result: unknown; status: 'done' | 'error' | 'running' | 'waiting'; batch: number | null;
    app: { handle: string; name: string; write: boolean } | null; team: TeamMember | null;
  };

// 앱 연결을 기다리며 멈춘 호출 (run_summary.pending · 기록의 assistant.pending · brewai.app_auth 와 같은 서버 정보)
export type AppAuthMode = 'ask' | 'auto' | 'manual';
export type AppAuthReason = 'not_connected' | 'expired' | 'insufficient_scope';
// issuerDomain = 로그인 화면이 열릴 곳 (서버 도메인과 다르면 카드에 보인다)
export type AppServer = { id: string; handle: string; name: string; domain: string; issuerDomain: string | null };
// write · label = 멈춘 호출이 앱 도구일 때 (쓰기 도구 = 로그인 뒤 저절로 잇지 않고 [이어서 하기] 를 누른다)
export type PendingCall = {
  call_id: string; server: AppServer; mode: AppAuthMode; reason: AppAuthReason; scope: string | null; write: boolean; label: string | null;
};

const MODES = ['ask', 'auto', 'manual'] as const;
const REASONS = ['not_connected', 'expired', 'insufficient_scope'] as const;
export const authMode = (v: unknown): AppAuthMode => MODES.find((x) => x === v) ?? 'manual';
export const authReason = (v: unknown): AppAuthReason => REASONS.find((x) => x === v) ?? 'not_connected';
export const toAppServer = (v: unknown): AppServer =>
  isObj(v)
    ? { id: str(v.id), handle: str(v.handle), name: str(v.name, str(v.handle)), domain: str(v.domain), issuerDomain: strOrNull(v.issuer_domain) }
    : { id: '', handle: '', name: '', domain: '', issuerDomain: null };

// 기록의 pending 한 칸 = {call_id, tool, server_id, handle, name, domain, issuer_domain, reason, mode, scope, write, label}
function toPending(v: Record<string, unknown>): PendingCall | null {
  const call_id = str(v.call_id);
  if (!call_id) return null;
  return {
    call_id, server: toAppServer({ ...v, id: v.server_id }),
    mode: authMode(v.mode), reason: authReason(v.reason), scope: strOrNull(v.scope), write: v.write === true, label: strOrNull(v.label),
  };
}

export type HistoryUser = { id: string; role: 'user'; run_id: string; content: string; created_at: string; files: FileItem[] };
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
  resumed: boolean; // 앱 연결 뒤 이어서 하기로 돈 실행 (앞에 질문이 없다)
  pending: PendingCall[]; // 지금도 앱 연결을 기다리는 호출
};
// path = 범위 경로 (조직 › 스페이스 › 프로젝트 › 이 대화). 아직 경로를 안 주는 서버면 빈 배열
export type ThreadDetail = ThreadScope & {
  id: string; title: string; created_at: string; updated_at: string; path: ScopePath; messages: (HistoryUser | HistoryAssistant)[];
};

// 응답(요약 · 상세)에서 범위 칸만 — 범위 칸이 바뀌면 여기와 toThreadScope 만
export const pickScope = ({ space_id, project_id, visibility, mine, owner_name }: ThreadScope): ThreadScope =>
  ({ space_id, project_id, visibility, mine, owner_name });

export function toThreadScope(r: Record<string, unknown>): ThreadScope {
  return {
    space_id: strOrNull(r.space_id),
    project_id: strOrNull(r.project_id),
    visibility: r.visibility === 'shared' ? 'shared' : 'private',
    mine: r.mine !== false, // 모르는 서버 = 내 것
    owner_name: strOrNull(r.owner_name),
  };
}

export function toSteps(v: unknown): Step[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isObj).map((s) => ({
    name: str(s.name),
    label: str(s.label, str(s.name)),
    status: (['running', 'done', 'error', 'cancelled', 'waiting'] as const).find((x) => x === s.status) ?? 'done',
    started_ms: num(s.started_ms) ?? 0,
    duration_ms: num(s.duration_ms),
    ...(typeof s.call_id === 'string' ? { call_id: s.call_id } : {}),
    ...(num(s.batch) != null ? { batch: num(s.batch)! } : {}),
    ...(typeof s.parent === 'string' ? { parent: s.parent } : {}),
    ...(typeof s.agent === 'string' ? { agent: s.agent } : {}),
    ...(typeof s.app === 'string' && s.app ? { app: s.app } : {}),
  }));
}

// ── 에이전트 팀 (slice 06) — brewai.team_member · brewai.agent_step · 기록의 delegate 칸이 같은 모양 (값은 snake_case) ──
const MEMBER_STATUS = ['waiting', 'running', 'done', 'error', 'cancelled', 'waiting_user'] as const;
const STEP_STATUS = ['running', 'done', 'error', 'cancelled', 'waiting'] as const;
export const memberStatus = (v: unknown): MemberStatus => MEMBER_STATUS.find((x) => x === v) ?? 'running';
export function toMemberUsage(v: unknown): MemberUsage | null {
  if (!isObj(v)) return null;
  return { requests: num(v.requests) ?? 0, input_tokens: num(v.input_tokens) ?? 0, output_tokens: num(v.output_tokens) ?? 0, tool_calls: num(v.tool_calls) ?? 0 };
}
const toMemberTool = (v: Record<string, unknown>): MemberTool => ({ name: str(v.name), label: str(v.label, str(v.name)), app: strOrNull(v.app) || null });
// at = 이 창에서 받은 때 (기록 = 0)
export function toMemberStep(v: Record<string, unknown>, at = 0): MemberStep {
  return {
    id: str(v.call_id), name: str(v.name), label: str(v.label, str(v.name)), app: strOrNull(v.app) || null,
    status: STEP_STATUS.find((x) => x === v.status) ?? 'done', startedMs: num(v.started_ms) ?? 0, durationMs: num(v.duration_ms), at,
  };
}
// 팀원 한 칸 (prev = 앞서 받은 같은 팀원 · 도구 줄 · 시작 시각은 그대로 두고 나머지를 새 값으로). 모르는 칸은 앞 값
export function toMember(v: Record<string, unknown>, prev: TeamMember | undefined, at = 0): TeamMember {
  const status = memberStatus(v.status);
  const tools = Array.isArray(v.tools) ? list(v.tools).map(toMemberTool).filter((t) => t.name) : prev?.tools ?? [];
  return {
    callId: str(v.call_id, prev?.callId ?? ''), agent: str(v.agent, prev?.agent ?? ''), role: str(v.role, prev?.role ?? ''),
    task: str(v.task, prev?.task ?? ''), modelLabel: str(v.model_label, prev?.modelLabel ?? ''), tools, status,
    ms: num(v.ms) ?? prev?.ms ?? null, code: strOrNull(v.code) ?? (status === 'error' ? prev?.code ?? null : null),
    usage: toMemberUsage(v.usage) ?? prev?.usage ?? null,
    steps: Array.isArray(v.steps) ? list(v.steps).map((x) => toMemberStep(x)) : prev?.steps ?? [],
    at: prev?.at || (status === 'waiting' ? 0 : at),
  };
}

export function toUsage(v: unknown): Usage {
  if (!isObj(v)) return null;
  return {
    input_tokens: num(v.input_tokens), output_tokens: num(v.output_tokens), requests: num(v.requests) ?? 0, tool_calls: num(v.tool_calls) ?? 0,
    reasoning_tokens: num(v.reasoning_tokens),
  };
}

function toSummary(r: Record<string, unknown>): ThreadSummary {
  return {
    ...toThreadScope(r),
    id: str(r.id),
    title: str(r.title).trim() || UNTITLED,
    created_at: str(r.created_at),
    updated_at: str(r.updated_at),
    turns: num(r.turns) ?? 0,
    last_model: strOrNull(r.last_model),
    running: r.running === true,
    path: toScopePath(r.path),
  };
}

// 한 스페이스의 대화 (내 것 + 공유된 것). project: id = 그 프로젝트만 · 'none' = 프로젝트 없는 것만 · 없음 = 전부
export async function listThreads(q: { space?: string | null; project?: string | 'none'; limit?: number }, signal?: AbortSignal): Promise<ThreadSummary[]> {
  const params = new URLSearchParams({ limit: String(q.limit ?? 50) });
  if (q.space) params.set('space', q.space);
  if (q.project) params.set('project', q.project);
  const data = await json(`/api/threads?${params}`, signal);
  return Array.isArray(data) ? data.filter((t) => isObj(t) && typeof t.id === 'string').map((t) => toSummary(t as Record<string, unknown>)) : [];
}

// 제목 · 공유 · 프로젝트 옮기기 (만든 사람만) → 바뀐 대화
export async function patchThread(id: string, patch: { title?: string; visibility?: 'private' | 'shared'; project_id?: string | null }): Promise<ThreadSummary> {
  const data = await send(`/api/threads/${encodeURIComponent(id)}`, 'PATCH', patch);
  if (!isObj(data) || typeof data.id !== 'string') throw new ApiError('server', 'bad_shape');
  return toSummary(data);
}

function toPart(p: Record<string, unknown>): HistoryPart | null {
  if (p.type === 'reasoning' || p.type === 'text') return { type: p.type, text: str(p.text) };
  if (p.type === 'tool') {
    const status = p.status === 'error' ? 'error' : p.status === 'running' ? 'running' : p.status === 'waiting' ? 'waiting' : 'done';
    const app = typeof p.app === 'string' && p.app ? { handle: p.app, name: str(p.app_name, p.app), write: bool(p.write) } : null;
    // 팀원 카드 = delegate 칸 + 팀원 요약 (agent · role · task · model_label · tools · steps · usage · status · code) = 실시간과 같은 트리
    const team = p.name === 'delegate' && typeof p.agent === 'string' ? toMember({ ...p, call_id: p.id }, undefined) : null;
    return {
      type: 'tool', id: str(p.id), name: str(p.name), label: str(p.label, str(p.name)), args: p.args ?? null, result: p.result ?? null, status,
      batch: num(p.batch), app, team,
    };
  }
  return null;
}

export async function getThread(id: string, signal?: AbortSignal): Promise<ThreadDetail> {
  const data = await json(`/api/threads/${encodeURIComponent(id)}`, signal);
  if (!isObj(data) || !Array.isArray(data.messages)) throw new ApiError('server', 'bad_shape');
  const messages = data.messages.filter(isObj).flatMap((m): (HistoryUser | HistoryAssistant)[] => {
    if (m.role === 'user') return [{ id: str(m.id), role: 'user', run_id: str(m.run_id), content: str(m.content), created_at: str(m.created_at), files: list(m.files).map(toFile) }];
    if (m.role !== 'assistant') return [];
    const parts = Array.isArray(m.parts) ? m.parts.filter(isObj).map(toPart).filter((p): p is HistoryPart => p !== null) : [];
    return [{
      id: str(m.id), role: 'assistant', run_id: str(m.run_id), content: str(m.content),
      reasoning: strOrNull(m.reasoning),
      parts: parts.length ? parts : [{ type: 'text', text: str(m.content) }],
      model: str(m.model), model_label: str(m.model_label, str(m.model)), provider: str(m.provider, 'other'),
      provider_label: str(m.provider_label), reasoning_level: reasoningOf(m.reasoning_level),
      duration_ms: num(m.duration_ms), usage: toUsage(m.usage), created_at: str(m.created_at),
      resumed: m.resumed === true, pending: list(m.pending).map(toPending).filter((x): x is PendingCall => x !== null),
    }];
  });
  return {
    ...toThreadScope(data), id: str(data.id, id), title: str(data.title), created_at: str(data.created_at), updated_at: str(data.updated_at),
    path: toScopePath(data.path), messages,
  };
}

// AG-UI 이벤트 (필요한 칸만 읽는다. 모르는 type 은 그냥 지나간다)
export type AgUiEvent = { type: string } & Record<string, unknown>;

// 한 번 실행 (run). 이벤트마다 onEvent. RUN_FINISHED 면 끝, RUN_ERROR 면 ApiError, 끝 신호 없이 닫히면 'cut'.
// 서버가 대화 기록의 원본이라 이번 질문(마지막 user 메시지)만 보낸다. runId 는 시도마다 새로, threadId 는 대화마다 하나.
export async function runChat(opts: {
  threadId: string;
  runId: string;
  text: string;
  resume?: string | null; // 앱 연결 뒤 이어서 하기 = 멈춘 호출 id (질문 없이 · 서버가 그 호출을 다시 계산한다)
  model?: string;
  reasoning: Reasoning;
  spaceId: string | null; // 새 대화만 쓰인다 (있는 대화는 서버가 기록에서 정한다)
  projectId: string | null;
  files?: string[]; // 이번 턴 첨부 id (PUT /api/files 로 올린 것 · 서버가 내 것인지 · 모델에 어떻게 갈지 정한다)
  signal: AbortSignal;
  onEvent: (ev: AgUiEvent) => void;
}): Promise<void> {
  const body = {
    threadId: opts.threadId,
    runId: opts.runId,
    state: {},
    messages: opts.resume ? [] : [{ id: `${opts.runId}:user`, role: 'user', content: opts.text }],
    tools: [], // 툴은 conductor 가 갖는다 (승인·정책). 프런트 툴은 서버가 400
    context: [],
    forwardedProps: {
      ...(opts.model ? { model: opts.model } : {}),
      reasoning: opts.reasoning,
      ...(opts.spaceId ? { spaceId: opts.spaceId } : {}),
      ...(opts.projectId ? { projectId: opts.projectId } : {}),
      ...(opts.resume ? { resume: { call_id: opts.resume } } : {}),
      ...(opts.files?.length ? { files: opts.files } : {}),
    },
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
        if (ev.type === 'RUN_ERROR') {
          const code = str(ev.code) || undefined;
          throw new ApiError(kindOf(code), code, str(ev.detail) || undefined); // message 는 안 쓴다 (code · detail → 화면 문구)
        }
        opts.onEvent(ev);
        if (ev.type === 'RUN_FINISHED') return;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
