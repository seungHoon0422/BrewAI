// 생각 · 도구 상태 줄 한 칸 = 단계 훅(data-step) · 국면(data-phase) · 글. 진행 상황 화면도 같은 문구를 쓴다.
// 답 상태 → 글 조각 (문구는 copy.ts). 결정적 — 시간과 상태로만 고른다.
// 끝난 줄 = 조각 여럿 ('3.2초 동안 생각함' · '계산기 1회' · '1.4초'). 화면은 조각마다 칸을 나누고(가운뎃점 없음), text = 쉼표로 이은 한 줄.
import { seconds } from '../../lib/format';
import { READING_RESULT, TRACE, WAITING_PHRASE, joinParts, stepPhrase } from './copy';
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
