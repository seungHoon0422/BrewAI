// 대화 상태 = 앱 전체 store (화면 밖). 메뉴를 옮겨도 진행 중인 답은 계속 받고, 진행 상황 화면이 같은 상태를 실시간으로 본다.
// 대화(thread)마다 하나씩 들고 있고, 서버(conductor SQLite)가 기록의 원본이다 → 다시 열면 GET /api/threads/{id}.
// 라이브러리 없이 useSyncExternalStore. 상태는 바꿀 때마다 새 객체 (React 가 바뀐 곳만 다시 그린다).
import { useMemo, useSyncExternalStore } from 'react';
import {
  ApiError, getThread, listModels, listSkills, listThreads, listTools, runChat, toSteps, toUsage,
  type AgUiEvent, type Failure, type HistoryAssistant, type Model, type Reasoning, type SkillInfo, type Step, type ThreadSummary, type Usage,
} from '../api';
import { stepLabel, titleOf } from './text';

export type ModelTag = { id: string; label: string; provider: string; provider_label: string };

export type ReasoningPart = { kind: 'reasoning'; id: string; text: string; live: boolean; ms: number | null; at: number };
export type TextPart = { kind: 'text'; id: string; text: string };
export type ToolStatus = 'running' | 'done' | 'error' | 'cancelled';
export type ToolPart = {
  kind: 'tool'; id: string; name: string; label: string; argsText: string; args: unknown; result: unknown; status: ToolStatus; ms: number | null; at: number;
};
export type Part = ReasoningPart | TextPart | ToolPart;

// sending = 보냈고 RUN_STARTED 전 · running = 흐르는 중 · stopped = 사용자가 멈춤
export type AnswerStatus = 'sending' | 'running' | 'done' | 'failed' | 'stopped';
export type Answer = {
  runId: string;
  status: AnswerStatus;
  failure: Failure | null;
  failureDetail: string | null; // RUN_ERROR.detail (chat/text.ts DETAIL)
  parts: Part[];
  steps: Step[];
  model: ModelTag | null;
  reasoning: Reasoning;
  startedAt: number; // Date.now() (기록에서 연 답은 0)
  durationMs: number | null;
  usage: Usage;
  fromHistory: boolean;
};
export type Turn = { id: string; ask: string; answer: Answer };
export type Conv = { id: string; title: string; turns: Turn[]; load: 'local' | 'loading' | 'ready' | 'error'; loadError: Failure | null };

type Loadable<T> = { status: 'loading' | 'ready' | 'error'; list: T[]; error: Failure | null };
export type State = {
  models: Loadable<Model>;
  pickModel: string | null; // 사용자가 고른 모델 (null = 기본 모델)
  reasoning: Reasoning; // 사용자가 고른 생각 깊이 (모델이 지원할 때만 보낸다)
  modelNotice: string | null; // 고른 모델이 사라져 기본으로 돌아갔을 때 한 줄
  recentModels: string[]; // 최근 고른 모델 id (새 것이 앞 · 모델 메뉴 '최근 사용')
  tools: Record<string, string>; // 툴 이름 → 화면 이름
  skills: Loadable<SkillInfo>; // 제품 스킬 (스킬 메뉴 · skill:<이름> 단계 이름)
  convs: Record<string, Conv>;
  current: string | null; // null = 새 대화 (홈)
  threads: Loadable<ThreadSummary>;
  runsVersion: number; // 실행이 끝날 때마다 +1 (진행 상황 화면이 다시 읽는다)
};

// 이 기기의 선택만 기억한다 (모델 · 생각 깊이). 저장소가 막혀 있어도 화면은 그대로 돈다
const PREF_KEY = 'brewai.chat.prefs';
function readPrefs(): { model: string | null; reasoning: Reasoning } {
  try {
    const raw = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') as { model?: unknown; reasoning?: unknown };
    return {
      model: typeof raw.model === 'string' ? raw.model : null,
      reasoning: raw.reasoning === 'low' || raw.reasoning === 'high' ? raw.reasoning : 'off',
    };
  } catch {
    return { model: null, reasoning: 'off' };
  }
}
function writePrefs(s: State) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify({ model: s.pickModel, reasoning: s.reasoning }));
  } catch {}
}
const RECENT_KEY = 'brewai.chat.prefs.recent';
const RECENT_MAX = 5; // 메뉴엔 목록에 아직 있는 것 3개까지
function readRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}
function writeRecent(ids: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids));
  } catch {}
}

const prefs = readPrefs();
let state: State = {
  models: { status: 'loading', list: [], error: null },
  pickModel: prefs.model,
  reasoning: prefs.reasoning,
  modelNotice: null,
  recentModels: readRecent(),
  tools: {},
  skills: { status: 'loading', list: [], error: null },
  convs: {},
  current: null,
  threads: { status: 'loading', list: [], error: null },
  runsVersion: 0,
};
const listeners = new Set<() => void>();
const runs = new Map<string, AbortController>(); // threadId → 진행 중인 실행

function set(fn: (s: State) => State) {
  const next = fn(state);
  if (next === state) return;
  state = next;
  for (const l of listeners) l();
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const getState = () => state;
export function useSession<T>(pick: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => pick(state));
}

const failureOf = (e: unknown): Failure => (e instanceof ApiError ? e.kind : 'server');
const detailOf = (e: unknown): string | null => (e instanceof ApiError && e.detail ? e.detail : null);
const isAbort = (e: unknown) => (e as Error)?.name === 'AbortError';

// ── 모델 ──
export function effectiveModel(s: State): Model | null {
  const list = s.models.list;
  return list.find((m) => m.id === s.pickModel) ?? list.find((m) => m.is_default) ?? list[0] ?? null;
}
export const effectiveReasoning = (s: State): Reasoning => (effectiveModel(s)?.supports_reasoning ? s.reasoning : 'off');

let modelsLoading: Promise<void> | null = null;
export function loadModels(): Promise<void> {
  if (modelsLoading) return modelsLoading;
  set((s) => (s.models.list.length ? s : { ...s, models: { ...s.models, status: 'loading', error: null } }));
  modelsLoading = listModels().then(
    (list) =>
      set((s) => {
        // 고른 모델이 숨겨졌거나 사라졌으면 기본 모델로 (관리자가 숨기면 사용자 목록에서 사라진다 · P2-1)
        const gone = s.pickModel !== null && !list.some((m) => m.id === s.pickModel);
        const gonePick = gone ? s.models.list.find((m) => m.id === s.pickModel)?.label ?? null : null;
        const next: State = {
          ...s,
          models: { status: 'ready', list, error: null },
          pickModel: gone ? null : s.pickModel,
          modelNotice: gone && gonePick ? `${gonePick} 모델을 더 이상 쓸 수 없어서 기본 모델로 바꿨어요` : gone ? null : s.modelNotice,
        };
        if (gone) writePrefs(next);
        return next;
      }),
    (e) => set((s) => ({ ...s, models: { ...s.models, status: 'error', error: failureOf(e) } })),
  ).finally(() => {
    modelsLoading = null;
  });
  return modelsLoading;
}

export function pickModel(id: string) {
  set((s) => {
    const recentModels = [id, ...s.recentModels.filter((x) => x !== id)].slice(0, RECENT_MAX);
    const next = { ...s, pickModel: id, modelNotice: null, recentModels };
    writePrefs(next);
    writeRecent(recentModels);
    return next;
  });
}
export function pickReasoning(r: Reasoning) {
  set((s) => {
    const next = { ...s, reasoning: r };
    writePrefs(next);
    return next;
  });
}
export const clearModelNotice = () => set((s) => (s.modelNotice ? { ...s, modelNotice: null } : s));

let toolsLoaded = false;
export function loadTools() {
  if (toolsLoaded) return;
  toolsLoaded = true;
  listTools().then(
    (list) => set((s) => ({ ...s, tools: Object.fromEntries(list.map((t) => [t.name, t.label])) })),
    () => {
      toolsLoaded = false; // 다음에 다시
    },
  );
}

// 스킬 목록 = 스킬 메뉴 + 단계 이름. 실행이 끝날 때마다 다시 읽는다 (사용 횟수)
let skillsLoading: Promise<void> | null = null;
export function loadSkills(): Promise<void> {
  if (skillsLoading) return skillsLoading;
  skillsLoading = listSkills().then(
    (list) => set((s) => ({ ...s, skills: { status: 'ready', list, error: null } })),
    (e) => set((s) => ({ ...s, skills: { ...s.skills, status: 'error', error: failureOf(e) } })),
  ).finally(() => {
    skillsLoading = null;
  });
  return skillsLoading;
}
export const skillLabels = (s: State): Record<string, string> => Object.fromEntries(s.skills.list.map((k) => [k.name, k.label]));
// 화면용: 목록이 바뀔 때만 새 객체 (useSession 에 skillLabels 를 바로 주면 매번 새 객체 → 무한 다시 그리기)
export function useSkillLabels(): Record<string, string> {
  const list = useSession((s) => s.skills.list);
  return useMemo(() => Object.fromEntries(list.map((k) => [k.name, k.label])), [list]);
}

// 같은 표시 이름 (대소문자 · 공백 무시) 의 다른 모델이 목록에 있나 → 화면은 이름 옆에 게이트웨이 id 를 같이 보여 준다
// (config.yaml 모델과 LiteLLM 관리 화면 모델이 이름이 같을 때 · 모델 메뉴 · 입력창 버튼 · 답 아래 줄 · 진행 상황)
const labelKey = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/g, '');
export type DupCheck = (m: { id: string; label: string }) => boolean;
export function dupCheck(list: readonly Model[]): DupCheck {
  const ids = new Map<string, Set<string>>();
  for (const m of list) ids.set(labelKey(m.label), (ids.get(labelKey(m.label)) ?? new Set()).add(m.id));
  return (m) => [...(ids.get(labelKey(m.label)) ?? [])].some((id) => id !== m.id);
}
export function useDupCheck(): DupCheck {
  const list = useSession((s) => s.models.list);
  return useMemo(() => dupCheck(list), [list]);
}

// ── 최근 대화 ──
let threadsLoading: Promise<void> | null = null;
export function loadThreads(): Promise<void> {
  if (threadsLoading) return threadsLoading;
  threadsLoading = listThreads().then(
    (list) => set((s) => ({ ...s, threads: { status: 'ready', list, error: null } })),
    (e) => set((s) => ({ ...s, threads: { ...s.threads, status: 'error', error: failureOf(e) } })),
  ).finally(() => {
    threadsLoading = null;
  });
  return threadsLoading;
}

export type RecentItem = { id: string; title: string; running: boolean; at: string };
// 서버 목록(완료된 턴이 있는 대화) + 아직 서버에 없는 이 창의 새 대화(첫 답을 쓰는 중) — 새 것이 위
export function recents(s: State): RecentItem[] {
  const out: RecentItem[] = [];
  const seen = new Set<string>();
  const live = (id: string) => s.convs[id]?.turns.some((t) => isLive(t.answer)) ?? false;
  for (const c of Object.values(s.convs)) {
    // 실패만 한 대화도 남긴다 (서버엔 없지만 이 창에서 다시 시도할 수 있다)
    if (c.load !== 'local' || !c.turns.length || s.threads.list.some((t) => t.id === c.id)) continue;
    out.push({ id: c.id, title: c.title, running: live(c.id), at: new Date(c.turns[0].answer.startedAt).toISOString() });
    seen.add(c.id);
  }
  out.sort((a, b) => b.at.localeCompare(a.at));
  for (const t of s.threads.list) {
    if (seen.has(t.id)) continue;
    out.push({ id: t.id, title: t.title, running: t.running || live(t.id), at: t.updated_at });
  }
  return out;
}

// ── 대화 열기 ──
export function newChat() {
  set((s) => (s.current === null ? s : { ...s, current: null }));
}

function historyAnswer(m: HistoryAssistant): Answer {
  const parts: Part[] = m.parts.map((p, i): Part => {
    if (p.type === 'reasoning') return { kind: 'reasoning', id: `${m.id}:r${i}`, text: p.text, live: false, ms: null, at: 0 };
    if (p.type === 'text') return { kind: 'text', id: `${m.id}:t${i}`, text: p.text };
    return {
      kind: 'tool', id: p.id || `${m.id}:tool${i}`, name: p.name, label: p.label, argsText: JSON.stringify(p.args ?? {}),
      args: p.args, result: p.result, status: p.status === 'running' ? 'done' : p.status, ms: null, at: 0,
    };
  });
  return {
    runId: m.run_id, status: 'done', failure: null, failureDetail: null, parts, steps: [],
    model: { id: m.model, label: m.model_label, provider: m.provider, provider_label: m.provider_label },
    reasoning: m.reasoning_level, startedAt: 0, durationMs: m.duration_ms, usage: m.usage, fromHistory: true,
  };
}

export function openThread(id: string) {
  const known = state.convs[id];
  set((s) => ({ ...s, current: id }));
  if (known && (known.load === 'local' || known.load === 'ready' || known.load === 'loading')) return; // 이 창에서 쓰던 대화 = 메모리 그대로
  const title = state.threads.list.find((t) => t.id === id)?.title ?? known?.title ?? '대화';
  set((s) => ({ ...s, convs: { ...s.convs, [id]: { id, title, turns: known?.turns ?? [], load: 'loading', loadError: null } } }));
  getThread(id).then(
    (t) => {
      const turns: Turn[] = [];
      for (let i = 0; i < t.messages.length; i++) {
        const m = t.messages[i];
        if (m.role !== 'user') continue;
        const a = t.messages[i + 1];
        if (a?.role !== 'assistant') continue;
        turns.push({ id: m.run_id || m.id, ask: m.content, answer: historyAnswer(a) });
        i++;
      }
      set((s) => {
        // 불러오는 사이 이 창에서 보낸 턴이 있으면 뒤에 붙인다
        const extra = (s.convs[id]?.turns ?? []).filter((x) => !turns.some((y) => y.answer.runId === x.answer.runId));
        return { ...s, convs: { ...s.convs, [id]: { id, title: t.title || title, turns: [...turns, ...extra], load: 'ready', loadError: null } } };
      });
    },
    (e) => set((s) => ({ ...s, convs: { ...s.convs, [id]: { ...s.convs[id], load: 'error', loadError: failureOf(e) } } })),
  );
}
export const reloadThread = (id: string) => {
  set((s) => {
    if (!s.convs[id]) return s;
    const convs = { ...s.convs };
    delete convs[id];
    return { ...s, convs };
  });
  openThread(id);
};

// ── 보내기 · 다시 시도 · 멈추기 ──
export const isLive = (a: Answer) => a.status === 'sending' || a.status === 'running';
export const convBusy = (s: State, id: string | null) => (id ? s.convs[id]?.turns.some((t) => isLive(t.answer)) ?? false : false);

function freshAnswer(s: State): Answer {
  const m = effectiveModel(s);
  return {
    runId: crypto.randomUUID(), status: 'sending', failure: null, failureDetail: null, parts: [], steps: [],
    model: m ? { id: m.id, label: m.label, provider: m.provider, provider_label: m.provider_label } : null,
    reasoning: effectiveReasoning(s), startedAt: Date.now(), durationMs: null, usage: null, fromHistory: false,
  };
}

function patchAnswer(threadId: string, runId: string, fn: (a: Answer) => Answer) {
  set((s) => {
    const c = s.convs[threadId];
    const i = c?.turns.findIndex((t) => t.answer.runId === runId) ?? -1;
    if (!c || i < 0) return s;
    const turns = c.turns.slice();
    const a = fn(turns[i].answer);
    if (a === turns[i].answer) return s;
    turns[i] = { ...turns[i], answer: a };
    return { ...s, convs: { ...s.convs, [threadId]: { ...c, turns } } };
  });
}

export function send(text: string): boolean {
  const ask = text.trim();
  if (!ask || convBusy(state, state.current)) return false;
  if (state.current && state.convs[state.current]?.load === 'loading') return false; // 기록을 다 읽은 뒤에
  const id = state.current ?? crypto.randomUUID();
  const answer = freshAnswer(state);
  set((s) => {
    const c: Conv = s.convs[id] ?? { id, title: titleOf(ask), turns: [], load: 'local', loadError: null };
    const turn: Turn = { id: answer.runId, ask, answer };
    return { ...s, current: id, convs: { ...s.convs, [id]: { ...c, turns: [...c.turns, turn] } } };
  });
  void start(id, answer);
  return true;
}

// 마지막 질문을 같은 글로 다시 (새 runId). 실패·멈춘 실행은 서버 기록에 안 들어가서 깨끗하다
export function retry(threadId: string) {
  const c = state.convs[threadId];
  const last = c?.turns.at(-1);
  if (!c || !last || isLive(last.answer)) return;
  const answer = freshAnswer(state);
  set((s) => {
    const turns = c.turns.slice(0, -1).concat({ ...last, answer });
    return { ...s, convs: { ...s.convs, [threadId]: { ...s.convs[threadId], turns } } };
  });
  void start(threadId, answer);
}

// 생각(추론) 설정 때문에 거절됐을 때: 이 기기의 생각 깊이를 끄고 같은 질문을 다시
export function retryWithoutReasoning(threadId: string) {
  pickReasoning('off');
  retry(threadId);
}

// 멈춘 직후엔 서버가 아직 끊김을 모를 수 있다 (409 thread_busy) → 그 대화에 한해 잠깐 기다렸다 다시 보낸다
const stoppedAt = new Map<string, number>();
const BUSY_WAIT_MS = 300;
const BUSY_TRIES = 15; // 최대 ~4.5초

export function stop(threadId: string) {
  const ctrl = runs.get(threadId);
  if (!ctrl) return;
  stoppedAt.set(threadId, Date.now());
  ctrl.abort();
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('aborted', 'AbortError'));
    }, { once: true });
  });
}

const now = (a: Answer) => Date.now() - a.startedAt;

function closeOpen(a: Answer, status: 'error' | 'cancelled'): Answer {
  const t = now(a);
  return {
    ...a,
    steps: a.steps.map((st) => (st.status === 'running' ? { ...st, status, duration_ms: Math.max(0, t - st.started_ms) } : st)),
    parts: a.parts.map((p) =>
      p.kind === 'reasoning' && p.live ? { ...p, live: false, ms: Date.now() - p.at }
      : p.kind === 'tool' && p.status === 'running' ? { ...p, status: status === 'error' ? 'error' : 'cancelled' }
      : p),
  };
}

async function start(threadId: string, answer: Answer) {
  const ctrl = new AbortController();
  runs.set(threadId, ctrl);
  const turn = state.convs[threadId].turns.find((t) => t.answer.runId === answer.runId)!;
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        await runChat({
          threadId,
          runId: answer.runId, // 409 면 서버가 이 runId 를 받지 않았다 → 같은 값으로 다시
          text: turn.ask,
          model: answer.model?.id,
          reasoning: answer.reasoning,
          signal: ctrl.signal,
          onEvent: (ev) => patchAnswer(threadId, answer.runId, (a) => apply(a, ev)),
        });
        break;
      } catch (e) {
        const justStopped = Date.now() - (stoppedAt.get(threadId) ?? 0) < BUSY_WAIT_MS * BUSY_TRIES + 2000;
        if (!(e instanceof ApiError && e.kind === 'busy' && justStopped && attempt < BUSY_TRIES)) throw e;
        await wait(BUSY_WAIT_MS, ctrl.signal);
      }
    }
    patchAnswer(threadId, answer.runId, (a) => ({
      ...closeOpen(a, 'cancelled'), status: 'done', durationMs: a.durationMs ?? now(a),
    }));
  } catch (e) {
    const stopped = isAbort(e) || ctrl.signal.aborted;
    const failure = stopped ? null : failureOf(e);
    const failureDetail = stopped ? null : detailOf(e);
    patchAnswer(threadId, answer.runId, (a) => ({
      ...closeOpen(a, stopped ? 'cancelled' : 'error'),
      status: stopped ? 'stopped' : 'failed', failure, failureDetail, durationMs: now(a),
    }));
    if (failure === 'model_gone' || failure === 'no_models') void loadModels(); // 숨겨진 모델 → 목록 새로
  } finally {
    if (runs.get(threadId) === ctrl) runs.delete(threadId);
    void loadThreads();
    void loadSkills(); // 사용 횟수
    set((s) => ({ ...s, runsVersion: s.runsVersion + 1 }));
  }
}

const s_ = (v: unknown) => (typeof v === 'string' ? v : '');

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
const toolFailed = (r: unknown) => typeof r === 'object' && r !== null && 'error' in r;

// AG-UI 이벤트 하나 → 답 상태 (conductor agent.py 머리말의 순서)
function apply(a: Answer, ev: AgUiEvent): Answer {
  const at = Date.now();
  switch (ev.type) {
    case 'RUN_STARTED':
      return a.status === 'sending' ? { ...a, status: 'running' } : a;
    case 'CUSTOM': {
      const v = (ev.value ?? {}) as Record<string, unknown>;
      if (ev.name === 'brewai.run') {
        const r = v.reasoning;
        return {
          ...a,
          status: 'running',
          model: { id: s_(v.model) || a.model?.id || '', label: s_(v.model_label) || a.model?.label || s_(v.model), provider: s_(v.provider) || 'other', provider_label: s_(v.provider_label) },
          reasoning: r === 'low' || r === 'high' ? r : 'off',
        };
      }
      if (ev.name === 'brewai.run_summary') {
        const steps = toSteps(v.steps);
        return { ...a, steps: steps.length ? steps : a.steps, durationMs: typeof v.duration_ms === 'number' ? v.duration_ms : a.durationMs, usage: toUsage(v.usage) };
      }
      return a;
    }
    case 'STEP_STARTED': {
      const name = s_(ev.stepName);
      // 진행 중 단계의 이름표는 화면에서 다시 만든다 (툴 이름표가 늦게 와도 맞게)
      const label = stepLabel(name, state.tools, skillLabels(state));
      return { ...a, status: 'running', steps: [...a.steps, { name, label, status: 'running', started_ms: now(a), duration_ms: null }] };
    }
    case 'STEP_FINISHED': {
      const name = s_(ev.stepName);
      const i = a.steps.findLastIndex((st) => st.name === name && st.status === 'running');
      if (i < 0) return a;
      const steps = a.steps.slice();
      steps[i] = { ...steps[i], status: 'done', duration_ms: Math.max(0, now(a) - steps[i].started_ms) };
      return { ...a, steps };
    }
    case 'REASONING_START':
    case 'REASONING_MESSAGE_START':
    case 'THINKING_START': {
      const last = a.parts.at(-1);
      if (last?.kind === 'reasoning' && last.live) return a;
      return { ...a, parts: [...a.parts, { kind: 'reasoning', id: s_(ev.messageId) || `r${a.parts.length}`, text: '', live: true, ms: null, at }] };
    }
    case 'REASONING_MESSAGE_CONTENT':
    case 'THINKING_TEXT_MESSAGE_CONTENT': {
      const delta = s_(ev.delta);
      const i = a.parts.findLastIndex((p) => p.kind === 'reasoning' && p.live);
      if (!delta) return a;
      const parts = a.parts.slice();
      if (i < 0) parts.push({ kind: 'reasoning', id: s_(ev.messageId) || `r${parts.length}`, text: delta, live: true, ms: null, at });
      else parts[i] = { ...(parts[i] as ReasoningPart), text: (parts[i] as ReasoningPart).text + delta };
      return { ...a, parts };
    }
    case 'REASONING_END':
    case 'THINKING_END': {
      const parts = a.parts.map((p) => (p.kind === 'reasoning' && p.live ? { ...p, live: false, ms: at - p.at } : p));
      return { ...a, parts };
    }
    case 'TOOL_CALL_START': {
      const name = s_(ev.toolCallName);
      const id = s_(ev.toolCallId) || `tool${a.parts.length}`;
      if (a.parts.some((p) => p.kind === 'tool' && p.id === id)) return a;
      return { ...a, parts: [...a.parts, { kind: 'tool', id, name, label: state.tools[name] ?? name, argsText: '', args: undefined, result: undefined, status: 'running', ms: null, at }] };
    }
    case 'TOOL_CALL_ARGS':
    case 'TOOL_CALL_END':
    case 'TOOL_CALL_RESULT': {
      const id = s_(ev.toolCallId);
      const i = a.parts.findIndex((p) => p.kind === 'tool' && p.id === id);
      if (i < 0) return a;
      const p = a.parts[i] as ToolPart;
      const parts = a.parts.slice();
      if (ev.type === 'TOOL_CALL_ARGS') parts[i] = { ...p, argsText: p.argsText + s_(ev.delta) };
      else if (ev.type === 'TOOL_CALL_END') parts[i] = { ...p, args: parseJson(p.argsText || '{}') };
      else {
        const content = s_(ev.content);
        const result = parseJson(content) ?? content;
        parts[i] = { ...p, result, status: toolFailed(result) ? 'error' : 'done', ms: at - p.at, args: p.args ?? parseJson(p.argsText || '{}') };
      }
      return { ...a, parts };
    }
    case 'TEXT_MESSAGE_CONTENT': {
      const delta = s_(ev.delta);
      if (!delta) return a;
      const id = s_(ev.messageId);
      const last = a.parts.at(-1);
      const parts = a.parts.slice();
      if (last?.kind === 'text' && (last.id === id || !id)) parts[parts.length - 1] = { ...last, text: last.text + delta };
      else parts.push({ kind: 'text', id: id || `t${parts.length}`, text: delta });
      return { ...a, status: 'running', parts };
    }
    default:
      return a;
  }
}

// 앱 시작 때 한 번
export function boot() {
  void loadModels();
  void loadThreads();
  void loadSkills();
  loadTools();
}
