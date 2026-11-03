// AG-UI 이벤트 하나 → 답 상태 (conductor agent.py 머리말의 순서). 화면 · 요청과 무관한 순수 함수.
import { isObj, list, strOrNull } from '../../lib/api';
import { authMode, authReason, toAppServer, toMember, toMemberStep, toSteps, toUsage, toVia, type AgUiEvent } from './api';
import { TEAM, TOOL, appStepLabel, stepLabel } from './copy';
import type { Answer, AppCard, AppTag, ReasoningPart, TeamMember, ToolPart } from './model';

// 단계 · 도구 이름표 (이벤트를 받을 때의 최신 값)
// apps = 앱 handle → 이름 (활동 단계 app:<handle>)
export type Labels = { tools: Record<string, string>; skills: Record<string, string>; apps: Record<string, string> };

const s_ = (v: unknown) => (typeof v === 'string' ? v : '');

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
const toolFailed = (r: unknown) => typeof r === 'object' && r !== null && 'error' in r;

// call id 하나의 도구 조각 · 툴 단계를 같이 바꾼다 (MCP 카드 이름표 · 연결 대기)
function patchCall(a: Answer, id: string, part: (p: ToolPart) => ToolPart, step: (st: Answer['steps'][number]) => Answer['steps'][number]): Answer {
  if (!id) return a;
  return {
    ...a,
    parts: a.parts.map((p) => (p.kind === 'tool' && p.id === id ? part(p) : p)),
    steps: a.steps.map((st) => (st.call_id === id ? step(st) : st)),
  };
}
const addCard = (a: Answer, card: AppCard, same: (c: AppCard) => boolean): Answer => (a.cards.some(same) ? a : { ...a, cards: [...a.cards, card] });

// 팀원 한 명 바꾸기 (call id 로 upsert · 팀원 사이 순서는 정해지지 않는다)
function patchMember(a: Answer, callId: string, fn: (m: TeamMember | undefined) => TeamMember): Answer {
  const team = a.team ?? [];
  const i = team.findIndex((m) => m.callId === callId);
  const next = team.slice();
  if (i < 0) next.push(fn(undefined));
  else next[i] = fn(team[i]);
  return { ...a, team: next };
}
const FINAL = new Set(['done', 'error', 'cancelled']);

export const elapsed = (a: Answer) => Date.now() - a.startedAt;

// 끝날 때 열린 단계 · 생각 · 도구를 닫는다
export function closeOpen(a: Answer, status: 'error' | 'cancelled'): Answer {
  const t = elapsed(a);
  const now = Date.now();
  // 팀원 = 끝 이벤트를 못 받은 채 끝났다 (멈추기 · 끊김) → 그 상태로 · 도는 도구 줄도
  const team = a.team?.map((m) => (FINAL.has(m.status) ? m : {
    ...m, status, ms: m.ms ?? (m.at ? now - m.at : null),
    steps: m.steps.map((st) => (st.status === 'running' ? { ...st, status, durationMs: st.at ? now - st.at : st.durationMs } : st)),
  }));
  return {
    ...a,
    ...(team ? { team } : {}),
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
      if (ev.name === 'brewai.app_tool') {
        // MCP 도구 카드: 앱 이름 · 쓰기 표시 · '<앱>: <도구>' 이름표 (TOOL_CALL_START 바로 뒤에 온다)
        const tag: AppTag = { handle: s_(v.app), name: s_(v.app_name) || s_(v.app), write: v.write === true };
        const label = s_(v.label);
        return patchCall(a, s_(v.call_id), (p) => ({ ...p, app: tag, label: label || p.label }), (st) => ({ ...st, label: label || st.label }));
      }
      if (ev.name === 'brewai.app_auth') {
        // 연결 필요 → 그 호출은 연결을 기다린다 (실행은 글 없이 끝난다) + 카드 A · B · C
        const id = s_(v.call_id);
        if (!id) return a;
        const card: AppCard = {
          kind: 'auth', callId: id, server: toAppServer(v.server), mode: authMode(v.mode), reason: authReason(v.reason),
          autoOpen: v.auto_open === true, scope: strOrNull(v.scope), write: v.write === true, label: strOrNull(v.label), phase: 'idle', error: null,
        };
        const waiting = patchCall(a, id, (p) => ({ ...p, status: 'waiting' }), (st) => ({ ...st, status: 'waiting' }));
        return addCard(waiting, card, (c) => c.kind === 'auth' && c.callId === id);
      }
      if (ev.name === 'brewai.app_needs_import') {
        // 공유됐지만 안 가져온 앱 = 카드 D (실행은 계속 · 모델이 안내한다)
        const sv = isObj(v.server) ? v.server : {};
        const server = { id: s_(sv.id), name: s_(sv.name), domain: s_(sv.domain) };
        if (!server.id) return a;
        return addCard(a, { kind: 'import', server, via: list(v.via).map(toVia) }, (c) => c.kind === 'import' && c.server.id === server.id);
      }
      if (ev.name === 'brewai.team_member') {
        // 팀원 시작 · 끝 (upsert) → 팀원 칸 + 그 delegate 도구 칸 · 단계의 이름 = 역할
        const id = s_(v.call_id);
        if (!id) return a;
        const next = patchMember(a, id, (prev) => toMember(v, prev, at));
        const role = next.team!.find((m) => m.callId === id)!.role;
        return role
          ? patchCall(next, id, (p) => ({ ...p, agent: s_(v.agent) || p.agent, role, label: role }), (st) => ({ ...st, label: role }))
          : next;
      }
      if (ev.name === 'brewai.agent_step') {
        // 팀원 도구 줄 열림 · 닫힘 (call id = '<agent>:<도구 호출 id>' · parent = delegate 호출 id)
        const parent = s_(v.parent);
        const step = toMemberStep(v, at);
        if (!parent || !step.id) return a;
        return patchMember(a, parent, (prev) => {
          const m = prev ?? toMember({ call_id: parent, agent: v.agent, status: 'running' }, undefined, at);
          const i = m.steps.findIndex((x) => x.id === step.id);
          const steps = m.steps.slice();
          if (i < 0) steps.push(step);
          else steps[i] = { ...step, at: steps[i].at || step.at };
          return { ...m, steps };
        });
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
      const { tools, skills, apps } = labels();
      const label = stepLabel(name, tools, skills, apps);
      return { ...a, status: 'running', steps: [...a.steps, { name, label, status: 'running', started_ms: elapsed(a), duration_ms: null }] };
    }
    case 'STEP_FINISHED': {
      // 툴 단계는 결과(TOOL_CALL_RESULT) 바로 뒤에 닫힌다 → 결과가 이미 온 도구(call id)의 단계를 닫는다 (병렬 툴: 현재 시각 두 번이
      // 거꾸로 끝나도 서버 기록과 같은 단계). call id 를 모르면 같은 이름 중 먼저 연 것
      const name = s_(ev.stepName);
      const resulted = (id: string | undefined) => a.parts.some((p) => p.kind === 'tool' && p.id === id && p.status !== 'running');
      const open = (st: Answer['steps'][number]) => st.name === name && st.status === 'running';
      let i = a.steps.findIndex((st) => open(st) && st.call_id != null && resulted(st.call_id));
      if (i < 0) i = a.steps.findIndex(open);
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
      const label = labels().tools[name] ?? (name === 'use_app' ? TOOL.useApp : name === 'delegate' ? TEAM.delegate : name);
      // 아직 도는 도구가 있으면 같은 응답의 툴 호출 = 같은 묶음 (결과는 툴 호출이 다 온 뒤에 온다 · conductor agent.py 와 같은 규칙)
      const tools = a.parts.filter((p): p is ToolPart => p.kind === 'tool');
      const open = tools.findLast((p) => p.status === 'running');
      const batch = open ? open.batch : Math.max(0, ...tools.map((p) => p.batch)) + 1;
      // 서버는 툴 단계(STEP_STARTED)를 이 이벤트 바로 앞에 연다 → 아직 call id 없는 마지막 툴 · 스킬 단계에 이 id 를 붙인다
      const s = a.steps.findLastIndex((st) => st.status === 'running' && st.call_id == null && /^(tool|skill|app|agent):/.test(st.name));
      const steps = s < 0 ? a.steps : a.steps.map((st, k) => (k === s ? { ...st, call_id: id } : st));
      return { ...a, steps, parts: [...a.parts, { kind: 'tool', id, name, label, argsText: '', args: undefined, result: undefined, status: 'running', ms: null, at, ready: null, batch }] };
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
      else if (ev.type === 'TOOL_CALL_END') {
        const args = parseJson(p.argsText || '{}');
        parts[i] = { ...p, args, ready: at };
        // use_app 인자에 아는 앱 이름이 있으면 결과 전에도 그 앱으로 (연결 기다림 메모 · 요약 줄 '<앱> 연결')
        const handle = p.name === 'use_app' && isObj(args) ? s_(args.app) : '';
        const name = handle ? labels().apps[handle] : undefined;
        if (name && !p.app) parts[i] = { ...(parts[i] as ToolPart), app: { handle, name, write: false } };
      }
      else {
        const content = s_(ev.content);
        const result = parseJson(content) ?? content;
        parts[i] = { ...p, result, status: toolFailed(result) ? 'error' : 'done', ms: at - p.at, args: p.args ?? parseJson(p.argsText || '{}') };
        // use_app 결과 = 고른 앱 → 카드 · 단계 이름표 '앱: <이름>'
        if (p.name === 'use_app' && isObj(result) && typeof result.app_name === 'string' && result.app_name) {
          const label = appStepLabel(result.app_name);
          parts[i] = { ...(parts[i] as ToolPart), label, app: { handle: s_(result.app), name: result.app_name, write: false } };
          return { ...a, parts, steps: a.steps.map((st) => (st.call_id === id ? { ...st, label } : st)) };
        }
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
