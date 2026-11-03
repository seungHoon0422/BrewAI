// 생각 · 도구 상태 줄 한 칸 = 단계 훅(data-step) · 국면(data-phase) · 모양(kind) · 글. 진행 상황 화면도 같은 문구를 쓴다.
// 답 상태 → 글 조각 (문구는 copy.ts). 결정적 — 상태로만 고른다.
// 끝난 줄 = 조각 여럿 ('3.2초 동안 생각함' · 'Exa 웹 검색 2회' · '1.4초'). 화면은 조각마다 칸을 나누고(가운뎃점 없음), text = 쉼표로 이은 한 줄.
// 흐르는 줄 모양 (kind): waiting = 첫 이벤트 전 (점 셋) · thinking = 생각하는 중 (반짝임 + 글 위로 빛) · busy = 도구 · 팀 · 답 쓰기 (도구 · 팀 문구가 먼저)
import { seconds } from '../../lib/format';
import { READING_RESULT, TEAM, THINKING_PHRASE, TRACE, WAITING_PHRASE, joinParts, parallelPhrase, stepPhrase } from './copy';
import { isLive, type Answer, type MemberStep, type ReasoningPart, type TeamMember, type ToolPart } from './model';

export type TracePhase = 'live' | 'done' | 'stopped';
export type TraceKind = 'waiting' | 'thinking' | 'busy' | 'done' | 'stopped';
// meta = 줄 끝 작은 글 (생각 글 없이 토큰만 온 답의 '생각 토큰 N') · text 에도 이어 붙인다 (화면 읽기 = 보이는 글 그대로)
export type Trace = { step: string; phase: TracePhase; kind: TraceKind; parts: string[]; meta: string[]; text: string };

const isTool = (p: Answer['parts'][number]): p is ToolPart => p.kind === 'tool';
const isReasoning = (p: Answer['parts'][number]): p is ReasoningPart => p.kind === 'reasoning';
const MIN_THINK_MS = 100; // 이보다 짧으면 시간을 쓰지 않는다 ('0.0초 동안 생각함' 금지)

// 생각 글이 실제로 온 조각 (빈 생각 조각 = 시작 · 끝 신호만 온 것)
export const thoughtParts = (a: Answer) => a.parts.filter((p): p is ReasoningPart => isReasoning(p) && (p.live || p.text.trim() !== ''));
const hasThoughtText = (a: Answer) => a.parts.some((p) => isReasoning(p) && p.text.trim() !== '');
// 생각을 했나 = 생각 글이 왔거나, 글은 없어도 생각 토큰이 있다
export const thought = (a: Answer) => hasThoughtText(a) || (a.usage?.reasoning_tokens ?? 0) > 0;
export const usedTools = (a: Answer) => a.parts.some(isTool);
// 패널에 그릴 것이 있나 = 생각 글 · 도구 카드. 끝난 답에 없으면 줄을 펼치지 않는다 (빈 패널 · '생각 내용을 안 보냄' 한 줄 없음)
export const hasPanel = (a: Answer) => thoughtParts(a).length > 0 || usedTools(a);
// 생각 깊이를 켰는데 모델이 생각 없이 바로 답했다 (adaptive 모델이 쉬운 질문에서 건너뜀 · 생각 토큰 0) = 고장이 아니라 모델의 선택
export const skippedThinking = (a: Answer) =>
  a.status === 'done' && a.reasoning !== 'off' && !thought(a) && a.usage?.reasoning_tokens === 0;

// 앱 도구 고르기(use_app) = 실제 일이 아니라 준비 단계 (패널엔 한 줄 메모 · 횟수엔 안 센다)
export const isAppPick = (p: ToolPart) => p.name === 'use_app';

// ── 에이전트 팀 (slice 06) ──
// 팀원에게 맡기기(delegate) = 도구가 아니라 팀원 하나 (횟수엔 안 센다 · 팀원이 쓴 도구를 센다)
export const isDelegate = (p: ToolPart) => p.name === 'delegate';
const MEMBER_FINAL = new Set(['done', 'error', 'cancelled']);
export const memberDone = (m: TeamMember) => MEMBER_FINAL.has(m.status);
// 팀원이 스스로 실패했나 (서버 끝 이벤트 · 기록엔 code 가 있다) · code 없는 error = 실행 전체가 끊겨 화면이 닫은 것 (closeOpen) = 팀원 탓이 아니다
export const memberFailed = (m: TeamMember) => m.status === 'error' && m.code != null;
// 이 답의 팀원 (거절된 호출 = 팀원이 아니다: 한 명뿐 team_too_small · 자리 없음 team_full)
export const teamOf = (a: Answer): TeamMember[] => (a.team ?? []).filter((m) => !m.code?.startsWith('team_'));
// 팀이 생겼나 = 거절되지 않은 팀원이 하나라도 시작했다 (패널을 저절로 여는 때 · 머리 토글 · '오른쪽에서 보기').
// 맡기는 중(delegate 인자 받는 중)은 아직 아니다 = 한 명뿐 · 자리 없음으로 거절되면 패널이 열렸다 닫히며 화면이 튄다 (상태 줄 teamPhrase 만 '팀을 꾸리는 중')
export const hasTeam = (a: Answer) => teamOf(a).length > 0;
// 팀원 도구 줄: 앱 고르기(app:) = 준비 · 앱 도구(tool:) = 횟수에 센다
export const isMemberPick = (s: MemberStep) => s.name.startsWith('app:');
// 팀원 도구 줄의 앱 이름 = 이름표 '<앱>: <도구>' 앞 (서버가 붙인 이름 · 없으면 handle)
export const memberAppName = (s: MemberStep) => (s.label.includes(': ') ? s.label.slice(0, s.label.indexOf(': ')) : s.app ?? '');
// 도구 쓴 횟수 조각: ['스킬 사용 1회'] · ['Exa 웹 검색 2회'] (앱 도구는 앱 이름으로 묶는다) · 세 종류 이상이면 ['도구 3회']
// 앱 도구를 고르기만 하고 끝난 답(연결 기다림 등) = ['Exa 웹 검색 연결'] · 고르기가 실패 · 취소로만 끝남 = ['Exa 웹 검색 연결 못 함']
const linked = (p: ToolPart) => {
  const r = p.result;
  return p.status === 'waiting' || (p.status === 'done' && !(typeof r === 'object' && r !== null && 'error' in r));
};
export function toolTally(a: Answer, tools: Record<string, string> = {}): string[] {
  const all = a.parts.filter((p): p is ToolPart => isTool(p) && !isDelegate(p));
  const used = all.filter((p) => !isAppPick(p));
  // 팀원이 쓴 앱 도구도 센다 (앱 이름으로 묶는다 · 앱 고르기는 안 센다)
  const memberUsed = teamOf(a).flatMap((m) => m.steps.filter((st) => !isMemberPick(st)));
  if (memberUsed.length) {
    const counts = new Map<string, number>();
    for (const p of used) {
      const label = p.app?.name || (tools[p.name] ?? p.label ?? p.name);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    for (const st of memberUsed) {
      const label = st.app ? memberAppName(st) || st.label : st.label;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    const n = used.length + memberUsed.length;
    if (counts.size > 2) return [TRACE.toolsMany(n)];
    return [...counts].map(([label, k]) => TRACE.toolCount(label, k));
  }
  if (!used.length) {
    if (!all.length) return [];
    const ok = all.filter(linked);
    const name = (ok.length ? ok : all).findLast((p) => p.app?.name)?.app?.name ?? null;
    return [ok.length ? TRACE.appLinked(name) : TRACE.appMissed(name)];
  }
  const counts = new Map<string, number>();
  for (const p of used) {
    const label = p.app?.name || (tools[p.name] ?? p.label ?? p.name);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  if (counts.size > 2) return [TRACE.toolsMany(used.length)];
  return [...counts].map(([label, n]) => TRACE.toolCount(label, n));
}

// 생각한 시간 = 생각 글이 흐른 시간 → 없으면 'thinking' 단계 시간. 너무 짧거나 모르면 null (전체 실행 시간은 생각 시간이 아니다)
function thinkMs(a: Answer): number | null {
  const sum = (xs: (number | null)[]) => xs.reduce<number | null>((t, x) => (x == null ? t : (t ?? 0) + x), null);
  const ms = sum(a.parts.filter((p) => isReasoning(p) && p.text.trim() !== '').map((p) => (p as ReasoningPart).ms))
    ?? sum(a.steps.filter((st) => st.name === 'thinking').map((st) => st.duration_ms));
  return ms != null && ms >= MIN_THINK_MS ? ms : null;
}

// 끝난 답의 요약 조각. 아무것도 없으면 [] (트레이스 줄을 안 그린다)
export function doneSummary(a: Answer, tools: Record<string, string> = {}): string[] {
  const n = teamOf(a).length;
  const tally = [...(n ? [TEAM.chip(n)] : []), ...toolTally(a, tools)]; // 팀 = '팀원 2명' 이 맨 앞
  const took = a.fromHistory ? '' : seconds(a.durationMs);
  if (thought(a)) {
    // 생각 글이 없으면(토큰만) 시간 없이 '생각함'
    const ms = hasThoughtText(a) ? thinkMs(a) : null;
    return [TRACE.thought(seconds(ms)), ...tally];
  }
  if (skippedThinking(a)) return [TRACE.noThink, ...tally, took].filter(Boolean);
  if (tally.length) return [...tally, took].filter(Boolean);
  return [];
}

// 끝난 답의 작은 글: 생각 글 없이 토큰만 = '생각 토큰 N' (N 을 모르면 없음)
export function doneMeta(a: Answer): string[] {
  const n = a.usage?.reasoning_tokens ?? 0;
  return a.status === 'done' && !hasThoughtText(a) && n > 0 ? [TRACE.thinkTokens(n)] : [];
}

const one = (step: string, phase: TracePhase, text: string, kind: TraceKind = 'busy'): Trace => ({ step, phase, kind, parts: [text], meta: [], text });
const stepKind = (name: string): TraceKind => (name === 'thinking' ? 'thinking' : 'busy');

// 첫 단계 전: 생각을 켠 실행이 시작됐고(brewai.run) 답 글이 아직 없다 = 생각하는 중 (생각 글을 안 보내는 모델도 이 동안 생각한다)
// 그 밖 (보내는 중 · 생각 끄기) = 응답을 기다리는 중
function beforeSteps(a: Answer): Trace {
  const streaming = a.parts.some((p) => isReasoning(p) && p.live);
  const wrote = a.parts.some((p) => p.kind === 'text' && p.text !== '');
  if (streaming || (a.status === 'running' && a.reasoning !== 'off' && !wrote)) return one('waiting', 'live', THINKING_PHRASE, 'thinking');
  return one('waiting', 'live', WAITING_PHRASE, 'waiting');
}

export function tracePhrase(a: Answer, tools: Record<string, string>, skills: Record<string, string> = {}): Trace {
  if (!isLive(a)) {
    const done = a.status === 'done';
    const parts = done ? doneSummary(a, tools) : [TRACE.stopped, seconds(a.durationMs)].filter(Boolean);
    const meta = doneMeta(a);
    return { step: done ? 'done' : 'stopped', phase: done ? 'done' : 'stopped', kind: done ? 'done' : 'stopped', parts, meta, text: joinParts([...parts, ...meta]) };
  }
  const step = a.steps.findLast((s) => s.status === 'running');
  // 팀: 맡기는 중 → 팀원 n명이 나눠서 하는 중 → 다 끝나고 총괄이 읽는 중 (답을 쓰기 시작하면 평소처럼)
  const team = teamPhrase(a, step?.name ?? null);
  if (team) return team;
  // 한 응답의 도구 여럿이 동시에 도는 중 = '도구 n개를 동시에 쓰는 중' (단계 훅은 마지막에 연 단계 그대로)
  const running = a.parts.filter((p) => isTool(p) && p.status === 'running').length;
  if (running > 1) return one(step?.name ?? 'tool:parallel', 'live', parallelPhrase(running));
  if (!step) {
    // 단계 사이 (앞 단계는 끝났고 다음 단계 전) = 앞 단계의 말을 이어 간다 (도구 뒤 = 결과를 읽는 중)
    const prev = a.steps.at(-1);
    if (!prev) return beforeSteps(a);
    if (prev.name.startsWith('tool:')) return one(prev.name, 'live', READING_RESULT);
    return one(prev.name, 'live', stepPhrase(prev.name, tools, skills), stepKind(prev.name));
  }
  // 도구 결과가 이미 왔는데 다음 단계 전 = 모델이 결과를 읽는 중. 스킬은 지침을 읽는 동안 '펼치는 중' 그대로
  if (step.name.startsWith('tool:')) {
    const name = step.name.slice(5);
    const tool = a.parts.findLast((p): p is ToolPart => isTool(p) && p.name === name);
    if (tool && tool.status !== 'running') return one(step.name, 'live', READING_RESULT);
  }
  // MCP 앱 도구 = 단계 이름표('<앱>: <도구>')로 '… 쓰는 중'
  const named = step.name.startsWith('tool:') && step.label && !(step.name.slice(5) in tools) ? { ...tools, [step.name.slice(5)]: step.label } : tools;
  return one(step.name, 'live', stepPhrase(step.name, named, skills), stepKind(step.name));
}

function teamPhrase(a: Answer, running: string | null): Trace | null {
  if (running === 'writing') return null;
  const members = teamOf(a);
  const delegates = a.parts.filter((p): p is ToolPart => isTool(p) && isDelegate(p));
  const pending = delegates.some((p) => p.status === 'running' && !members.some((m) => m.callId === p.id));
  const step = running ?? a.steps.at(-1)?.name ?? 'team';
  if (members.some((m) => !memberDone(m))) return one(step, 'live', TEAM.working(members.length));
  if (pending) return one(step, 'live', TEAM.forming);
  // 이번 응답 묶음의 팀원이 다 끝났고 다음 단계 전 (또는 생각) = 총괄이 팀 결과를 읽는 중
  if (members.length && (running == null || running.startsWith('agent:') || running === 'thinking')) return one(step, 'live', TEAM.gathering);
  return null;
}

// 도구 묶음 (패널) — 같은 batch 가 이어진 도구들. 하나뿐이면 묶지 않는다
export type ToolGroup = { batch: number; tools: ToolPart[] };
// note = 앱 도구 고르기 (카드 대신 한 줄 메모 · 묶음에 안 넣는다) · team = 한 응답의 팀원에게 맡기기 (하나여도 팀 묶음)
export type PanelItem =
  | { kind: 'think'; part: ReasoningPart } | { kind: 'tool'; part: ToolPart } | { kind: 'note'; part: ToolPart } | { kind: 'group'; group: ToolGroup }
  | { kind: 'team'; group: ToolGroup };

export function panelItems(items: readonly (ReasoningPart | ToolPart)[]): PanelItem[] {
  const out: PanelItem[] = [];
  for (const p of items) {
    if (p.kind === 'reasoning') {
      out.push({ kind: 'think', part: p });
      continue;
    }
    if (isAppPick(p)) {
      out.push({ kind: 'note', part: p });
      continue;
    }
    const last = out.at(-1);
    if (isDelegate(p)) {
      if (last?.kind === 'team' && last.group.batch === p.batch) last.group.tools.push(p);
      else out.push({ kind: 'team', group: { batch: p.batch, tools: [p] } });
      continue;
    }
    if (last?.kind === 'group' && last.group.batch === p.batch) last.group.tools.push(p);
    else if (last?.kind === 'tool' && last.part.batch === p.batch) out[out.length - 1] = { kind: 'group', group: { batch: p.batch, tools: [last.part, p] } };
    else out.push({ kind: 'tool', part: p });
  }
  return out;
}

// 묶음 시간. 한 응답의 툴은 모델이 다 부른 뒤(마지막 TOOL_CALL_END = go) 한꺼번에 돈다 →
//   wall = go 부터 마지막 결과까지 (실제로 걸린 시간) · sum = 도구마다 go 부터 제 결과까지의 합 (하나씩 했으면) · done = 다 끝났다
// lanes = 도구마다 실행 막대: 모두 go 에서 같이 시작하고(왼쪽 끝이 같다) 길이 = 제 실행 시간 / wall. 모델이 인자를 쓰는 시간
//   (부르기 시작 ~ go)은 그리지 않는다 — 도구마다 엇갈려 '따로 시작한 것처럼' 보였다. 도는 중이면 now 까지. 기록에서 연 답(시간 없음) = null
// run = 도구마다 실행 시간(go ~ 제 결과) — 묶음 안 카드의 시간도 이것 (머리 줄 '실행' · '하나씩이면' 과 같은 뜻)
// lanes 는 다 끝났는데 wall 이 너무 짧으면(MIN_LANE_MS) 비운다 — 몇 ms 짜리 막대는 아무것도 말하지 않는다
export type Lane = { id: string; to: number; running: boolean };
export type GroupTiming = { wall: number; sum: number; done: boolean; lanes: Lane[]; run: Record<string, number> };
const MIN_LANE_MS = 150;
export function groupTiming(g: ToolGroup, now: number): GroupTiming | null {
  const t = g.tools;
  if (t.some((p) => p.at <= 0)) return null;
  const end = (p: ToolPart) => p.at + (p.ms ?? Math.max(0, now - p.at));
  const all = t.every((p) => p.ready != null);
  const go = all ? Math.max(...t.map((p) => p.ready ?? 0)) : now;
  const last = Math.max(...t.map(end));
  const run = (p: ToolPart) => Math.max(0, end(p) - go);
  const done = t.every((p) => p.status !== 'running' && p.ms != null);
  const wall = Math.max(0, last - go);
  const lanes = !all || (done && wall < MIN_LANE_MS) ? []
    : t.map((p) => ({ id: p.id, to: wall > 0 ? Math.min(1, run(p) / wall) : 0, running: p.status === 'running' }));
  return { wall, sum: t.reduce((n, p) => n + run(p), 0), done, lanes, run: Object.fromEntries(t.map((p) => [p.id, run(p)])) };
}

// 묶음 시간 글: 1초 아래는 ms ('0.0초' 대신)
export const shortDuration = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : seconds(ms));
