// 도구 카드 내용 — 사람이 읽는 두세 줄 (입력 = 핵심 인자 값 · 결과 = 제목과 링크 목록 또는 깔끔한 발췌). 날것 JSON 은 '원문' 토글 뒤에.
// 그리기는 components/ToolCard.tsx. 앱 도구 고르기(use_app)는 카드가 아니라 한 줄 메모 (TraceView AppNote · appNote).
import type { IconName } from '@brewai/ui';
import { TOOL } from './copy';
import type { ToolPart } from './model';

export const TOOL_ICON: Record<string, IconName> = { use_skill: 'layers', use_app: 'plug', make_file: 'file', read_file: 'file' };
export const TOOL_STATE_ICON: Partial<Record<ToolPart['status'], IconName>> = { done: 'check', error: 'close', waiting: 'lock' };
// 카드 아이콘: MCP 앱 도구 = 플러그 (앱 서버) · 그 밖 = 도구마다
export const toolIcon = (p: ToolPart): IconName => (p.app ? 'plug' : TOOL_ICON[p.name] ?? 'wrench');

export type ToolRow = { k: string; v: string; mono?: boolean; err?: boolean; note?: string };
// 검색 같은 결과 한 줄 = 제목 + 링크(도메인). url 이 https 가 아니면 글자만
export type ToolLink = { title: string; url: string | null; domain: string };
export type ToolView = { rows: ToolRow[]; links: ToolLink[]; more: number; note: string; raw: string };

const LINKS_SHOWN = 5;
const EXCERPT = 240;
// 입력 줄에 먼저 보일 인자 (검색어 → 글 → 주소 → id …). 나머지 글 · 숫자 인자는 뒤에 쉼표로
const KEY_ARGS = ['query', 'q', 'search', 'keyword', 'text', 'url', 'id', 'title', 'name', 'path'];

const asObj = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const show = (v: unknown): string => (v == null ? '' : typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v));
const pretty = (v: unknown): string => (v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v, null, 2));
const scalar = (v: unknown): v is string | number | boolean => typeof v === 'string' ? v.trim() !== '' : typeof v === 'number' || typeof v === 'boolean';
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const clip = (s: string, n = EXCERPT) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
// 오류 결과 {error, message} → 화면 문구. message 는 모델용 지시라 쓰지 않는다 (앱이 돌려준 tool_error 만 그 글 그대로)
export const errorText = (res: Record<string, unknown>): string =>
  (res.error === 'tool_error' ? clip(squash(show(res.message))) : TOOL.errors[show(res.error)]) || TOOL.failed;

// 인자 → 사람이 읽는 한 줄 (값만 · 핵심 인자가 앞). 글 · 숫자가 아닌 인자(목록 · 묶음)는 원문 토글에서
export function argSummary(args: unknown): string {
  const o = asObj(args);
  if (!o) return scalar(args) ? squash(String(args)) : '';
  const keys = Object.keys(o).filter((k) => scalar(o[k]));
  keys.sort((a, b) => rank(a) - rank(b));
  return clip(keys.map((k) => squash(String(o[k]))).join(', '), 160);
}
const rank = (k: string) => {
  const i = KEY_ARGS.indexOf(k.toLowerCase());
  return i < 0 ? KEY_ARGS.length : i;
};

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
const link = (title: string, url: string | null): ToolLink => {
  const safe = url && /^https?:\/\//i.test(url) ? url : null;
  return { title: clip(squash(title) || (safe ? domainOf(safe) : ''), 120), url: safe && /^https:\/\//i.test(safe) ? safe : null, domain: safe ? domainOf(safe) : '' };
};

// 'Title: … / URL: … / Published: … / 본문' 기록 여러 개 (Exa 같은 검색 MCP · conductor client.trim_records 와 같은 모양) → 목록
export function parseRecords(text: string): ToolLink[] | null {
  const blocks = text.split(/^(?=Title: )/m).map((b) => b.trim()).filter((b) => b.startsWith('Title: '));
  if (!blocks.length) return null;
  const out: ToolLink[] = [];
  for (const b of blocks) {
    const title = /^Title: (.*)$/m.exec(b)?.[1] ?? '';
    const url = /^URL: (\S+)/m.exec(b)?.[1] ?? null;
    if (!url) return null;
    out.push(link(title, url));
  }
  return out;
}

// JSON 목록 (결과 자체가 목록이거나, 묶음 안의 가장 긴 목록: items · results · notes …) → 목록. 항목 = 글 또는 title/name + url
const TITLE_KEYS = ['title', 'name', 'text', 'summary', 'id'];
const URL_KEYS = ['url', 'link', 'href', 'uri'];
export function parseList(v: unknown): ToolLink[] | null {
  let items: unknown[] | null = Array.isArray(v) ? v : null;
  const o = asObj(v);
  if (!items && o) {
    const arrays = Object.values(o).filter((x): x is unknown[] => Array.isArray(x));
    if (arrays.length) items = arrays.reduce((a, b) => (b.length > a.length ? b : a));
  }
  if (!items) return null;
  const out: ToolLink[] = [];
  for (const it of items) {
    if (scalar(it)) {
      out.push(link(String(it), null));
      continue;
    }
    const r = asObj(it);
    if (!r) return null;
    const title = TITLE_KEYS.map((k) => r[k]).find(scalar);
    const url = URL_KEYS.map((k) => r[k]).find((x): x is string => typeof x === 'string' && x !== '');
    if (title === undefined && !url) return null;
    const id = typeof r.id === 'string' && title !== r.id ? `${r.id} ` : '';
    out.push(link(`${id}${title === undefined ? '' : String(title)}`, url ?? null));
  }
  return out;
}

const tryJson = (s: string): unknown => {
  const t = s.trim();
  if (!/^[[{]/.test(t)) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
};

// MCP 결과 본문 → 목록 또는 발췌
function resultBody(body: unknown): { links: ToolLink[] | null; excerpt: string } {
  if (typeof body === 'string') {
    const recs = parseRecords(body);
    if (recs) return { links: recs, excerpt: '' };
    const j = tryJson(body);
    if (j !== undefined) return resultBody(j);
    return { links: null, excerpt: clip(squash(body)) };
  }
  const list = parseList(body);
  if (list) return { links: list, excerpt: '' };
  const o = asObj(body);
  // 한 칸짜리 겉봉 ({result: '…'} · {text: '…'} · DeepWiki 등) = 값만 (키 이름은 사람에게 뜻이 없다)
  const only = o && Object.keys(o).length === 1 ? Object.values(o)[0] : undefined;
  if (typeof only === 'string') return resultBody(only);
  // 작은 묶음 = '키 값' 몇 개 ({saved: true, count: 3} → 'saved true, count 3')
  if (o) return { links: null, excerpt: clip(Object.entries(o).filter(([, x]) => scalar(x)).map(([k, x]) => `${k} ${squash(String(x))}`).join(', ') || show(o)) };
  return { links: null, excerpt: clip(squash(show(body))) };
}

// make_file 카드 = 만든 파일 이름 (결과가 오기 전엔 인자의 name.kind) · 본문 구조(blocks · slides)는 원문 토글 뒤에
function madeName(args: Record<string, unknown> | null, res: Record<string, unknown> | null): string {
  const f = res && typeof res.file === 'object' && res.file ? (res.file as Record<string, unknown>) : null;
  if (f && typeof f.name === 'string') return f.name;
  const name = show(args?.name);
  const kind = show(args?.kind);
  return name ? (kind ? `${name}.${kind}` : name) : '…';
}

export function toolView(p: ToolPart): ToolView {
  const args = asObj(p.args);
  const res = asObj(p.result);
  const K = TOOL.rows;
  const rows: ToolRow[] = [];
  let links: ToolLink[] = [];
  let more = 0;
  let note = '';
  if (p.name === 'use_skill') rows.push({ k: K.skill, v: show(res?.label) || show(args?.name) || show(args?.need) || '…' });
  else if (p.name === 'make_file') rows.push({ k: K.file, v: madeName(args, res) });
  else if (p.args !== undefined || p.argsText) {
    const v = p.args !== undefined ? argSummary(p.args) : '…';
    if (v) rows.push({ k: K.input, v });
  }
  const raw = [pretty(p.args), p.result === undefined ? '' : pretty(res && 'result' in res ? res.result : p.result)].filter(Boolean).join('\n\n');
  const done = (): ToolView => ({ rows, links, more, note, raw });
  if (p.status === 'waiting') {
    rows.push({ k: K.state, v: TOOL.waitingAuth });
    return done();
  }
  if (p.status === 'running' || p.status === 'cancelled') return done();
  if (res && 'error' in res) {
    rows.push({ k: K.error, v: errorText(res), err: true });
  } else if (p.name === 'make_file' && res) {
    rows.push({ k: K.result, v: TOOL.made });
  } else if (p.name === 'use_skill' && res) {
    // 지침 본문은 모델만 본다 — 카드엔 줄 수만 (기록에서 연 답은 서버가 본문을 빼고 lines 를 준다)
    const lines = typeof res.lines === 'number' ? res.lines : typeof res.instructions === 'string' ? res.instructions.split('\n').length : null;
    rows.push({ k: K.result, v: TOOL.skillLoaded(lines) });
  } else if (p.result !== undefined) {
    // MCP 도구 결과 = {source, untrusted, result, truncated?, note?} (8KB 상한) · 그 밖 = 결과 그대로
    const body = res && 'result' in res ? res.result : p.result;
    note = res && typeof res.note === 'string' ? res.note : '';
    const r = resultBody(body);
    if (r.links && r.links.length) {
      links = r.links.slice(0, LINKS_SHOWN);
      more = r.links.length - links.length;
      rows.push({ k: K.result, v: TOOL.found(r.links.length) });
    } else if (r.links) {
      rows.push({ k: K.result, v: TOOL.none });
    } else {
      rows.push({ k: K.result, v: r.excerpt || TOOL.none });
    }
  }
  return done();
}

// 앱 도구 고르기 = 한 줄 메모: 'Exa 웹 검색 연결, 도구 2개' (도구 이름은 title 로) · 고르는 중 · 연결 기다림 · 실패
export function appNote(p: ToolPart, apps: Record<string, string> = {}): { text: string; tools: string } {
  const res = asObj(p.result);
  const args = asObj(p.args);
  const handle = show(args?.app);
  const name = show(res?.app_name) || p.app?.name || apps[handle] || handle;
  if (p.status === 'running') return { text: name ? TOOL.appPicking(name) : TOOL.appPickingAny, tools: '' };
  if (p.status === 'waiting') return { text: TOOL.appWaiting(name || TOOL.appAny), tools: '' };
  if (p.status === 'cancelled') return { text: TOOL.appStopped, tools: '' };
  if (res && 'error' in res) return { text: TOOL.appFailed(errorText(res)), tools: '' };
  const picked = Array.isArray(res?.tools) ? res.tools.filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null) : [];
  const tools = picked.map((t) => `${show(t.title) || show(t.name)}${t.write === true ? ` (${TOOL.write})` : ''}`).join(', ');
  return { text: TOOL.appNote(name || TOOL.appAny, picked.length), tools };
}
