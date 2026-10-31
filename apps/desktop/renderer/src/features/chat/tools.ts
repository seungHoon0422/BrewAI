// 도구 카드 내용 — 도구마다 사람이 읽는 두세 줄 (입력 · 결과). 모르는 도구 = JSON 그대로. 그리기는 components/ToolCard.tsx.
import type { IconName } from '@brewai/ui';
import { TOOL } from './copy';
import type { ToolPart } from './model';

export const TOOL_ICON: Record<string, IconName> = {
  calculator: 'calc', current_time: 'clock', unit_convert: 'ruler', date_calc: 'calendar', text_stats: 'text', use_skill: 'layers',
};
export const TOOL_STATE_ICON: Partial<Record<ToolPart['status'], IconName>> = { done: 'check', error: 'close' };

export type ToolRow = { k: string; v: string; mono?: boolean; err?: boolean };

const asObj = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const show = (v: unknown): string => (v == null ? '' : typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v));

export function toolRows(p: ToolPart): ToolRow[] {
  const args = asObj(p.args);
  const res = asObj(p.result);
  const K = TOOL.rows;
  const rows: ToolRow[] = [];
  if (p.name === 'calculator') rows.push({ k: K.expression, v: show(args?.expression) || p.argsText || '…', mono: true });
  else if (p.name === 'current_time') rows.push({ k: K.timezone, v: show(args?.timezone) || TOOL.defaultTimezone });
  else if (p.name === 'use_skill') rows.push({ k: K.skill, v: show(res?.label) || show(args?.name) || '…' });
  else if (p.name === 'unit_convert') rows.push({ k: K.convert, v: args ? `${show(args.value)} ${show(args.from_unit)} → ${show(args.to_unit)}` : p.argsText || '…', mono: true });
  else if (p.name === 'date_calc') rows.push({ k: K.calc, v: args ? [show(args.operation), show(args.date), show(args.other_date), args.days != null ? TOOL.days(show(args.days)) : ''].filter(Boolean).join(', ') : p.argsText || '…' });
  else if (p.name === 'text_stats') rows.push({ k: K.text, v: typeof args?.text === 'string' ? TOOL.received(Array.from(args.text).length) : '…' });
  else if (p.argsText || p.args !== undefined) rows.push({ k: K.input, v: p.args !== undefined ? show(p.args) : p.argsText, mono: true });
  if (p.status === 'running' || p.status === 'cancelled') return rows;
  if (res && 'error' in res) {
    rows.push({ k: K.error, v: show(res.message) || show(res.error), err: true });
  } else if (p.name === 'calculator' && res && 'result' in res) {
    rows.push({ k: K.result, v: show(res.result), mono: true });
  } else if (p.name === 'use_skill' && res) {
    // 지침 본문은 모델만 본다 — 카드엔 줄 수만 (기록에서 연 답은 서버가 본문을 빼고 lines 를 준다)
    const lines = typeof res.lines === 'number' ? res.lines : typeof res.instructions === 'string' ? res.instructions.split('\n').length : null;
    rows.push({ k: K.result, v: TOOL.skillLoaded(lines) });
  } else if (p.name === 'unit_convert' && res && 'text' in res) {
    rows.push({ k: K.result, v: show(res.text), mono: true });
  } else if (p.name === 'date_calc' && res && 'date' in res) {
    rows.push({ k: K.result, v: `${show(res.date)} ${show(res.weekday)}` });
  } else if (p.name === 'date_calc' && res && 'days' in res) {
    rows.push({ k: K.result, v: TOOL.dayCount(show(res.text), show(res.days)) });
  } else if (p.name === 'text_stats' && res && 'characters' in res) {
    rows.push({ k: K.result, v: TOOL.textStats({ characters: show(res.characters), noSpaces: show(res.characters_no_spaces), words: show(res.words), lines: show(res.lines) }) });
  } else if (p.name === 'current_time' && res && 'date' in res) {
    rows.push({ k: K.result, v: `${show(res.date)} ${show(res.time)} ${show(res.weekday)}${res.utc_offset ? ` (UTC${show(res.utc_offset)})` : ''}` });
  } else if (p.result !== undefined) {
    rows.push({ k: K.result, v: show(p.result), mono: true });
  }
  return rows;
}
