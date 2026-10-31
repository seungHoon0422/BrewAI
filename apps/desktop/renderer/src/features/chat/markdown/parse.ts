// 마크다운 글 → 블록 토큰 (marked 의 lexer 만 쓴다 · HTML 을 만들지 않는다 → render.tsx 가 React 요소로 그린다).
// 흐르는 중(live)이면 stream.ts 로 먼저 손질해 날것의 문법 글자가 보이지 않게 한다.
import { Lexer, type Token, type Tokens } from 'marked';
import { streamSafe } from './stream';

export type { Token, Tokens };

export type Doc = {
  blocks: Token[];
  // 흐르는 중 화면에서 닫은 코드 펜스의 info (마지막 블록이 덜 온 코드 · 생성형 UI 블록) · null = 없음
  openFence: string | null;
};

// GFM (표 · 취소선 · 자동 링크) + 줄바꿈 하나도 줄바꿈 (채팅 답은 문단 안 줄바꿈을 그대로 보여 준다)
const OPTIONS = { gfm: true, breaks: true } as const;

export function parse(text: string, live = false): Doc {
  const safe = live ? streamSafe(text) : { text, openFence: null };
  const blocks = new Lexer(OPTIONS).lex(safe.text).filter((t) => t.type !== 'space' && t.type !== 'def');
  return { blocks, openFence: safe.openFence };
}

// 토큰 → 글만 (스크린 리더 · 테스트 · 복사)
export function plainText(tokens: readonly Token[]): string {
  return tokens.map((t) => {
    const g = t as Tokens.Generic;
    if (t.type === 'table') {
      const tb = t as Tokens.Table;
      return [tb.header, ...tb.rows].map((r) => r.map((c) => plainText(c.tokens)).join(' ')).join('\n');
    }
    if (t.type === 'list') return (t as Tokens.List).items.map((i) => plainText(i.tokens)).join('\n');
    if (Array.isArray(g.tokens)) return plainText(g.tokens);
    return typeof g.text === 'string' ? g.text : '';
  }).join('');
}
