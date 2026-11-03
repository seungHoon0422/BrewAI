// 대화 상태 = 앱 전체 store (화면 밖). 메뉴를 옮겨도 진행 중인 답은 계속 받고, 진행 상황 화면이 같은 상태를 실시간으로 본다.
// 대화(thread)마다 하나씩 들고 있고, 서버(conductor SQLite)가 기록의 원본이다 → 다시 열면 GET /api/threads/{id}.
// 보낼 모델 · 생각 깊이는 models/hooks.ts, 단계 이름표는 skills/hooks.ts, 어디에(스페이스 · 프로젝트) 는 scope/hooks.ts 에서 읽는다.
// 스페이스가 바뀌면 홈으로 돌아가고 최근 목록을 다시 읽는다 (watchScope).
// 앱 연결 (ADR-0013): 연결 필요 = 답 아래 카드 (model.ts AppCard) → 연결(main 의 시스템 브라우저 · connections/hooks) → 같은 대화에서
// '이어서 하기' (forwardedProps.resume · 질문 없이 · 서버가 멈춘 호출을 다시 계산). auto + auto_open = 묻지 않고 바로 브라우저.
import { useEffect, useState } from 'react';
import { ApiError, failureOf, isAbort, type Failure } from '../../lib/api';
import { titleOf } from '../../lib/format';
import { createStore, loading, type Loadable } from '../../lib/store';
import { currentMe } from '../auth/hooks';
import { appById, appLabels, cancelConnect, changeAutoAuth, connectApp, isReady, loadApps } from '../connections/hooks';
import { currentModel, currentReasoning, loadModels, pickReasoning } from '../models/hooks';
import { projectById } from '../projects/hooks';
import { currentProjectId, currentSpace, currentSpaceId, watchScope } from '../scope/hooks';
import { loadSkills, skillLabels, toolLabels } from '../skills/hooks';
import { getThread, listThreads, patchThread, pickScope, runChat, type HistoryAssistant, type ThreadScope, type ThreadSummary } from './api';
import { CONV_FALLBACK } from './copy';
import { apply, closeOpen, elapsed } from './events';
import { isLive, type Answer, type AppCard, type AuthCard, type Conv, type Part, type Turn } from './model';

export type ChatState = {
  convs: Record<string, Conv>;
  current: string | null; // null = 새 대화 (홈 · 또는 연 프로젝트 화면)
  threads: Loadable<ThreadSummary, Failure>; // 지금 스페이스의 대화
  runsVersion: number; // 실행이 끝날 때마다 +1 (진행 상황 화면이 다시 읽는다)
  nonce: number; // 새 대화를 누를 때마다 +1 (입력창을 비우고 다시 포커스)
};

const store = createStore<ChatState>({ convs: {}, current: null, threads: loading(), runsVersion: 0, nonce: 0 });
const set = store.set;
const runs = new Map<string, AbortController>(); // threadId → 진행 중인 실행
const idle = new Map<string, Promise<void>>(); // threadId → 진행 중인 실행이 끝나면 풀린다 (이어서 하기는 실행이 끝난 뒤에)

export const useChat = store.use;
export const useCurrentConv = () => store.use((s) => (s.current ? s.convs[s.current] : undefined));
export const useConvBusy = () => store.use((s) => convBusy(s, s.current));

const detailOf = (e: unknown): string | null => (e instanceof ApiError && e.detail ? e.detail : null);

// ── 최근 대화 (지금 스페이스) — 마지막 요청만 반영 (읽는 사이 스페이스가 바뀌면 앞 응답은 버린다) ──
let seq = 0;
export async function loadThreads() {
  const mine = ++seq;
  const space = currentSpaceId();
  try {
    const list = await listThreads({ space });
    if (mine === seq) set((s) => ({ ...s, threads: { status: 'ready', list, error: null } }));
  } catch (e) {
    if (mine === seq) set((s) => ({ ...s, threads: { ...s.threads, status: 'error', error: failureOf(e) } }));
  }
}

// 스페이스를 바꾸면: 홈으로 · 목록 다시 (다른 스페이스에서 진행 중인 답은 끊지 않는다)
watchScope((s) => s.spaceId, () => {
  set((s) => ({ ...s, current: null, threads: loading(), nonce: s.nonce + 1 }));
  void loadThreads();
});

export type RecentItem = { id: string; title: string; running: boolean; at: string; mine: boolean; owner: string | null; shared: boolean };
// 서버 목록(완료된 턴이 있는 대화) + 아직 서버에 없는 이 창의 새 대화(첫 답을 쓰는 중, 지금 스페이스 것만) — 새 것이 위
export function recents(s: Pick<ChatState, 'threads' | 'convs'>, spaceId: string | null): RecentItem[] {
  const out: RecentItem[] = [];
  const seen = new Set<string>();
  const live = (id: string) => s.convs[id]?.turns.some((t) => isLive(t.answer)) ?? false;
  for (const c of Object.values(s.convs)) {
    // 실패만 한 대화도 남긴다 (서버엔 없지만 이 창에서 다시 시도할 수 있다)
    if (c.load !== 'local' || !c.turns.length || c.scope.space_id !== spaceId || s.threads.list.some((t) => t.id === c.id)) continue;
    out.push({ id: c.id, title: c.title, running: live(c.id), at: new Date(c.turns[0].answer.startedAt).toISOString(), mine: true, owner: null, shared: false });
    seen.add(c.id);
  }
  out.sort((a, b) => b.at.localeCompare(a.at));
  for (const t of s.threads.list) {
    if (seen.has(t.id)) continue;
    out.push({ id: t.id, title: t.title, running: t.running || live(t.id), at: t.updated_at, mine: t.mine, owner: t.owner_name, shared: t.visibility === 'shared' });
  }
  return out;
}

// 한 프로젝트의 대화 (프로젝트 화면) — 실행이 끝나거나 최근 목록이 바뀌면 다시 읽는다
export function useThreadList(projectId: string) {
  const version = store.use((s) => s.runsVersion);
  const threads = store.use((s) => s.threads);
  const [state, setState] = useState<Loadable<ThreadSummary, Failure>>(loading);
  useEffect(() => {
    const ctrl = new AbortController();
    listThreads({ space: currentSpaceId(), project: projectId }, ctrl.signal).then(
      (list) => setState({ status: 'ready', list, error: null }),
      (e) => !isAbort(e) && setState((s) => ({ ...s, status: 'error', error: failureOf(e) })),
    );
    return () => ctrl.abort();
  }, [projectId, version, threads]);
  return state;
}

// ── 대화 열기 ──
export function newChat() {
  set((s) => ({ ...s, current: null, nonce: s.nonce + 1 }));
}

// 새 대화가 들어갈 곳 = 지금 스페이스 · 연 프로젝트. 경로는 그 프로젝트(없으면 스페이스)의 path
function freshScope(): { scope: ThreadScope; path: Conv['path'] } {
  const projectId = currentProjectId();
  const project = projectById(projectId);
  return {
    scope: { space_id: currentSpaceId(), project_id: project?.id ?? null, visibility: 'private', mine: true, owner_name: currentMe()?.display_name ?? null },
    path: project?.path ?? currentSpace()?.path ?? [],
  };
}

const UNKNOWN_SCOPE: ThreadScope = { space_id: null, project_id: null, visibility: 'private', mine: true, owner_name: null };

function historyAnswer(m: HistoryAssistant): Answer {
  const parts: Part[] = m.parts.map((p, i): Part => {
    if (p.type === 'reasoning') return { kind: 'reasoning', id: `${m.id}:r${i}`, text: p.text, live: false, ms: null, at: 0 };
    if (p.type === 'text') return { kind: 'text', id: `${m.id}:t${i}`, text: p.text };
    return {
      kind: 'tool', id: p.id || `${m.id}:tool${i}`, name: p.name, label: p.label, argsText: JSON.stringify(p.args ?? {}),
      args: p.args, result: p.result, status: p.status === 'running' ? 'done' : p.status, ms: null, at: 0, ready: null,
      batch: p.batch ?? -(i + 1), // 옛 기록(batch 없음) = 도구마다 따로
      ...(p.app ? { app: p.app } : {}),
      ...(p.team ? { agent: p.team.agent, role: p.team.role, label: p.team.role || p.label } : {}),
    };
  });
  // 팀원 = delegate 칸의 팀원 요약 (실시간 brewai.team_member · agent_step 과 같은 트리 · 시간은 없다)
  const team = m.parts.flatMap((p) => (p.type === 'tool' && p.team ? [p.team] : []));
  // 지금도 앱 연결을 기다리는 호출 = 카드 (기록에서 연 답은 자동으로 브라우저를 열지 않는다)
  const cards: AppCard[] = m.pending.map((w) => ({
    kind: 'auth', callId: w.call_id, server: w.server, mode: w.mode, reason: w.reason, autoOpen: false, scope: w.scope, write: w.write, label: w.label,
    phase: 'idle', error: null,
  }));
  return {
    runId: m.run_id, status: 'done', failure: null, failureDetail: null, parts, steps: [],
    model: { id: m.model, label: m.model_label, provider: m.provider, provider_label: m.provider_label },
    reasoning: m.reasoning_level, startedAt: 0, durationMs: m.duration_ms, usage: m.usage, fromHistory: true, cards,
    ...(team.length ? { team } : {}),
  };
}

export function openThread(id: string) {
  const known = store.get().convs[id];
  set((s) => ({ ...s, current: id }));
  if (known && (known.load === 'local' || known.load === 'ready' || known.load === 'loading')) return; // 이 창에서 쓰던 대화 = 메모리 그대로
  const title = store.get().threads.list.find((t) => t.id === id)?.title ?? known?.title ?? CONV_FALLBACK;
  const summary = store.get().threads.list.find((t) => t.id === id);
  set((s) => ({
    ...s,
    convs: {
      ...s.convs,
      [id]: {
        id, title, path: known?.path ?? summary?.path ?? [], scope: known?.scope ?? summary ?? UNKNOWN_SCOPE,
        turns: known?.turns ?? [], load: 'loading', loadError: null,
      },
    },
  }));
  getThread(id).then(
    (t) => {
      const turns: Turn[] = [];
      for (let i = 0; i < t.messages.length; i++) {
        const m = t.messages[i];
        if (m.role === 'assistant' && m.resumed) { // 앱 연결 뒤 이어서 하기 = 질문 없이 답만
          turns.push({ id: m.run_id || m.id, ask: '', answer: historyAnswer(m), resumed: true });
          continue;
        }
        if (m.role !== 'user') continue;
        const a = t.messages[i + 1];
        if (a?.role !== 'assistant') continue;
        turns.push({ id: m.run_id || m.id, ask: m.content, answer: historyAnswer(a) });
        i++;
      }
      set((s) => {
        // 불러오는 사이 이 창에서 보낸 턴이 있으면 뒤에 붙인다
        const extra = (s.convs[id]?.turns ?? []).filter((x) => !turns.some((y) => y.answer.runId === x.answer.runId));
        const scope = pickScope(t);
        return { ...s, convs: { ...s.convs, [id]: { id, title: t.title || title, path: t.path, scope, turns: [...turns, ...extra], load: 'ready', loadError: null } } };
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
export const convBusy = (s: ChatState, id: string | null) => (id ? s.convs[id]?.turns.some((t) => isLive(t.answer)) ?? false : false);

function freshAnswer(): Answer {
  const m = currentModel();
  return {
    runId: crypto.randomUUID(), status: 'sending', failure: null, failureDetail: null, parts: [], steps: [],
    model: m ? { id: m.id, label: m.label, provider: m.provider, provider_label: m.provider_label } : null,
    reasoning: currentReasoning(), startedAt: Date.now(), durationMs: null, usage: null, fromHistory: false, cards: [],
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
  const state = store.get();
  if (!ask || convBusy(state, state.current)) return false;
  if (state.current && state.convs[state.current]?.load === 'loading') return false; // 기록을 다 읽은 뒤에
  const id = state.current ?? crypto.randomUUID();
  const answer = freshAnswer();
  set((s) => {
    const c: Conv = s.convs[id] ?? { id, title: titleOf(ask), ...freshScope(), turns: [], load: 'local', loadError: null };
    const turn: Turn = { id: answer.runId, ask, answer };
    return { ...s, current: id, convs: { ...s.convs, [id]: { ...c, turns: [...c.turns, turn] } } };
  });
  void start(id, answer);
  return true;
}

// 마지막 질문을 같은 글로 다시 (새 runId). 실패·멈춘 실행은 서버 기록에 안 들어가서 깨끗하다
export function retry(threadId: string) {
  const c = store.get().convs[threadId];
  const last = c?.turns.at(-1);
  if (!c || !last || isLive(last.answer)) return;
  const answer = freshAnswer();
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

const labels = () => ({ tools: toolLabels(), skills: skillLabels(), apps: appLabels() });

// 이어서 하기 실패 code 는 화면 문구로 (copy.ts DETAIL) — 409 를 '보관됐거나 옮겨진 곳' 으로 보이지 않게
const RESUME_CODES = new Set(['app_not_connected', 'nothing_to_resume']);

async function start(threadId: string, answer: Answer) {
  const ctrl = new AbortController();
  runs.set(threadId, ctrl);
  let release = () => {};
  idle.set(threadId, new Promise<void>((resolve) => { release = resolve; }));
  const turn = store.get().convs[threadId].turns.find((t) => t.answer.runId === answer.runId)!;
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        await runChat({
          threadId,
          runId: answer.runId, // 409 면 서버가 이 runId 를 받지 않았다 → 같은 값으로 다시
          text: turn.ask,
          resume: turn.resume ?? null,
          model: answer.model?.id,
          reasoning: answer.reasoning,
          spaceId: store.get().convs[threadId].scope.space_id,
          projectId: store.get().convs[threadId].scope.project_id,
          signal: ctrl.signal,
          onEvent: (ev) => {
            patchAnswer(threadId, answer.runId, (a) => apply(a, ev, labels));
            autoOpen(threadId, answer.runId, ev);
          },
        });
        break;
      } catch (e) {
        const justStopped = Date.now() - (stoppedAt.get(threadId) ?? 0) < BUSY_WAIT_MS * BUSY_TRIES + 2000;
        if (!(e instanceof ApiError && e.kind === 'busy' && justStopped && attempt < BUSY_TRIES)) throw e;
        await wait(BUSY_WAIT_MS, ctrl.signal);
      }
    }
    patchAnswer(threadId, answer.runId, (a) => ({
      ...closeOpen(a, 'cancelled'), status: 'done', durationMs: a.durationMs ?? elapsed(a),
    }));
  } catch (e) {
    const stopped = isAbort(e) || ctrl.signal.aborted;
    const failure = stopped ? null : failureOf(e);
    const code = e instanceof ApiError ? e.code : undefined;
    const failureDetail = stopped ? null : detailOf(e) ?? (code && RESUME_CODES.has(code) ? code : null);
    patchAnswer(threadId, answer.runId, (a) => ({
      ...closeOpen(a, stopped ? 'cancelled' : 'error'),
      status: stopped ? 'stopped' : 'failed', failure, failureDetail, durationMs: elapsed(a),
    }));
    if (failure === 'model_gone' || failure === 'no_models') void loadModels(); // 숨겨진 모델 → 목록 새로
  } finally {
    if (runs.get(threadId) === ctrl) runs.delete(threadId);
    release();
    void loadThreads();
    void loadSkills(); // 사용 횟수
    set((s) => ({ ...s, runsVersion: s.runsVersion + 1 }));
  }
}

// ── 대화 바꾸기 (공유 · 프로젝트 옮기기 · 제목) — 만든 사람만. 실패 = ApiError 를 던진다 ──
export async function updateThread(id: string, patch: Parameters<typeof patchThread>[1]) {
  const t = await patchThread(id, patch);
  set((s) => {
    const c = s.convs[id];
    const scope = pickScope(t);
    return {
      ...s,
      convs: c ? { ...s.convs, [id]: { ...c, title: t.title || c.title, path: t.path, scope } } : s.convs,
      threads: { ...s.threads, list: s.threads.list.map((x) => (x.id === id ? { ...x, ...t } : x)) },
    };
  });
}

// ── 앱 연결 카드 (ADR-0013 · slice 05 카드 A~D) ──
// 판정은 서버가 한다: 카드는 연결(시스템 브라우저)을 돕고, 끝나면 '이어서 하기' 를 보낸다 (서버가 멈춘 호출을 다시 계산 · UI 는 근거 아님)

function patchCard(threadId: string, runId: string, callId: string, fn: (c: AuthCard) => AuthCard) {
  patchAnswer(threadId, runId, (a) => {
    let changed = false;
    const cards = a.cards.map((c) => {
      if (c.kind !== 'auth' || c.callId !== callId) return c;
      const next = fn(c);
      if (next !== c) changed = true;
      return next;
    });
    return changed ? { ...a, cards } : a;
  });
}

const cardOf = (threadId: string, runId: string, callId: string): AuthCard | null => {
  const t = store.get().convs[threadId]?.turns.find((x) => x.answer.runId === runId);
  const c = t?.answer.cards.find((x) => x.kind === 'auth' && x.callId === callId);
  return c?.kind === 'auth' ? c : null;
};

// 이 답이 대화의 마지막 턴인가 (이어서 하기는 마지막 실행이 그 호출로 멈췄을 때만 된다 · 아니면 서버가 409 nothing_to_resume)
export const isLastTurn = (threadId: string, runId: string) => store.get().convs[threadId]?.turns.at(-1)?.answer.runId === runId;

// auto + auto_open = 묻지 않고 바로 로그인 화면 (실행당 1번 · 시간당 3번 = 서버가 정해 auto_open 으로 준다)
function autoOpen(threadId: string, runId: string, ev: { type: string } & Record<string, unknown>) {
  if (ev.type !== 'CUSTOM' || ev.name !== 'brewai.app_auth') return;
  void loadApps(); // 연결 상태를 서버 값으로 (다른 곳에서 끊겼을 수 있다 · 카드 C 의 [이어서 하기] 가 낡은 값을 보지 않게)
  const v = (ev.value ?? {}) as Record<string, unknown>;
  if (v.mode === 'auto' && v.auto_open === true && typeof v.call_id === 'string') void connectCard(threadId, runId, v.call_id);
}

// 연결 → 성공이면 이어서 하기. 실패 = 카드에 이유 (그만두기 = stopped)
// 쓰기 도구가 기다리던 호출 = 저절로 잇지 않는다: 카드가 할 일(도구 · 인자)을 보이고 사람이 [이어서 하기] 를 누른다
// (앱 결과에 숨은 지시로 고른 쓰기일 수 있다 · 승인 카드는 slice 07)
export async function connectCard(threadId: string, runId: string, callId: string) {
  const card = cardOf(threadId, runId, callId);
  if (!card || card.phase === 'opening' || card.phase === 'resuming') return;
  patchCard(threadId, runId, callId, (c) => ({ ...c, phase: 'opening', error: null }));
  const r = await connectApp(card.server.id, card.reason === 'insufficient_scope' ? card.scope : null);
  if (!r.ok) {
    patchCard(threadId, runId, callId, (c) => (c.phase !== 'opening' ? c
      : r.code === 'cancelled' ? { ...c, phase: 'stopped' } : { ...c, phase: 'failed', error: r.code }));
    return;
  }
  if (card.write) {
    patchCard(threadId, runId, callId, (c) => (c.phase === 'opening' ? { ...c, phase: 'idle' } : c));
    return;
  }
  await resumeCard(threadId, runId, callId);
}

// A [켜고 로그인] = 다음부터 묻지 않음(on) + 바로 브라우저
export async function approveCard(threadId: string, runId: string, callId: string) {
  await changeAutoAuth('on').catch(() => undefined); // 설정 저장이 실패해도 이번 연결은 한다
  await connectCard(threadId, runId, callId);
}

// A [설정에서 할게요] = off + 카드 C
export async function declineCard(threadId: string, runId: string, callId: string) {
  await changeAutoAuth('off').catch(() => undefined);
  patchCard(threadId, runId, callId, (c) => ({ ...c, mode: 'manual', phase: 'idle', error: null }));
}

// B [그만두기] = 브라우저 로그인 흐름을 닫는다 (main 의 loopback) → stopped
export async function cancelCard(threadId: string, runId: string, callId: string) {
  patchCard(threadId, runId, callId, (c) => (c.phase === 'opening' ? { ...c, phase: 'stopped' } : c));
  await cancelConnect();
}

// 이어서 하기 = 질문 없는 새 턴 (forwardedProps.resume). 앞 실행이 끝난 뒤에 보낸다. 끝나면 카드를 접고 기다리던 도구 칸을 닫는다
export async function resumeCard(threadId: string, runId: string, callId: string) {
  await idle.get(threadId);
  if (!isLastTurn(threadId, runId)) {
    patchCard(threadId, runId, callId, (c) => ({ ...c, phase: 'failed', error: 'nothing_to_resume' }));
    return;
  }
  patchCard(threadId, runId, callId, (c) => ({ ...c, phase: 'resuming', error: null }));
  const answer = freshAnswer();
  set((s) => {
    const c = s.convs[threadId];
    if (!c) return s;
    const turn: Turn = { id: answer.runId, ask: '', answer, resumed: true, resume: callId };
    return { ...s, convs: { ...s.convs, [threadId]: { ...c, turns: [...c.turns, turn] } } };
  });
  await start(threadId, answer);
  const done = store.get().convs[threadId]?.turns.find((t) => t.answer.runId === answer.runId)?.answer.status === 'done';
  patchCard(threadId, runId, callId, (c) => (c.phase === 'resuming' ? { ...c, phase: done ? 'done' : 'failed', error: done ? null : 'resume_failed' } : c));
  if (done) {
    patchAnswer(threadId, runId, (a) => ({ ...a, parts: a.parts.map((p) => (p.kind === 'tool' && p.id === callId && p.status === 'waiting' ? { ...p, status: 'done' } : p)) }));
  }
  void loadApps();
}

// 카드 C: 연결된 앱에서 연결을 마쳤다 = [이어서 하기] 를 보여 준다
export const cardReady = (c: AuthCard) => isReady(appById(c.server.id));
