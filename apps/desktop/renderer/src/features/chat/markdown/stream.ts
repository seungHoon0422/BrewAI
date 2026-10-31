// 흐르는 중인 마크다운 → 화면에 그려도 되는 마크다운. 순수 함수 (React · DOM 없음 · e2e/chat-markdown.spec 이 바로 부른다).
// 목표: 흐르는 동안 마크다운 문법 글자(| --- | · ** · ``` · ## …)가 날것으로 보이지 않게.
//   1) 닫히지 않은 코드 펜스(```)는 끝에 닫는 줄을 붙인다 → 코드 상자로 바로 (생성형 UI 블록은 openFence 로 '덜 옴' 을 알린다)
//   2) 마지막 줄이 블록 기호만 있는 줄(# · - · 1. · > · | · `` …)이면 다음 조각이 올 때까지 잠깐 숨긴다
//   3) 표: 머리 줄(| a | b |)만 왔으면 구분 줄(| --- | --- |)을 지어 붙인다 · 쓰다 만 구분 줄은 다 쓴 것으로 바꾼다
//      → 머리 줄이 오는 순간 표로 그려지고, 쓰다 만 마지막 줄도 표의 한 줄로 보인다
//   4) 마지막 문단의 닫히지 않은 **, *, _, ~~, `, [글](주소 는 화면에서만 닫는다 (뒤에 글이 없으면 기호를 숨긴다)
//      · 아직 링크가 될지 모르는 [ 와 줄 끝의 [글] 은 괄호만 잠깐 숨긴다
// 끝난 답은 원문 그대로 그린다 (이 함수를 거치지 않는다) — 여기서 고친 모양은 끝난 모양과 같아야 한다.

export type Safe = {
  text: string;
  // 닫히지 않아 화면에서 닫은 펜스의 info (예: 'ts' · 'ui:chart'). null = 열린 펜스 없음
  openFence: string | null;
};

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
// 블록 기호만 있는 줄 (아직 무엇이 될지 모른다): # · ## · - · * · + · 1 · 1. · 2) · > · | · `` · ~~ · = · _
const MARKER_ONLY = /^ {0,3}(?:[#>|=+*_~`-]{1,6}|\d{1,9}[.)]?)\s*$/;
const PIPE_ROW = /^ {0,3}\|/;
// 새 블록을 여는 줄 (앞 줄과 한 문단이 아니다) · 한 줄로 끝나는 블록 (뒤 줄과 한 문단이 아니다)
const BLOCK_START = /^ {0,3}(?:#{1,6}(?:\s|$)|[-*+]\s|\d{1,9}[.)]\s|>|\||`{3,}|~{3,})/;
const ONE_LINE_BLOCK = /^ {0,3}(?:#{1,6}(?:\s|$)|\||[-*_](?:\s*[-*_]){2,}\s*$)/;
// 구분 줄 (다 쓴 것 · 쓰다 만 것 모두): 파이프 · 대시 · 콜론 · 공백만, 대시가 하나 이상 또는 파이프로 시작
const DELIM_LIKE = /^ {0,3}(?=.*[-|])[\s|:-]+$/;

// 표 한 줄의 칸 수 (앞뒤 파이프는 칸이 아니다 · \| 는 글자)
export function cellCount(row: string): number {
  const s = row.trim();
  let n = 1;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === '|') n++;
  }
  if (s.startsWith('|')) n--;
  if (s.length > 1 && s.endsWith('|') && !s.endsWith('\\|')) n--;
  return Math.max(1, n);
}

const delimRow = (cols: number) => `|${' --- |'.repeat(cols)}`;

export function streamSafe(src: string): Safe {
  const lines = src.replace(/\r\n?/g, '\n').split('\n'); // CRLF → LF (marked 도 이렇게 읽는다)

  // 1) 코드 펜스 — 열린 채 끝나면 닫아 준다 (코드 안은 다른 손질을 하지 않는다)
  let fence: { mark: string; info: string; line: number } | null = null;
  lines.forEach((line, i) => {
    const m = FENCE.exec(line);
    if (!m) return;
    if (!fence) {
      if (m[1][0] === '`' && m[2].includes('`')) return; // ```a``` 는 펜스가 아니다
      fence = { mark: m[1], info: m[2].trim(), line: i };
    } else if (m[1][0] === fence.mark[0] && m[1].length >= fence.mark.length && !m[2].trim()) {
      fence = null;
    }
  });
  if (fence) {
    const f = fence as { mark: string; info: string; line: number };
    const body = lines.slice();
    const last = body.at(-1) ?? '';
    // 쓰다 만 닫는 펜스(` · ``)는 숨긴다
    if (body.length - 1 > f.line && /^ {0,3}(`{1,}|~{1,})$/.test(last) && last.trim()[0] === f.mark[0]) body.pop();
    return { text: `${body.join('\n')}\n${f.mark}`, openFence: f.info };
  }

  // 2) 블록 기호만 있는 마지막 줄은 잠깐 숨긴다
  if (lines.length && MARKER_ONLY.test(lines[lines.length - 1])) lines[lines.length - 1] = '';

  // 4) 마지막 문단의 닫히지 않은 인라인 기호 (표 줄이면 마지막 칸만 — 앞 칸은 다 썼다)
  //    문단 = 빈 줄 · 블록 시작 줄 뒤로 이어진 줄들 (**굵게 가 줄을 넘어가도 닫는다) · 끝의 줄바꿈만 온 상태면 그 앞 줄까지
  let li = lines.length - 1;
  if (li > 0 && lines[li] === '') li--;
  if (li >= 0 && lines[li] && !DELIM_LIKE.test(lines[li])) {
    const line = lines[li];
    if (PIPE_ROW.test(line)) {
      const cut = lastCellStart(line);
      lines[li] = line.slice(0, cut) + closeInline(line.slice(cut));
      if (!/[^|\s]/.test(lines[li])) lines[li] = ''; // 아직 글이 없는 줄 = 빈 칸 줄을 그리지 않는다
    } else {
      let start = li;
      while (start > 0 && lines[start - 1].trim() && !BLOCK_START.test(lines[start]) && !ONE_LINE_BLOCK.test(lines[start - 1])) start--;
      lines.splice(start, li - start + 1, ...closeInline(lines.slice(start, li + 1).join('\n')).split('\n'));
    }
  }

  // 3) 표 — 머리 줄만 왔으면 구분 줄을 짓는다
  const isRow = (i: number) => i >= 0 && PIPE_ROW.test(lines[i]);
  const isDelim = (i: number) => i >= 0 && DELIM_LIKE.test(lines[i]) && /-|\|/.test(lines[i]);
  // 끝의 빈 줄(줄바꿈만 온 상태)은 표 판단에서 뺀다
  let end = lines.length - 1;
  if (end >= 0 && lines[end] === '' && end > 0) end--;
  const startsTable = (h: number) => isRow(h) && !isRow(h - 1) && !isDelim(h - 1);
  if (startsTable(end)) {
    // 머리 줄이 마지막 → 구분 줄을 바로 아래에
    lines.splice(end + 1, lines.length - end - 1, delimRow(cellCount(lines[end])));
  } else if (end > 0 && isDelim(end) && (startsTable(end - 1) || (lines[end - 1].includes('|') && !isRow(end - 2) && !isDelim(end - 2)))) {
    // (앞 파이프 없는 머리 줄 'a | b' 도 구분 줄이 오기 시작하면 표로)
    // 쓰다 만 구분 줄 → 머리 줄 칸 수에 맞춘 구분 줄
    const cols = cellCount(lines[end - 1]);
    if (cellCount(lines[end]) !== cols || !/-/.test(lines[end]) || end === lines.length - 1) {
      lines.splice(end, lines.length - end, delimRow(cols));
    }
  }

  return { text: lines.join('\n'), openFence: null };
}

// 마지막 칸이 시작하는 곳 (마지막 '|' 바로 뒤 · 끝이 '|' 면 그 줄은 다 쓴 줄)
function lastCellStart(row: string): number {
  let at = 0;
  for (let i = 0; i < row.length; i++) {
    if (row[i] === '\\') i++;
    else if (row[i] === '|') at = i + 1;
  }
  return at;
}

const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
const ASCII_WORD = /[A-Za-z0-9]/;
const WORD = /[\p{L}\p{N}]/u;

type Open = { mark: string; at: number };

// 한 문단(줄바꿈 포함) 안의 닫히지 않은 인라인 기호를 닫는다. 기호 뒤에 아직 글이 없으면 기호를 지운다.
export function closeInline(line: string): string {
  const stack: Open[] = [];
  let code: Open | null = null; // 열린 `코드`
  let link: number | null = null; // '](' 뒤 열린 주소 괄호의 위치
  const brackets: number[] = []; // 아직 안 닫힌 '['
  const hide: number[] = []; // 화면에서만 숨길 괄호 자리
  for (let i = 0; i < line.length; ) {
    const c = line[i];
    if (c === '\\' && !code) {
      i += 2;
      continue;
    }
    if (c === '`') {
      let j = i;
      while (line[j] === '`') j++;
      const run = line.slice(i, j);
      if (!code) code = { mark: run, at: i };
      else if (code.mark === run) code = null;
      i = j;
      continue;
    }
    if (code) {
      i++;
      continue;
    }
    if (c === '[') {
      brackets.push(i);
      i++;
      continue;
    }
    if (c === ']' && brackets.length) {
      const open = brackets.pop()!;
      if (line[i + 1] === '(') {
        link = i + 1;
        i += 2;
        continue;
      }
      if (i === line.length - 1) hide.push(open, i); // 줄 끝 '[글]' = 곧 '(' 가 올 수 있다
      i++;
      continue;
    }
    if (c === ')' && link !== null) {
      link = null;
      i++;
      continue;
    }
    if (link !== null) {
      i++;
      continue;
    }
    if (c === '*' || c === '_' || c === '~') {
      let j = i;
      while (line[j] === c) j++;
      let run = line.slice(i, j);
      const prev = line[i - 1];
      const next = line[j];
      i = j;
      if (c === '~' && run.length !== 2) continue; // 1~3 같은 물결은 글자
      if (run.length > 3) run = run.slice(0, 3);
      // 줄 맨 앞 '* ' = 목록 기호
      if (c === '*' && run.length === 1 && line.slice(line.lastIndexOf('\n', j - 2) + 1, j - 1).trim() === '' && next !== undefined && /\s/.test(next)) continue;
      const top = stack.at(-1);
      const canClose = !isSpace(prev) && !(c === '_' && next !== undefined && WORD.test(next));
      if (canClose && top?.mark === run) {
        stack.pop();
        continue;
      }
      // 여는 기호 = 뒤가 글자(또는 줄 끝: 아직 안 옴) · 앞이 영문 · 숫자가 아님 (2**10 은 글자) · _ 는 낱말 안이 아님
      const canOpen = (next === undefined || !isSpace(next))
        && !(prev !== undefined && (c === '_' ? WORD.test(prev) : ASCII_WORD.test(prev)));
      if (canOpen) stack.push({ mark: run, at: j - run.length });
      continue;
    }
    i++;
  }

  hide.push(...brackets);
  let out = line;
  // 열린 코드: 뒤에 글이 있으면 닫고, 없으면 기호를 숨긴다
  if (code) {
    const c = code as Open;
    const rest = out.slice(c.at + c.mark.length);
    if (rest.trim()) return closeInline(out.slice(0, c.at)) + c.mark + rest + c.mark;
    return closeInline(out.slice(0, c.at));
  }
  if (link !== null) out += ')';
  else {
    // 괄호 숨기기 (뒤에서부터 — 앞 자리가 밀리지 않게). 강조 기호 자리보다 뒤의 괄호만 영향
    for (const k of [...hide].sort((x, y) => y - x)) {
      out = out.slice(0, k) + out.slice(k + 1);
      for (const o of stack) if (o.at > k) o.at--;
    }
  }
  for (let k = stack.length - 1; k >= 0; k--) {
    const o = stack[k];
    const rest = out.slice(o.at + o.mark.length);
    if (!rest.trim()) {
      out = out.slice(0, o.at);
      continue;
    }
    // 닫는 기호는 끝 공백 앞에 (뒤가 공백이면 닫는 기호로 안 읽힌다)
    const body = out.replace(/\s+$/, '');
    out = body + o.mark + out.slice(body.length);
  }
  return out;
}
