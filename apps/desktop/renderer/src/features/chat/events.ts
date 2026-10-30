// AG-UI 이벤트 하나 → 답 상태 (conductor agent.py 머리말의 순서). 화면 · 요청과 무관한 순수 함수.
import { toSteps, toUsage, type AgUiEvent } from './api';
import { stepLabel } from './copy';
import type { Answer, ReasoningPart, ToolPart } from './model';

// 단계 · 도구 이름표 (이벤트를 받을 때의 최신 값)
export type Labels = { tools: Record<string, string>; skills: Record<string, string> };

const s_ = (v: unknown) => (typeof v === 'string' ? v : '');

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
const toolFailed = (r: unknown) => typeof r === 'object' && r !== null && 'error' in r;

export const elapsed = (a: Answer) => Date.now() - a.startedAt;

// 끝날 때 열린 단계 · 생각 · 도구를 닫는다
export function closeOpen(a: Answer, status: 'error' | 'cancelled'): Answer {
  const t = elapsed(a);
  return {
    ...a,
    steps: a.steps.map((st) => (st.status === 'running' ? { ...st, status, duration_ms: Math.max(0, t - st.started_ms) } : st)),
    parts: a.parts.map((p) =>
      p.kind === 'reasoning' && p.live ? { ...p, live: false, ms: Date.now() - p.at }
      : p.kind === 'tool' && p.status === 'running' ? { ...p, status: status === 'error' ? 'error' : 'cancelled' }
      : p),
  };
}

export function apply(a: Answer, ev: AgUiEvent, labels: () => Labels): Answer {
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
      const { tools, skills } = labels();
      const label = stepLabel(name, tools, skills);
      return { ...a, status: 'running', steps: [...a.steps, { name, label, status: 'running', started_ms: elapsed(a), duration_ms: null }] };
    }
    case 'STEP_FINISHED': {
      const name = s_(ev.stepName);
      const i = a.steps.findLastIndex((st) => st.name === name && st.status === 'running');
      if (i < 0) return a;
      const steps = a.steps.slice();
      steps[i] = { ...steps[i], status: 'done', duration_ms: Math.max(0, elapsed(a) - steps[i].started_ms) };
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
      const label = labels().tools[name] ?? name;
      return { ...a, parts: [...a.parts, { kind: 'tool', id, name, label, argsText: '', args: undefined, result: undefined, status: 'running', ms: null, at }] };
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
