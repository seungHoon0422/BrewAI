import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';

// UI 문구 규칙 (AGENTS.md 사용자와 소통): 가운뎃점(·) 같은 구분 글자를 쓰지 않는다 — 칸 나눔(여백) 또는 쉼표.
// 닮은 글자도 같이 본다: U+00B7 가운뎃점 · U+2027 하이픈 점 · U+30FB 가타카나 가운뎃점 · U+2022 불릿
export const SEPARATOR = /[·‧・•]/;

const ROOT = path.resolve(__dirname, '..');
// 화면 코드가 사는 곳. copy.ts 만이 아니라 .ts · .tsx 전부 (JSX 글 · aria-label · title · join 구분자도 문구다)
const COPY_ROOTS = ['apps/desktop/renderer/src', 'apps/admin/src', 'packages/ui/src'];

function walk(dir: string, out: string[]) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else if (/\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

export const copyFiles = () => COPY_ROOTS.flatMap((r) => walk(path.join(ROOT, r), []));

// 정규식 리터럴이 올 수 있는 자리 (공백 뺀 바로 앞). 그 밖의 / 는 나눗셈 · JSX 닫는 태그(</p>)
const REGEX_BEFORE = /(?:[(,=:[!&|?{};+\-*%~^]|\breturn)$|^$/;

// 주석만 빈칸으로 (줄 번호 유지). 문자열 · 템플릿 · 정규식 안의 // 는 그대로 둔다 (정규식 안의 ` ' " 는 따옴표가 아니다)
export function stripComments(src: string): string {
  let out = '';
  let quote = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      out += c;
      if (c === '\\') { out += src[++i] ?? ''; continue; }
      if (c === quote || (c === '\n' && quote !== '`')) quote = '';
      continue;
    }
    if (c === '/' && src[i + 1] !== '/' && src[i + 1] !== '*' && REGEX_BEFORE.test(out.trimEnd().slice(-8))) {
      // 정규식 리터럴: 닫는 / 까지 (\ 이스케이프 · [] 안의 / 는 건너뛴다)
      let j = i + 1;
      let cls = false;
      for (; j < src.length && src[j] !== '\n'; j++) {
        if (src[j] === '\\') { j++; continue; }
        if (src[j] === '[') cls = true;
        else if (src[j] === ']') cls = false;
        else if (src[j] === '/' && !cls) break;
      }
      out += src.slice(i, j + 1);
      i = j;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      const stop = end < 0 ? src.length : end;
      out += ' '.repeat(stop - i);
      i = stop - 1;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop - 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    out += c;
  }
  return out;
}

// 화면 코드(주석 뺀 곳)에 든 구분 글자 → '파일:줄: 그 줄'
export function separatorsInCopy(): string[] {
  const hits: string[] = [];
  for (const file of copyFiles()) {
    const src = fs.readFileSync(file, 'utf8');
    const code = stripComments(src).split('\n');
    src.split('\n').forEach((line, i) => {
      if (SEPARATOR.test(code[i] ?? '')) hits.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
    });
  }
  return hits;
}

// 지금 화면의 글 + 읽히는 속성(aria-label · title · placeholder · alt)에 든 구분 글자 → 조각 목록.
// 코드 상자 · 인라인 코드는 뺀다 (거기선 기호가 글자다)
export function separatorsOnScreen(page: Page): Promise<string[]> {
  return page.evaluate((raw) => {
    const re = new RegExp(raw);
    const hits: string[] = re.test(document.title) ? [`title: ${document.title}`] : [];
    const skip =(el: Element | null) => !!el?.closest('pre, code, .md-code, script, style');
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.textContent ?? '';
      if (re.test(t) && !skip(n.parentElement)) hits.push(`text: ${t.trim().slice(0, 80)}`);
    }
    for (const el of document.body.querySelectorAll('[aria-label], [title], [placeholder], [alt]')) {
      if (skip(el)) continue;
      for (const a of ['aria-label', 'title', 'placeholder', 'alt']) {
        const v = el.getAttribute(a);
        if (v && re.test(v)) hits.push(`${a}: ${v.slice(0, 80)}`);
      }
    }
    return hits;
  }, SEPARATOR.source);
}
