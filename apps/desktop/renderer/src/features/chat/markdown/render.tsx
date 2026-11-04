// 마크다운 → React 요소 (innerHTML 없음 · 날것 HTML 은 글자로). 답 글 · 생각 글이 같이 쓴다.
// 흐르는 중(live): stream.ts 손질 + 일정한 속도로 펼침(reveal.ts) + 새로 보이는 낱말이 흐릿하게 떠오른다 (끝 두 블록만).
// 링크 = https 만 <a target=_blank> (main 이 시스템 브라우저로 연다) · 그 밖은 글자. 이미지 = 대체 글.
// 생성형 UI 자리: ```ui:<이름> 펜스 = UI_BLOCKS 의 부품. 덜 왔으면 placeholder(뼈대) · 다 오면 render (지금은 등록된 블록 없음).
import { Fragment, memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { IconButton, Skeleton, cx } from '@brewai/ui';
import { reduceMotion } from '../../../lib/hooks';
import { MD } from '../copy';
import { parse, type Token, type Tokens } from './parse';
import { useReveal } from './reveal';

export type UiBlock = { placeholder?: (info: string) => ReactNode; render: (body: string, info: string) => ReactNode };
// 생성형 UI 블록 (펜스 info 의 첫 낱말 → 부품). 예: 'ui:chart' — 부품이 생기면 여기에 하나씩
export const UI_BLOCKS: Record<string, UiBlock> = {};
const uiBlock = (info: string | undefined) => (info ? UI_BLOCKS[info.split(/\s+/)[0]] : undefined);

// 링크 글이 주소 모양인가 (자동 링크 · 'www.' · 'example.com/…')
const RAW_URL = /^(?:https?:\/\/|www\.)\S+$|^[a-z0-9-]+(?:\.[a-z0-9-]+)+\/\S*$/i;
export const hostOf = (href: string): string => {
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const FADE_BLOCKS = 2; // 끝에서 몇 블록까지 낱말 떠오름 (앞 블록은 다 보인 글 → 평범한 글자)

export function Markdown({ id, text, live = false, smooth = live, className }: {
  id?: string; // 글 조각 id (펼친 자리를 다시 그려도 잇는다)
  text: string;
  live?: boolean; // 아직 흐르는 중 (stream 손질)
  smooth?: boolean; // 펼침 + 떠오름 (생각 글은 끔)
  className?: string;
}) {
  const motion = smooth && live && !reduceMotion();
  const { shown, flush } = useReveal(text, motion, id);
  const doc = useMemo(() => parse(shown, live), [shown, live]);

  // 사용자가 읽으려 들면 (스크롤 · 복사 · 선택) 기다리게 하지 않는다
  useEffect(() => {
    if (!motion) return;
    const go = () => flush();
    document.addEventListener('copy', go);
    window.addEventListener('wheel', go, { passive: true });
    return () => {
      document.removeEventListener('copy', go);
      window.removeEventListener('wheel', go);
    };
  }, [motion, flush]);

  const n = doc.blocks.length;
  return (
    <div className={cx('md', className)} data-live={live || undefined} onPointerDown={motion ? flush : undefined}>
      {doc.blocks.map((t, i) => (
        <Block key={i} token={t} fade={motion && i >= n - FADE_BLOCKS} pending={live && doc.openFence !== null && i === n - 1} />
      ))}
    </div>
  );
}

// 블록 하나 — 원문(raw)이 같으면 다시 그리지 않는다 (흐르는 중 앞 블록은 그대로)
const Block = memo(function Block({ token, fade, pending }: { token: Token; fade: boolean; pending: boolean }) {
  return <>{block(token, { fade, pending })}</>;
}, (a, b) => a.token.raw === b.token.raw && a.fade === b.fade && a.pending === b.pending);

type Ctx = { fade: boolean; pending: boolean };

function block(t: Token, c: Ctx): ReactNode {
  switch (t.type) {
    case 'paragraph':
      return <p>{inline((t as Tokens.Paragraph).tokens, c)}</p>;
    case 'heading': {
      // 화면의 h1 = 대화 제목 하나 → 답의 # 은 h2 부터
      const h = t as Tokens.Heading;
      const H = `h${Math.min(6, h.depth + 1)}` as 'h2';
      return <H>{inline(h.tokens, c)}</H>;
    }
    case 'list': {
      const l = t as Tokens.List;
      const items = l.items.map((it, i) => (
        <li key={i} className={it.task ? 'task' : undefined}>
          {it.task && <input type="checkbox" checked={!!it.checked} disabled readOnly aria-hidden="true" />}
          {blocks(it.tokens, c)}
        </li>
      ));
      return l.ordered ? <ol start={typeof l.start === 'number' && l.start !== 1 ? l.start : undefined}>{items}</ol> : <ul>{items}</ul>;
    }
    case 'code': {
      const k = t as Tokens.Code;
      const ui = uiBlock(k.lang);
      if (ui) return c.pending ? <div className="md-ui" data-pending="">{ui.placeholder?.(k.lang ?? '') ?? <Skeleton lines={3} />}</div> : <div className="md-ui">{ui.render(k.text, k.lang ?? '')}</div>;
      return <CodeBlock code={k.text} lang={k.lang ?? ''} />;
    }
    case 'blockquote':
      return <blockquote>{blocks((t as Tokens.Blockquote).tokens, c)}</blockquote>;
    case 'hr':
      return <hr />;
    case 'table': {
      // 칸 · 머리 모두 왼쪽 정렬로 통일 (마크다운의 :---: 정렬 표시는 따르지 않는다 · 앱의 표와 같은 규칙)
      const tb = t as Tokens.Table;
      return (
        <div className="md-table ui-scroll">
          <table>
            <thead>
              <tr>{tb.header.map((h, i) => <th key={i}>{inline(h.tokens, c)}</th>)}</tr>
            </thead>
            {tb.rows.length > 0 && (
              <tbody>
                {tb.rows.map((r, i) => (
                  <tr key={i}>{r.map((cell, j) => <td key={j}>{inline(cell.tokens, c)}</td>)}</tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
      );
    }
    case 'text': {
      // 목록 안 짧은 글 (tight list) = 인라인 토큰을 품는다
      const x = t as Tokens.Text;
      return x.tokens ? inline(x.tokens, c) : words(decode(x.text), c);
    }
    case 'html':
      return <p>{(t as Tokens.HTML).text}</p>; // 날것 HTML = 글자 그대로 (실행 · 해석 안 함)
    default:
      return null;
  }
}

function blocks(ts: Token[], c: Ctx): ReactNode {
  return ts.map((t, i) => <Fragment key={i}>{block(t, c)}</Fragment>);
}

function inline(ts: Token[] | undefined, c: Ctx): ReactNode {
  if (!ts) return null;
  return ts.map((t, i) => <Fragment key={i}>{span(t, c)}</Fragment>);
}

function span(t: Token, c: Ctx): ReactNode {
  switch (t.type) {
    case 'text': {
      const x = t as Tokens.Text;
      return x.tokens ? inline(x.tokens, c) : words(decode(x.text), c);
    }
    case 'escape':
      return (t as Tokens.Escape).text;
    case 'strong':
      return <strong>{inline((t as Tokens.Strong).tokens, c)}</strong>;
    case 'em':
      return <em>{inline((t as Tokens.Em).tokens, c)}</em>;
    case 'del':
      return <del>{inline((t as Tokens.Del).tokens, c)}</del>;
    case 'codespan':
      return <code>{(t as Tokens.Codespan).text}</code>; // 코드 안 &lt; 는 글자 그대로 (CommonMark)
    case 'br':
      return <br />;
    case 'link': {
      // 주소 글자를 그대로 늘어놓지 않는다: 글이 주소 자체(자동 링크 · www.…)면 사이트 이름만 · 아니면 글 + 옅은 사이트 이름 (전체 주소 = 마우스)
      const l = t as Tokens.Link;
      if (!/^https:\/\//i.test(l.href)) return <span className="md-link-off">{inline(l.tokens, c)}</span>;
      const host = hostOf(l.href);
      const bare = RAW_URL.test(l.text.trim());
      return (
        <a className="md-link" href={l.href} target="_blank" rel="noopener noreferrer" title={l.title ?? l.href} data-host={host || undefined}>
          {bare ? host || l.href : inline(l.tokens, c)}
          {!bare && host && <span className="md-link-host">{host}</span>}
        </a>
      );
    }
    case 'image':
      return <span className="md-img">{(t as Tokens.Image).text}</span>; // 바깥 이미지는 불러오지 않는다 (CSP)
    case 'html': {
      // <br> 만 줄바꿈으로 (표 칸 안에서 자주 쓴다) · 그 밖의 HTML 은 글자 그대로
      const tag = (t as Tokens.Tag).text;
      return /^<br\s*\/?>$/i.test(tag) ? <br /> : tag;
    }
    case 'checkbox':
      return null;
    default:
      return (t as Tokens.Generic).raw ?? null;
  }
}

// 낱말마다 span — 새로 붙은 낱말만 떠오른다 (자리 = 순번이라 앞 낱말은 다시 그리지 않는다)
function words(text: string, c: Ctx): ReactNode {
  if (!c.fade) return text;
  const parts = text.match(/\S+\s*|\s+/g) ?? [];
  return parts.map((w, i) => <span key={i} className="md-w">{w}</span>);
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function decode(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return ENTITY[e.toLowerCase()] ?? m;
  });
}

const COPIED_MS = 1600;

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <div className="md-code">
      <div className="md-code-head">
        <span className="md-lang">{lang.split(/\s+/)[0] || MD.code}</span>
        <IconButton icon={copied ? 'check' : 'copy'} size="sm" label={copied ? MD.copied : MD.copyCode}
          onClick={() => void copyText(code).then(() => setCopied(true))} />
      </div>
      <pre className="ui-scroll"><code>{code}</code></pre>
    </div>
  );
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch {}
    ta.remove();
  }
}
