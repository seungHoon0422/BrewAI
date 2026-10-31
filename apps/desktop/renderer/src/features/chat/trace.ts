// 생각 · 도구 상태 줄 한 칸 = 단계 훅(data-step) · 국면(data-phase) · 글. 진행 상황 화면도 같은 문구를 쓴다.
// 답 상태 → 글 조각 (문구는 copy.ts). 결정적 — 시간과 상태로만 고른다.
// 끝난 줄 = 조각 여럿 ('3.2초 동안 생각함' · '계산기 1회' · '1.4초'). 화면은 조각마다 칸을 나누고(가운뎃점 없음), text = 쉼표로 이은 한 줄.
import { seconds } from '../../lib/format';
import { READING_RESULT, TRACE, WAITING_PHRASE, joinParts, parallelPhrase, stepPhrase } from './copy';
import { isLive, type Answer, type ReasoningPart, type ToolPart } from './model';

export type TracePhase = 'live' | 'done' | 'stopped';
export type Trace = { step: string; phase: TracePhase; parts: string[]; text: string };

const isTool = (p: Answer['parts'][number]): p is ToolPart => p.kind === 'tool';
const isReasoning = (p: Answer['parts'][number]): p is ReasoningPart => p.kind === 'reasoning';
const MIN_THINK_MS = 100; // 이보다 짧으면 시간을 쓰지 않는다 ('0.0초 동안 생각함' 금지)

// 생각 글이 실제로 온 조각 (빈 생각 조각 = 시작 · 끝 신호만 온 것)
export const thoughtParts = (a: Answer) => a.parts.filter((p): p is ReasoningPart => isReasoning(p) && (p.live || p.text.trim() !== ''));
const hasThoughtText = (a: Answer) => a.parts.some((p) => isReasoning(p) && p.text.trim() !== '');
// 생각을 했나 = 생각 글이 왔거나, 글은 없어도 생각 토큰이 있다
export const thought = (a: Answer) => hasThoughtText(a) || (a.usage?.reasoning_tokens ?? 0) > 0;
export const usedTools = (a: Answer) => a.parts.some(isTool);
// 생각 깊이를 켰는데 모델이 생각 없이 바로 답했다 (adaptive 모델이 쉬운 질문에서 건너뜀 · 생각 토큰 0) = 고장이 아니라 모델의 선택
export const skippedThinking = (a: Answer) =>
  a.status === 'done' && a.reasoning !== 'off' && !thought(a) && a.usage?.reasoning_tokens === 0;

// 도구 쓴 횟수 조각: ['계산기 1회'] · ['계산기 1회', '단위 변환 2회'] · 세 종류 이상이면 ['도구 3회']
export function toolTally(a: Answer, tools: Record<string, string> = {}): string[] {
  const used = a.parts.filter(isTool);
  if (!used.length) return [];
  const counts = new Map<string, number>();
  for (const p of used) {
    const label = tools[p.name] ?? p.label ?? p.name;
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
  const tally = toolTally(a, tools);
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

const one = (step: string, phase: TracePhase, text: string): Trace => ({ step, phase, parts: [text], text });

export function tracePhrase(a: Answer, now: number, tools: Record<string, string>, skills: Record<string, string> = {}): Trace {
  if (!isLive(a)) {
    const parts = a.status === 'done' ? doneSummary(a, tools) : [TRACE.stopped, seconds(a.durationMs)].filter(Boolean);
    return { step: a.status === 'done' ? 'done' : 'stopped', phase: a.status === 'done' ? 'done' : 'stopped', parts, text: joinParts(parts) };
  }
  const elapsed = now - a.startedAt;
  const step = a.steps.findLast((s) => s.status === 'running');
  // 한 응답의 도구 여럿이 동시에 도는 중 = '도구 n개를 동시에 쓰는 중' (단계 훅은 마지막에 연 단계 그대로)
  const running = a.parts.filter((p) => isTool(p) && p.status === 'running').length;
  if (running > 1) return one(step?.name ?? 'tool:parallel', 'live', parallelPhrase(running));
  if (!step) {
    // 단계 사이 (앞 단계는 끝났고 다음 단계 전) = 앞 단계의 말을 이어 간다 (도구 뒤 = 결과를 읽는 중)
    const prev = a.steps.at(-1);
    if (!prev) return one('waiting', 'live', WAITING_PHRASE);
    if (prev.name.startsWith('tool:')) return one(prev.name, 'live', READING_RESULT);
    return one(prev.name, 'live', stepPhrase(prev.name, prev.duration_ms ?? 0, tools, skills));
  }
  // 도구 결과가 이미 왔는데 다음 단계 전 = 모델이 결과를 읽는 중. 스킬은 지침을 읽는 동안 '펼치는 중' 그대로
  if (step.name.startsWith('tool:')) {
    const name = step.name.slice(5);
    const tool = a.parts.findLast((p): p is ToolPart => isTool(p) && p.name === name);
    if (tool && tool.status !== 'running') return one(step.name, 'live', READING_RESULT);
  }
  return one(step.name, 'live', stepPhrase(step.name, elapsed - step.started_ms, tools, skills));
}

// 도구 묶음 (패널) — 같은 batch 가 이어진 도구들. 하나뿐이면 묶지 않는다
export type ToolGroup = { batch: number; tools: ToolPart[] };
export type PanelItem = { kind: 'think'; part: ReasoningPart } | { kind: 'tool'; part: ToolPart } | { kind: 'group'; group: ToolGroup };

export function panelItems(items: readonly (ReasoningPart | ToolPart)[]): PanelItem[] {
  const out: PanelItem[] = [];
  for (const p of items) {
    if (p.kind === 'reasoning') {
      out.push({ kind: 'think', part: p });
      continue;
    }
    const last = out.at(-1);
    if (last?.kind === 'group' && last.group.batch === p.batch) last.group.tools.push(p);
    else if (last?.kind === 'tool' && last.part.batch === p.batch) out[out.length - 1] = { kind: 'group', group: { batch: p.batch, tools: [last.part, p] } };
    else out.push({ kind: 'tool', part: p });
  }
  return out;
}

// 묶음 시간. 한 응답의 툴은 모델이 다 부른 뒤(마지막 TOOL_CALL_END = go) 한꺼번에 돈다 →
//   wall = go 부터 마지막 결과까지 (실제로 걸린 시간) · sum = 도구마다 go 부터 제 결과까지의 합 (하나씩 했으면) · done = 다 끝났다
// lanes = 도구마다 [부르기 시작, go, 결과] 를 묶음 전체(첫 시작 ~ 마지막 결과)에 대한 비율로 — 앞 칸(모델이 부르는 중)은 엇갈리고
//   뒤 칸(실행)은 같은 자리에서 같이 시작한다 = 동시에 돌았다. 도는 중이면 now 까지. 기록에서 연 답(시간 없음) = null
// run = 도구마다 실행 시간(go ~ 제 결과) — 묶음 안 카드의 시간도 이것 (머리 줄 '실행' · '하나씩이면' 과 같은 뜻 · 모델이 인자를 쓰는 시간 빼고)
// lanes 는 실행이 전체의 1% 도 안 되면(내장 도구 몇 ms) 비운다 — 실행 칸이 안 보이는 막대는 아무것도 말하지 않는다
export type Lane = { id: string; from: number; go: number; to: number; running: boolean };
export type GroupTiming = { wall: number; sum: number; done: boolean; lanes: Lane[]; run: Record<string, number> };
const MIN_RUN_SHARE = 0.01;
export function groupTiming(g: ToolGroup, now: number): GroupTiming | null {
  const t = g.tools;
  if (t.some((p) => p.at <= 0)) return null;
  const end = (p: ToolPart) => p.at + (p.ms ?? Math.max(0, now - p.at));
  const start = Math.min(...t.map((p) => p.at));
  const all = t.every((p) => p.ready != null);
  const go = all ? Math.max(...t.map((p) => p.ready ?? 0)) : now;
  const last = Math.max(...t.map(end));
  const span = Math.max(1, last - start);
  const run = (p: ToolPart) => Math.max(0, end(p) - go);
  const done = t.every((p) => p.status !== 'running' && p.ms != null);
  const pos = (x: number) => Math.min(1, Math.max(0, (x - start) / span));
  const wall = Math.max(0, last - go);
  const lanes = done && wall / span < MIN_RUN_SHARE ? []
    : t.map((p) => ({ id: p.id, from: pos(p.at), go: all ? pos(go) : pos(end(p)), to: pos(end(p)), running: p.status === 'running' }));
  return { wall, sum: t.reduce((n, p) => n + run(p), 0), done, lanes, run: Object.fromEntries(t.map((p) => [p.id, run(p)])) };
}

// 묶음 시간 글: 1초 아래는 ms (내장 도구는 몇 ms 만에 끝난다 · '0.0초' 대신)
export const shortDuration = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : seconds(ms));
