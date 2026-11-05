// 문서 메뉴 데이터 = 레포 파일을 Node 에서 읽어 만든 JSON (virtual:brewai-docs).
// - 정해 둔 파일만 읽는다 (레포 전체를 훑지 않는다 · .env* 는 절대 안 읽는다)
// - 해석은 여기서: 브라우저로는 lockfile 원문·안 쓰는 마크다운을 보내지 않는다
// - dev(npm run admin): 이 파일들이 바뀌면 모듈을 버리고 화면을 다시 읽는다
import fs from 'node:fs';
import path from 'node:path';
import MarkdownIt from 'markdown-it';
import type { Plugin, ViteDevServer } from 'vite';
import {
  ARCH_PATHS,
  type Adr,
  type ArchPath,
  type Board,
  type Card,
  type DocsData,
  type Handoff,
  type KeyValue,
  type Phase,
  type Roadmap,
  type Row,
  type Slice,
  type Stack,
  type Workflow,
} from './src/docs/types.ts';

const ID = 'virtual:brewai-docs';
const REPORT_ID = 'virtual:brewai-docs/report';

// 읽는 파일 (레포 루트 기준). 폴더는 그 안의 정해진 확장자만
const FILES = {
  handoff: 'HANDOFF.md',
  agents: 'AGENTS.md',
  roadmap: 'docs/roadmap.json',
  report: 'REPORT.html',
  pkg: 'package.json',
  lock: 'package-lock.json',
  nvmrc: '.nvmrc',
  npmrc: '.npmrc',
  pyproject: 'pyproject.toml',
  uvlock: 'uv.lock',
  pyver: '.python-version',
} as const;
const DIRS = [
  { dir: 'docs/adr', ext: '.md' },
  { dir: 'docs/slices', ext: '.md' },
  { dir: '.github/workflows', ext: '.yml' },
] as const;
// 아직 없는 서비스: 생기면 버전을 여기서 읽는다
const SERVICES = [
  { path: 'services/conductor', label: 'conductor (Python)', key: /conductor/i, files: ['services/conductor/pyproject.toml'] },
  { path: 'infra/litellm', label: 'LiteLLM 게이트웨이', key: /LiteLLM/, files: ['infra/litellm/requirements.txt', 'infra/litellm/pyproject.toml'] },
] as const;

// read = 내용을 읽은 파일 (바뀌면 다시 읽음) · probes = 있음/없음만 본 경로 (생기거나 지워지면 다시 읽음)
type Ctx = { root: string; errors: string[]; read: Set<string>; probes: Set<string> };

// ---------- 파일 ----------

// 레포 안의 상대 경로만 (절대 경로 · .. · .env* 거절)
function safe(rel: string): string | null {
  const p = rel.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!p || p.startsWith('/') || /^[a-z]:/i.test(p)) return null;
  const parts = p.split('/');
  if (parts.some((s) => s === '..' || s === '' || /^\.env/i.test(s))) return null;
  return p;
}

function abs(ctx: Ctx, rel: string) {
  return path.join(ctx.root, ...rel.split('/'));
}

function exists(ctx: Ctx, rel: string) {
  const p = safe(rel);
  if (p !== null) ctx.probes.add(p);
  return p !== null && fs.existsSync(abs(ctx, p));
}

// BOM · CRLF(집 = 윈도우) 정리. 없으면 null
function readText(ctx: Ctx, rel: string, required = true): string | null {
  const p = safe(rel);
  if (!p) return null;
  ctx.read.add(p);
  try {
    return fs.readFileSync(abs(ctx, p), 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  } catch {
    if (required) ctx.errors.push(`${p} 없음`);
    return null;
  }
}

function readJson<T>(ctx: Ctx, rel: string, required = true): T | null {
  const s = readText(ctx, rel, required);
  if (s === null) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    ctx.errors.push(`${rel} JSON 해석 실패`);
    return null;
  }
}

function listDir(ctx: Ctx, dir: string, ext: string): string[] {
  const p = safe(dir);
  if (!p) return [];
  try {
    return fs
      .readdirSync(abs(ctx, p), { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith(ext) && !/^\.env/i.test(d.name))
      .map((d) => `${p}/${d.name}`)
      .sort();
  } catch {
    ctx.errors.push(`${p}/ 없음`);
    return [];
  }
}

// ---------- 마크다운 ----------

type Env = { file: string; shift?: number; drop?: boolean[] };

// 레포 안 문서 링크 → 콘솔 안 주소. 못 바꾸면 null (= 글자만 남김)
function inApp(href: string, file: string): string | null {
  let h = href;
  try {
    h = decodeURIComponent(href);
  } catch {
    /* 그대로 */
  }
  const target = h.split('#')[0].split('?')[0];
  if (!target) return null; // '#…' = 그 문서 안 위치 → 콘솔 해시와 겹친다
  const p = path.posix.normalize(path.posix.join(path.posix.dirname(file), target));
  if (p.startsWith('../') || p.startsWith('/')) return null;
  const adr = /^docs\/adr\/(\d{4})[^/]*\.md$/.exec(p);
  if (adr) return `#/docs/adr/${adr[1]}`;
  const slice = /^docs\/slices\/(\d+)[^/]*\.md$/.exec(p);
  if (slice) return `#/docs/board/${sliceKey(slice[1])}`;
  if (p === 'HANDOFF.md' || p === 'docs/roadmap.json' || /^docs\/slices\/[^/]+\.md$/.test(p)) return '#/docs/progress';
  if (p === 'REPORT.html') return '#/docs/report';
  if (p === 'AGENTS.md') return '#/docs/architecture';
  return null;
}

function createMd() {
  const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
  const r = md.renderer.rules;

  r.link_open = (tokens, idx, opts, envIn, self) => {
    const env = envIn as Env;
    const t = tokens[idx];
    const href = String(t.attrGet('href') ?? '');
    env.drop ??= [];
    if (/^https?:\/\//i.test(href)) {
      t.attrSet('target', '_blank');
      t.attrSet('rel', 'noopener noreferrer');
    } else {
      const to = inApp(href, env.file);
      if (to === null) {
        env.drop.push(true); // 글자만 남긴다
        return '';
      }
      t.attrSet('href', to);
    }
    env.drop.push(false);
    return self.renderToken(tokens, idx, opts);
  };
  r.link_close = (tokens, idx, opts, envIn, self) => ((envIn as Env).drop?.pop() ? '' : self.renderToken(tokens, idx, opts));
  // 그림은 대체 글만 (원격 그림을 불러오지 않는다)
  r.image = (tokens, idx, opts, env, renderer) =>
    md.utils.escapeHtml(renderer.renderInlineAsText(tokens[idx].children ?? [], opts, env));
  // 제목 단계 내림 (화면의 h1 은 App 하나뿐)
  const heading: NonNullable<typeof r.heading_open> = (tokens, idx, opts, envIn, self) => {
    const t = tokens[idx];
    t.tag = `h${Math.min(6, Number(t.tag.slice(1)) + ((envIn as Env).shift ?? 0))}`;
    return self.renderToken(tokens, idx, opts);
  };
  r.heading_open = heading;
  r.heading_close = heading;
  // 넓은 표는 자기 상자 안에서만 가로 스크롤
  r.table_open = () => '<div class="md-table"><table>\n';
  r.table_close = () => '</table></div>\n';

  const block = (src: string, file: string, shift = 0) =>
    md
      .render(src, { file, shift } satisfies Env)
      .replace(/<li>\[([ xX])\]\s?/g, (_m, x: string) =>
        x === ' ' ? '<li class="task"><span class="sr">남음: </span>' : '<li class="task done"><span class="sr">완료: </span>',
      );
  const inline = (src: string, file: string) => md.renderInline(src.trim(), { file } satisfies Env);
  return { block, inline };
}
type Md = ReturnType<typeof createMd>;

// ' · ' 로 나눈다. 괄호 · 백틱 안의 ' · ' 은 그대로
function splitTop(s: string, sep = ' · '): string[] {
  const out: string[] = [];
  let depth = 0;
  let tick = false;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '`') tick = !tick;
    else if (!tick && (c === '(' || c === '（')) depth++;
    else if (!tick && (c === ')' || c === '）')) depth = Math.max(0, depth - 1);
    if (!tick && depth === 0 && s.startsWith(sep, i)) {
      out.push(cur);
      cur = '';
      i += sep.length - 1;
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

const NONE = /^(없음|-|—|–|n\/a)?$/i;
const plain = (s: string) => s.replace(/[`*_]/g, '').trim();

// ---------- HANDOFF.md ----------

function tableRows(src: string): Map<string, string> {
  const rows = new Map<string, string>();
  const lines = src.split('\n');
  let inTable = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/^\s*\|/.test(line)) {
      inTable = false;
      continue;
    }
    const cells = splitCells(line);
    if (cells.every((c) => /^:?-+:?$/.test(c))) {
      inTable = true; // 머리글 다음 줄
      continue;
    }
    if (!inTable || cells.length < 2) continue;
    const [k, ...rest] = cells;
    rows.set(plain(k), rest.join(' | '));
  }
  return rows;
}

function splitCells(line: string): string[] {
  const s = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const out: string[] = [];
  let cur = '';
  let tick = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
      continue;
    }
    if (c === '`') tick = !tick;
    if (c === '|' && !tick) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

// '## 제목' 아래 '- 항목' 들
function sectionItems(src: string, match: RegExp): string[] | null {
  const lines = src.split('\n');
  const start = lines.findIndex((l) => /^##\s/.test(l) && match.test(l));
  if (start < 0) return null;
  const out: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (/^#{1,2}\s/.test(l)) break;
    const m = /^\s*[-*]\s+(.*)$/.exec(l);
    if (m) out.push(m[1]);
  }
  return out;
}

function parseHandoff(src: string, md: Md): { data: Handoff; phaseLine: string } {
  const f = FILES.handoff;
  const rows = tableRows(src);
  const take = (k: string) => {
    const v = rows.get(k);
    rows.delete(k);
    return v ?? null;
  };
  const html = (v: string) => md.inline(v, f);
  const list = (v: string | null) => (v === null || NONE.test(v.trim()) ? [] : splitTop(v).map(html));

  const updated = take('마지막 갱신');
  const branch = take('활성 브랜치');
  const phase = take('Phase');
  const next = take('다음 할 일');
  const blocked = take('막힘');
  const pending = take('결정 대기');
  const settled = take('확정');

  const nextItems =
    next === null ? []
    : /(^|\s)\d+\)\s/.test(next) ? next.split(/\s·\s(?=\d+\)\s)/).map((x) => html(x.replace(/^\s*\d+\)\s*/, '')))
    : list(next);
  const pendingItems =
    pending === null || NONE.test(pending.trim()) ? []
    : /[①-⑳]/.test(pending) ? pending.split(/(?=[①-⑳])/).map((x) => x.replace(/^[①-⑳]\s*/, '').trim()).filter(Boolean).map(html)
    : list(pending);

  const log = (sectionItems(src, /최근 기록/) ?? []).map((l) => {
    const m = /^(\d{4}-\d{2}-\d{2})\s*·\s*(.*)$/.exec(l);
    return m ? { date: m[1], html: html(m[2]) } : { date: null, html: html(l) };
  });

  return {
    phaseLine: phase ?? '',
    data: {
      updated: updated === null ? null : html(updated),
      branch: branch === null ? null : html(branch),
      phase: phase === null ? [] : splitTop(phase).map(html),
      next: nextItems,
      blocked: list(blocked),
      pending: pendingItems,
      settled: settled === null ? [] : splitTop(settled).map(html),
      // '(… 한 줄씩 …)' = 템플릿 안내 → 메모 아님
      memo: (sectionItems(src, /사용자 메모/) ?? []).filter((m) => !/^\(.*\)$/.test(m.trim())).map(html),
      log,
      rows: [...rows].map(([key, value]) => ({ key, value: html(value) })),
    },
  };
}

// ---------- docs/roadmap.json ----------

type RoadmapJson = {
  updated?: string;
  rule?: string;
  phases?: { id?: string; name?: string; weeks?: number; goal?: string; exit_criteria?: string[]; slice_hint?: string[]; passes?: boolean }[];
};

function mentions(line: string, id: string) {
  return new RegExp(`(^|[^A-Za-z0-9])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![0-9])`).test(line);
}

function parseRoadmap(j: RoadmapJson, phaseLine: string): Roadmap {
  const phases: Phase[] = (j.phases ?? []).map((p, i) => {
    const id = String(p.id ?? `P${i}`);
    const passes = p.passes === true;
    return {
      id,
      name: String(p.name ?? ''),
      weeks: typeof p.weeks === 'number' ? p.weeks : null,
      goal: String(p.goal ?? ''),
      criteria: (p.exit_criteria ?? []).map((c) => {
        const m = /^(P\d+-\d+)\s+(.*)$/.exec(String(c));
        return m ? { id: m[1], text: m[2] } : { id: '', text: String(c) };
      }),
      hints: (p.slice_hint ?? []).map(String),
      passes,
      state: passes ? 'done' : mentions(phaseLine, id) ? 'now' : 'next',
    };
  });
  return { updated: j.updated ?? null, rule: j.rule ?? null, phases };
}

// ---------- docs/slices ----------

function parseSlice(file: string, src: string, md: Md): Slice {
  const name = path.posix.basename(file, '.md');
  const lines = src.split('\n');
  const h1 = lines.findIndex((l) => /^#\s/.test(l));
  const title = (h1 >= 0 ? lines[h1].replace(/^#\s+/, '') : name).replace(/^slice\s+\d+\s*[·:\-–—]\s*/i, '').trim();
  const firstH2 = lines.findIndex((l) => /^##\s/.test(l));
  const head = lines.slice(0, firstH2 < 0 ? lines.length : firstH2);
  let goal: string | null = null;
  const meta: KeyValue[] = [];
  let criteria: string[] = [];
  for (const l of head) {
    const m = /^-\s+([^:：]+)[:：]\s*(.*)$/.exec(l);
    if (!m) continue;
    const k = plain(m[1]);
    if (k === '목표') goal = md.inline(m[2], file);
    else {
      if (/exit criteria|완료 기준/i.test(k)) criteria = m[2].match(/P\d+-\d+/g) ?? [];
      meta.push({ key: k, value: md.inline(m[2], file) });
    }
  }
  const done = (sectionItems(src, /^##\s+done\b/i) ?? [])
    .map((l) => /^\[([ xX])\]\s+(.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ done: m[1] !== ' ', html: md.inline(m[2], file) }));
  const body = h1 >= 0 ? [...lines.slice(0, h1), ...lines.slice(h1 + 1)].join('\n') : src;
  return {
    file,
    num: /^(\d+)/.exec(name)?.[1] ?? name,
    branch: `slice/${name}`,
    title,
    goal,
    meta,
    criteria,
    done,
    html: md.block(body, file, 2),
  };
}

// ---------- docs/adr ----------

function parseAdr(file: string, src: string, md: Md): Adr {
  const name = path.posix.basename(file, '.md');
  const lines = src.split('\n');
  const h1 = lines.findIndex((l) => /^#\s/.test(l));
  const title = (h1 >= 0 ? lines[h1].replace(/^#\s+/, '') : name).replace(/^ADR-?\s*\d+\s*[·:.\-–—]\s*/i, '').trim();
  const st = lines.findIndex((l) => /^-\s*상태\s*[:：]/.test(l));
  let status: string | null = null;
  let date: string | null = null;
  let note: string | null = null;
  if (st >= 0) {
    const v = lines[st].replace(/^-\s*상태\s*[:：]\s*/, '');
    const parts = splitTop(v);
    status = parts[0]?.split(/\s/)[0] ?? null;
    date = /\d{4}-\d{2}-\d{2}/.exec(v)?.[0] ?? null;
    const rest = [parts[0]?.split(/\s/).slice(1).join(' ') ?? '', ...parts.slice(1)]
      .join(' · ')
      .replace(date ?? '\u0000', '')
      .replace(/^[\s·]+|[\s·]+$/g, '')
      .replace(/\s·\s·\s/g, ' · ');
    note = rest ? md.inline(rest, file) : null;
  }
  const body = lines.filter((_, i) => i !== h1 && i !== st).join('\n');
  return { key: /^(\d{4})/.exec(name)?.[1] ?? name, file, title, status, date, note, html: md.block(body, file, 1) };
}

// ---------- 구성 ----------

type Pkg = { name?: string; workspaces?: string[]; engines?: Record<string, string>; scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

// 아주 작은 TOML 읽기: [표] 안의 key = "값" / [ … ] 만
function tomlValue(src: string, table: string, key: string): string | null {
  let cur = '';
  for (const l of src.split('\n')) {
    const t = /^\s*\[([^\]]+)\]\s*$/.exec(l);
    if (t) {
      cur = t[1].trim();
      continue;
    }
    if (cur !== table) continue;
    const m = new RegExp(`^\\s*${key.replace(/[-.]/g, '\\$&')}\\s*=\\s*(.*)$`).exec(l);
    if (m) return m[1].replace(/\s+#.*$/, '').trim();
  }
  return null;
}
const unquote = (s: string | null) => (s === null ? null : s.replace(/^["']|["']$/g, ''));
const tomlList = (s: string | null) => (s === null ? [] : [...s.matchAll(/"([^"]+)"/g)].map((m) => m[1]));

function parseUvLock(src: string, direct: Set<string>) {
  const out: Stack['python'] = [];
  for (const block of src.split(/^\[\[package\]\]\s*$/m).slice(1)) {
    const name = /^name\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    const version = /^version\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    if (!name || !version || /^source\s*=\s*\{\s*virtual/m.test(block)) continue;
    out.push({ name, version, direct: direct.has(name.toLowerCase()) });
  }
  return out;
}

const reqName = (spec: string) => /^\s*([A-Za-z0-9_.\-[\]]+)/.exec(spec)?.[1].replace(/\[.*$/, '').toLowerCase() ?? spec;

function parseWorkflow(file: string, src: string): Workflow {
  const lines = src.split('\n');
  const top = (k: string) => {
    const m = lines.map((l) => new RegExp(`^${k}:\\s*(.*)$`).exec(l)).find(Boolean);
    return m ? m[1].replace(/\s+#.*$/, '').trim() : null;
  };
  let on: string[] = [];
  const onLine = lines.findIndex((l) => /^(on|"on"|'on'):/.test(l));
  if (onLine >= 0) {
    const v = lines[onLine].replace(/^[^:]+:\s*/, '').replace(/\s+#.*$/, '').trim();
    if (v.startsWith('[')) on = v.replace(/[[\]]/g, '').split(',').map((x) => x.trim()).filter(Boolean);
    else if (v) on = [v];
    else
      for (const l of lines.slice(onLine + 1)) {
        if (/^\S/.test(l)) break;
        const m = /^ {2}([\w-]+):/.exec(l);
        if (m) on.push(m[1]);
      }
  }
  const runsOn = lines.map((l) => /^\s+runs-on:\s*(.*)$/.exec(l)).find(Boolean)?.[1].replace(/\s+#.*$/, '').trim() ?? null;

  const steps: Workflow['steps'] = [];
  let stepIndent = -1;
  let cur: Workflow['steps'][number] | null = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const item = /^(\s*)-\s+(name|uses|run):\s*(.*)$/.exec(l);
    const key = /^(\s*)(name|uses|run):\s*(.*)$/.exec(l);
    let k: string | null = null;
    let v = '';
    if (item && (stepIndent < 0 || item[1].length === stepIndent)) {
      stepIndent = item[1].length;
      cur = { name: null, run: null, uses: null, pin: null, sha: false };
      steps.push(cur);
      k = item[2];
      v = item[3];
    } else if (cur && key && key[1].length === stepIndent + 2) {
      k = key[2];
      v = key[3];
    } else continue;
    if (!cur) continue;
    if (k === 'uses') {
      const m = /^(\S+)(?:\s+#\s*(.*))?$/.exec(v.trim());
      cur.uses = m?.[1] ?? v.trim();
      cur.pin = m?.[2]?.trim() || null;
      cur.sha = /@[0-9a-f]{40}$/.test(cur.uses);
    } else if (k === 'run') {
      let run = v.trim();
      if (/^[|>][-+]?$/.test(run)) {
        // 여러 줄: 더 들여 쓴 줄들
        const body: string[] = [];
        for (const b of lines.slice(i + 1)) {
          if (b.trim() && b.search(/\S/) <= stepIndent + 2) break;
          if (b.trim()) body.push(b.trim());
        }
        run = body.join(' ; ');
      } else run = run.replace(/\s+#.*$/, '');
      cur.run = run;
    } else cur.name = unquote(v.replace(/\s+#.*$/, '').trim());
  }
  return { file, name: unquote(top('name')) ?? path.posix.basename(file), on, runsOn, steps };
}

// AGENTS.md '## 폴더': `경로` = 역할 · `경로` (역할) · `a/{b,c}`
function parseFolders(ctx: Ctx, agents: string | null): Stack['folders'] {
  if (!agents) return [];
  const lines = agents.split('\n');
  const start = lines.findIndex((l) => /^##\s+폴더/.test(l));
  if (start < 0) return [];
  const out: Stack['folders'] = [];
  const seen = new Set<string>();
  const add = (raw: string, role: string | null) => {
    const brace = /^(.*)\{([^}]+)\}(.*)$/.exec(raw);
    const paths = brace ? brace[2].split(',').map((x) => `${brace[1]}${x.trim()}${brace[3]}`) : [raw];
    for (const p0 of paths) {
      const p = safe(p0);
      if (!p || seen.has(p)) continue;
      seen.add(p);
      out.push({ path: p, role: role ?? roleElsewhere(agents, p), exists: exists(ctx, p) });
    }
  };
  for (const l of lines.slice(start + 1)) {
    if (/^##\s/.test(l)) break;
    if (!/^\s*-\s/.test(l)) continue;
    for (const seg of splitTop(l.replace(/^\s*-\s+/, ''))) {
      const m = /`([^`]+)`\s*(?:=\s*(.+)|\((.+)\))?$/.exec(seg) ?? /`([^`]+)`/.exec(seg);
      if (!m) continue;
      add(m[1], (m[2] ?? m[3] ?? '').trim() || null);
    }
  }
  return out;
}

// 폴더 칸에 역할이 없으면 AGENTS.md 의 '이름(`경로`)' · '이름 → `경로`' 에서
function roleElsewhere(agents: string, p: string): string | null {
  const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m =
    new RegExp(`([^·:\\n(]+)\\(\`${esc}/?\``).exec(agents) ?? // 사용자 웹(`apps/web`)
    new RegExp(`([^·:\\n→]+)→\\s*\`${esc}/?\``).exec(agents); // 결정 기록 → `docs/adr/`
  return m ? plain(m[1].replace(/^\s*-\s+/, '')) || null : null;
}

function buildStack(ctx: Ctx, agents: string | null, roadmap: Roadmap | null): Stack {
  const pkg = readJson<Pkg>(ctx, FILES.pkg) ?? {};
  const nvmrc = readText(ctx, FILES.nvmrc)?.trim() ?? null;
  const npmrc = readText(ctx, FILES.npmrc);
  const py = readText(ctx, FILES.pyproject);
  const uv = readText(ctx, FILES.uvlock);
  const pyver = readText(ctx, FILES.pyver, false)?.trim() ?? null;

  // npm: 루트 + 워크스페이스 package.json
  const npmMap = new Map<string, Stack['npm'][number]>();
  const wsList = (pkg.workspaces ?? []).map((w) => safe(w)).filter((w): w is string => w !== null && !w.includes('*'));
  for (const ws of ['', ...wsList]) {
    const rel = ws ? `${ws}/package.json` : FILES.pkg;
    const p = ws ? readJson<Pkg>(ctx, rel) : pkg;
    if (!p) continue;
    const label = ws || '(루트)';
    for (const [deps, dev] of [[p.dependencies, false], [p.devDependencies, true]] as const)
      for (const [name, version] of Object.entries(deps ?? {})) {
        const k = `${name}@${version}@${dev}`;
        const row = npmMap.get(k) ?? { name, version, dev, workspaces: [] };
        row.workspaces.push(label);
        npmMap.set(k, row);
      }
  }
  const npm = [...npmMap.values()].sort((a, b) => Number(a.dev) - Number(b.dev) || a.name.localeCompare(b.name));

  // 파이썬: pyproject 직접 의존성 + uv.lock
  const direct = new Set<string>();
  if (py) {
    for (const s of tomlList(tomlValue(py, 'project', 'dependencies'))) direct.add(reqName(s));
    let inGroups = false;
    for (const l of py.split('\n')) {
      if (/^\s*\[/.test(l)) inGroups = /^\s*\[dependency-groups\]/.test(l);
      else if (inGroups) for (const s of tomlList(l.replace(/^[^=]*=/, ''))) direct.add(reqName(s));
    }
  }
  const python = uv ? parseUvLock(uv, direct) : [];

  const ciSrc = new Map(listDir(ctx, '.github/workflows', '.yml').map((f) => [f, readText(ctx, f) ?? '']));
  const ci = [...ciSrc].map(([f, src]) => parseWorkflow(f, src));
  const steps = ci.flatMap((w) => w.steps.filter((s) => s.uses));
  // CI 의 uv 버전 = setup-uv 단계의 with.version
  let uvCi: Row | null = null;
  for (const [f, src] of ciSrc) {
    const v = /uses:\s*astral-sh\/setup-uv@\S+[^\n]*\n(?:[ \t]+[^\n]*\n)*?[ \t]+version:\s*["']?([\d.]+)/.exec(src)?.[1];
    if (v) uvCi = { name: 'uv (CI)', value: v, from: f };
  }

  // .npmrc: 이 세 줄만 싣는다 (토큰 같은 다른 줄은 안 읽어 보낸다)
  const rc = new Map<string, string>();
  for (const m of (npmrc ?? '').matchAll(/^\s*([^#;=\s]+)\s*=\s*(.*)$/gm))
    if (['min-release-age', 'save-exact', 'engine-strict'].includes(m[1])) rc.set(m[1], m[2].trim());

  const requiresPython = unquote(py ? tomlValue(py, 'project', 'requires-python') : null);
  const uvRequired = unquote(py ? tomlValue(py, 'tool.uv', 'required-version') : null);
  const excludeNewer = unquote(py ? tomlValue(py, 'tool.uv', 'exclude-newer') : null);

  const runtimes: Row[] = [];
  if (nvmrc) runtimes.push({ name: 'Node', value: nvmrc, from: '.nvmrc' });
  if (pkg.engines?.node) runtimes.push({ name: 'Node (engines)', value: pkg.engines.node, from: 'package.json' });
  if (requiresPython) runtimes.push({ name: 'Python', value: requiresPython, from: 'pyproject.toml' });
  if (pyver) runtimes.push({ name: 'Python (로컬)', value: pyver, from: '.python-version' });
  if (uvRequired) runtimes.push({ name: 'uv', value: uvRequired, from: 'pyproject.toml' });
  if (uvCi) runtimes.push(uvCi);

  // package-lock.json: 원문은 안 싣고 개수만
  const lock = readJson<{ packages?: Record<string, { resolved?: string; integrity?: string; link?: boolean }> }>(ctx, FILES.lock);
  const locked = Object.entries(lock?.packages ?? {}).filter(([k, v]) => k.includes('node_modules/') && !v.link);
  const integ = locked.filter(([, v]) => v.integrity).length;
  const npmjs = locked.filter(([, v]) => v.resolved?.startsWith('https://registry.npmjs.org/')).length;
  const uvHashed = uv ? uv.split(/^\[\[package\]\]\s*$/m).slice(1).filter((b) => /hash\s*=\s*"sha256:/.test(b)).length : 0;

  const supply: Row[] = [];
  if (rc.has('min-release-age')) supply.push({ name: 'npm 게시 나이', value: `${rc.get('min-release-age')}일 이상`, from: '.npmrc min-release-age' });
  if (rc.has('save-exact')) supply.push({ name: 'npm 정확한 버전 저장', value: rc.get('save-exact')!, from: '.npmrc save-exact' });
  if (rc.has('engine-strict')) supply.push({ name: 'Node 버전 강제', value: rc.get('engine-strict')!, from: '.npmrc engine-strict' });
  if (lock) supply.push({ name: 'npm lock', value: `${locked.length}개 · integrity ${integ}/${locked.length} · npmjs ${npmjs}/${locked.length}`, from: FILES.lock });
  if (excludeNewer) supply.push({ name: 'uv 게시 기준일', value: excludeNewer, from: 'pyproject.toml exclude-newer' });
  if (uv) supply.push({ name: 'uv lock', value: `${python.length}개 · 해시 ${uvHashed}/${python.length}`, from: FILES.uvlock });
  if (steps.length) supply.push({ name: 'Actions 고정', value: `커밋 SHA ${steps.filter((s) => s.sha).length}/${steps.length}`, from: '.github/workflows' });

  const banLine = agents?.split('\n').find((l) => /LiteLLM/.test(l) && /금지/.test(l)) ?? '';
  const banned = /LiteLLM\s+([\d.\s·,]+?)\s*(?:은|는|=|→|:)/.exec(banLine)?.[1].split(/[·,\s]+/).filter((v) => /^\d+(\.\d+)+$/.test(v)) ?? [];

  const services: Stack['services'] = SERVICES.map((s) => {
    const has = exists(ctx, s.path);
    const deps: { name: string; version: string }[] = [];
    if (has)
      for (const f of s.files) {
        const src = readText(ctx, f, false);
        if (!src) continue;
        const specs = f.endsWith('.toml') ? tomlList(tomlValue(src, 'project', 'dependencies')) : src.split('\n').filter((l) => l.trim() && !/^\s*[#-]/.test(l));
        for (const spec of specs) {
          const m = /^\s*([A-Za-z0-9_.\-[\]]+)\s*==\s*([^\s;\\]+)/.exec(spec);
          if (m) deps.push({ name: m[1], version: m[2] });
        }
      }
    // 언제 생기나: roadmap slice_hint 에서 이름이 처음 나오는 곳
    let plan: string | null = null;
    for (const p of roadmap?.phases ?? []) {
      const h = p.hints.find((x) => s.key.test(x));
      if (h) {
        plan = `${p.id} · slice ${/^(\d+)/.exec(h)?.[1] ?? '?'}`;
        break;
      }
    }
    return { path: s.path, label: s.label, exists: has, plan, deps };
  });

  return {
    scripts: Object.entries(pkg.scripts ?? {}).map(([name, cmd]) => ({ name, cmd })),
    runtimes,
    npm,
    python,
    services,
    folders: parseFolders(ctx, agents),
    ci,
    supply,
    banned,
  };
}

// ---------- REPORT.html → iframe srcdoc ----------

// 바깥 링크 = 새 탭 · 문서 안 '#…' = 그대로 (base = about:srcdoc) · 레포 상대 경로 = 링크 해제
function reportHtml(src: string): string {
  const out = src.replace(/<a\b([^>]*)>/gi, (_m, attrs: string) => {
    const href = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
    const h = href ? (href[1] ?? href[2] ?? '') : null;
    const rest = attrs.replace(/\s(href|target|rel)\s*=\s*(?:"[^"]*"|'[^']*'|\S+)/gi, '');
    if (h === null) return `<a${rest}>`;
    if (/^https?:\/\//i.test(h)) return `<a href="${h}" target="_blank" rel="noopener noreferrer"${rest}>`;
    if (h.startsWith('#')) return `<a href="${h}" target="_self"${rest}>`;
    return `<a${rest}>`;
  });
  const base = '<base href="about:srcdoc" target="_blank">';
  return /<head[^>]*>/i.test(out) ? out.replace(/<head[^>]*>/i, (m) => `${m}\n${base}`) : base + out;
}

// ---------- 보드 (HANDOFF · roadmap · slices · ADR 를 카드로) ----------

const sliceKey = (num: string) => `slice-${String(Number(num)).padStart(2, '0')}`;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const uniq = <T,>(xs: T[]) => [...new Set(xs)];
const critIds = (s: string): string[] => s.match(/P\d+-\d+/g) ?? [];
const adrIds = (s: string) => [...s.matchAll(/ADR-?(\d{4})/g)].map((m) => m[1]);

// 괄호 · 백틱 밖에서 처음 나오는 sep 의 위치 (없으면 -1)
function topIndex(s: string, sep: string): number {
  let depth = 0;
  let tick = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '`') tick = !tick;
    else if (!tick && (c === '(' || c === '（')) depth++;
    else if (!tick && (c === ')' || c === '）')) depth = Math.max(0, depth - 1);
    if (!tick && depth === 0 && s.startsWith(sep, i)) return i;
  }
  return -1;
}

// '이름: 나머지' → [이름, 나머지]. 이름이 길면 (문장 속 ':' ) 나누지 않는다
function headOf(s: string, max = 24): [string | null, string] {
  const i = Math.min(...[':', '：'].map((c) => topIndex(s, c)).filter((x) => x >= 0), Infinity);
  if (!Number.isFinite(i)) return [null, s];
  const head = s.slice(0, i).trim();
  if (!head || head.length > max || head.includes('`')) return [null, s];
  return [head, s.slice(i + 1).trim()];
}

// 제목이 길면 ' + ' · ' · ' 마디에서 자른다 (괄호 설명은 뗀다)
function shortTitle(s: string, max = 20): string {
  const t = s.replace(/\s*[(（][^)）]*[)）]/g, '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const parts = t.split(/(\s\+\s|\s·\s)/);
  let out = parts[0];
  for (let i = 1; i + 1 < parts.length; i += 2) {
    if ((out + parts[i] + parts[i + 1]).length > max) break;
    out += parts[i] + parts[i + 1];
  }
  return out;
}

type SliceFile = { slice: Slice; src: string };

// HANDOFF Phase 칸에서 '구현' 이라고 적힌 slice 번호 ('프로젝트(slice 03 · 04 구현)' · '파일(slice 07 · ADR-0015) 구현')
function builtSlices(phaseLine: string): Set<number> {
  const t = plain(phaseLine);
  const out = new Set<number>();
  for (const m of t.matchAll(/slice\s+(\d+(?:\s*·\s*\d+)*)/gi)) {
    const tail = t.slice(m.index + m[0].length, m.index + m[0].length + 60);
    if (/^\s*구현/.test(tail) || /^[^()]*\)\s*구현/.test(tail)) for (const n of m[1].match(/\d+/g) ?? []) out.add(Number(n));
  }
  return out;
}

function buildBoard(
  md: Md,
  handoffSrc: string | null,
  roadmap: Roadmap | null,
  slices: Map<string, SliceFile>, // key = slice-01
  adrSrc: Map<string, string>, // key = 0007
): Board {
  const rows = handoffSrc === null ? new Map<string, string>() : tableRows(handoffSrc);
  const phaseLine = rows.get('Phase') ?? '';
  const branchLine = plain(rows.get('활성 브랜치') ?? '');
  const H = FILES.handoff;
  const R = FILES.roadmap;
  const cards: Card[] = [];
  const builtSet = builtSlices(phaseLine);
  const maxBuilt = Math.max(0, ...builtSet);

  const relatedAdrs = (text: string, ids: string[]) => {
    const out = adrIds(text);
    for (const [key, src] of adrSrc) if (ids.some((id) => new RegExp(`(^|[^A-Za-z0-9])${esc(id)}(?![0-9])`).test(src))) out.push(key);
    return uniq(out).filter((k) => adrSrc.has(k)).sort();
  };

  for (const p of roadmap?.phases ?? []) {
    const critText = new Map(p.criteria.map((c) => [c.id, c.text]));
    if (p.hints.length > 0) {
      // slice 카드: 'NN 이름: 설명 (P1-5)'
      for (const hint of p.hints) {
        const m = /^\s*(\d+)\s+(.*)$/.exec(hint);
        if (!m) continue;
        const key = sliceKey(m[1]);
        const rest = m[2];
        let [name, desc] = headOf(rest, 40);
        if (name === null) {
          const dash = topIndex(rest, ' — ');
          [name, desc] = dash >= 0 ? [rest.slice(0, dash), rest] : [rest, '']; // 제목 = ' — ' 앞 · 목표 = 전체 (제목에서 잘린 범위도 보이게)
        }
        const f = slices.get(key);
        const s = f?.slice;
        const ids = uniq([...(s?.criteria ?? []), ...critIds(hint)]);
        const checklist: Card['checklist'] = s
          ? s.done.map((d) => ({ done: d.done, id: null, html: d.html }))
          : ids.map((id) => ({ done: p.passes ? true : null, id, html: md.inline(critText.get(id) ?? '', R) }));
        const total = s?.done.length ?? 0;
        const doneN = s?.done.filter((d) => d.done).length ?? 0;
        const num = Number(m[1]);
        const onBranch = new RegExp(`slice/0*${num}(?![0-9])`).test(branchLine);
        // 완료 = passes · done 모두 체크 · HANDOFF '구현' · 그 뒤 번호가 구현됨 / 진행 중 = 문서 있음 · 활성 브랜치 / 나머지 = 예정 (다음 · 나중은 아래)
        const built = p.passes || (total > 0 && doneN === total) || builtSet.has(num) || num < maxBuilt;
        const state: Card['state'] = built ? 'done' : s || onBranch ? 'doing' : 'later';
        cards.push({
          key,
          label: `slice ${key.slice(6)}`,
          kind: 'slice',
          title: s?.title || shortTitle(name),
          phase: p.id,
          weeks: null,
          state,
          why:
            state === 'done' ? (p.passes ? `${p.id} passes` : builtSet.has(num) ? 'HANDOFF 에 구현' : num < maxBuilt ? '뒤 slice 가 구현됨' : 'done 모두 체크')
            : onBranch ? 'HANDOFF 활성 브랜치'
            : s ? `${s.file} 있음, 아직 구현 전`
            : 'slice 문서 아직 없음',
          goal: s?.goal ?? (desc ? md.inline(desc, R) : null),
          hint: md.inline(hint, R),
          checklist,
          progress: s && total > 0 ? { done: doneN, total } : null,
          branch: s?.branch ?? null,
          ids,
          adrs: relatedAdrs(`${hint}\n${f?.src ?? ''}`, ids),
          files: s ? [R, s.file] : [R],
        });
      }
      continue;
    }
    // phase 카드: 완료 기준별 상태는 passes 또는 HANDOFF Phase 의 '남은 것: P0-1'
    const seg = splitTop(phaseLine).find((x) => mentions(x, p.id)) ?? '';
    const left = /남은\s*것\s*[:：]\s*([^)）]*)/.exec(seg);
    const leftIds = left ? critIds(left[1]) : null;
    const checklist = p.criteria.map((c) => ({
      done: p.passes ? true : leftIds && c.id ? !leftIds.includes(c.id) : null,
      id: c.id || null,
      html: md.inline(c.text, R),
    }));
    const known = checklist.length > 0 && checklist.every((c) => c.done !== null);
    const state: Card['state'] = p.passes ? 'done' : seg ? 'doing' : 'later';
    const ids = p.criteria.map((c) => c.id).filter(Boolean);
    cards.push({
      key: p.id,
      label: p.id,
      kind: 'phase',
      title: p.name,
      phase: p.id,
      weeks: p.weeks,
      state,
      why: state === 'done' ? 'passes true' : state === 'doing' ? 'HANDOFF Phase 에 있음' : '아직 시작 전',
      goal: p.goal ? md.inline(p.goal, R) : null,
      hint: null,
      checklist,
      progress: known ? { done: checklist.filter((c) => c.done).length, total: checklist.length } : null,
      branch: null,
      ids,
      adrs: relatedAdrs(`${p.goal}\n${p.criteria.map((c) => c.text).join('\n')}`, ids),
      files: seg ? [R, H] : [R],
    });
  }

  // roadmap 에 없는 slice 문서도 카드로 (번호 순 자리 · phase = 바로 앞 slice 의 것)
  for (const [key, { slice: sl, src }] of slices) {
    if (cards.some((c) => c.key === key)) continue;
    const num = Number(key.slice(6));
    const before = cards.filter((c) => c.kind === 'slice' && Number(c.key.slice(6)) < num).pop();
    const total = sl.done.length;
    const doneN = sl.done.filter((d) => d.done).length;
    const built = (total > 0 && doneN === total) || builtSet.has(num) || num < maxBuilt;
    const card: Card = {
      key, label: `slice ${key.slice(6)}`, kind: 'slice', title: sl.title, phase: before?.phase ?? 'P1', weeks: null,
      state: built ? 'done' : 'doing', why: built ? 'HANDOFF 에 구현' : `${sl.file} 있음, 아직 구현 전`,
      goal: sl.goal, hint: null, checklist: sl.done.map((d) => ({ done: d.done, id: null, html: d.html })),
      progress: total > 0 ? { done: doneN, total } : null, branch: sl.branch, ids: sl.criteria, adrs: relatedAdrs(src, sl.criteria),
      files: [sl.file],
    };
    cards.splice(before ? cards.indexOf(before) + 1 : cards.length, 0, card);
  }

  // 예정 중 바로 다음 = 진행 중인 slice 가 없을 때 번호가 가장 작은 예정 slice (진행 중이 있으면 그 다음 하나)
  const nextSlice = cards.filter((c) => c.kind === 'slice' && c.state === 'later').sort((a, b) => Number(a.key.slice(6)) - Number(b.key.slice(6)))[0];
  if (nextSlice) {
    nextSlice.state = 'next';
    nextSlice.why = `다음 작업 (${nextSlice.why})`;
  }
  return { cards };
}

// ---------- 모으기 ----------

const EMPTY_STACK: Stack = { scripts: [], runtimes: [], npm: [], python: [], services: [], folders: [], ci: [], supply: [], banned: [] };

export function collectDocs(root: string): { data: DocsData; report: string | null; files: Set<string>; probes: Set<string> } {
  const ctx: Ctx = { root, errors: [], read: new Set(), probes: new Set() };
  const md = createMd();
  // 손으로 고치는 파일이라 모양이 틀릴 수 있다 → 그 칸만 비우고 errors 에 남긴다 (빌드는 계속)
  const guard = <T>(file: string, fallback: T, fn: () => T): T => {
    try {
      return fn();
    } catch {
      ctx.errors.push(`${file} 형식 오류`);
      return fallback;
    }
  };

  const handoffSrc = readText(ctx, FILES.handoff);
  const ho = handoffSrc === null ? null : guard(FILES.handoff, null, () => parseHandoff(handoffSrc, md));
  const rj = readJson<RoadmapJson>(ctx, FILES.roadmap);
  const roadmap = rj === null ? null : guard(FILES.roadmap, null, () => parseRoadmap(rj, ho?.phaseLine ?? ''));

  const sliceList = listDir(ctx, 'docs/slices', '.md').sort((a, b) => {
    const n = (f: string) => Number(/^(\d+)/.exec(path.posix.basename(f))?.[1] ?? -1);
    return n(a) - n(b) || a.localeCompare(b);
  });
  // 진행 현황 = 번호가 가장 큰 것 · 보드 = 번호가 있는 것 전부
  const slices = new Map<string, SliceFile>();
  let slice: Slice | null = null;
  for (const f of sliceList) {
    const src = readText(ctx, f);
    const s = src === null ? null : guard(f, null, () => parseSlice(f, src, md));
    if (src === null || s === null) continue;
    slice = s;
    const num = /^(\d+)/.exec(path.posix.basename(f))?.[1];
    if (num && !slices.has(sliceKey(num))) slices.set(sliceKey(num), { slice: s, src });
  }

  const adrSrc = new Map<string, string>();
  const adrs = listDir(ctx, 'docs/adr', '.md')
    .map((f) => {
      const s = readText(ctx, f);
      const a = s === null ? null : guard(f, null, () => parseAdr(f, s, md));
      if (a && s !== null) adrSrc.set(a.key, s);
      return a;
    })
    .filter((a): a is Adr => a !== null);

  const board = guard('보드(HANDOFF · roadmap · slices)', { cards: [] } as Board, () =>
    buildBoard(md, handoffSrc, roadmap, slices, adrSrc),
  );

  const agents = readText(ctx, FILES.agents);
  const stack = guard('구성(package.json · AGENTS.md · pyproject.toml · CI)', EMPTY_STACK, () => buildStack(ctx, agents, roadmap));

  const exist = Object.fromEntries(ARCH_PATHS.map((p) => [p, exists(ctx, p)])) as Record<ArchPath, boolean>;

  const reportSrc = readText(ctx, FILES.report);
  const report = reportSrc === null ? null : { title: /<title>([^<]*)<\/title>/i.exec(reportSrc)?.[1].trim() ?? null, bytes: Buffer.byteLength(reportSrc) };

  return {
    data: { errors: ctx.errors, handoff: ho?.data ?? null, roadmap, board, slice, adrs, exists: exist, stack, report },
    report: reportSrc === null ? null : reportHtml(reportSrc),
    files: ctx.read,
    probes: ctx.probes,
  };
}

// ---------- Vite ----------

export default function brewaiDocs(): Plugin {
  let root = '';
  let cache: ReturnType<typeof collectDocs> | null = null;
  const get = () => (cache ??= collectDocs(root));

  return {
    name: 'brewai-docs',
    configResolved(c) {
      root = path.resolve(c.root, '../..'); // apps/admin → 레포 루트
    },
    resolveId(id) {
      if (id === ID || id === REPORT_ID) return `\0${id}`;
    },
    load(id) {
      if (id === `\0${ID}`) return `export default ${JSON.stringify(get().data)};`;
      if (id === `\0${REPORT_ID}`) return `export default ${JSON.stringify(get().report ?? '')};`;
    },
    configureServer(server: ViteDevServer) {
      const watched = () => {
        const set = new Set([...Object.values(FILES), ...get().files, ...get().probes, ...DIRS.map((d) => d.dir)]);
        return [...set].map((rel) => path.join(root, ...rel.split('/')));
      };
      server.watcher.add(watched());
      const relOf = (file: string) => path.relative(root, file).split(path.sep).join('/');
      const isOurs = (rel: string) => {
        if (!cache) return false;
        // probes 는 경로 자체만 (그 폴더 안의 소스 수정은 HMR 에 맡긴다 → Fast Refresh 상태 유지)
        if (cache.files.has(rel) || cache.probes.has(rel) || (Object.values(FILES) as string[]).includes(rel)) return true;
        if (DIRS.some((d) => rel === d.dir || (rel.startsWith(`${d.dir}/`) && rel.endsWith(d.ext) && !rel.slice(d.dir.length + 1).includes('/')))) return true;
        return false;
      };
      let timer: ReturnType<typeof setTimeout> | undefined;
      server.watcher.on('all', (_event, file) => {
        const rel = relOf(file);
        if (rel.startsWith('..') || !isOurs(rel)) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
          cache = null;
          const graph = server.environments?.client?.moduleGraph;
          for (const id of [`\0${ID}`, `\0${REPORT_ID}`]) {
            const mod = graph?.getModuleById(id);
            if (mod) graph!.invalidateModule(mod);
          }
          server.watcher.add(watched()); // 새로 생긴 ADR 등
          server.ws.send({ type: 'full-reload' });
          server.config.logger.info(`문서 다시 읽음: ${rel}`, { timestamp: true });
        }, 80);
      });
    },
  };
}
