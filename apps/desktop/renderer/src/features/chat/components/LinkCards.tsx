// 답 아래 링크 카드 (2026-11-04 사용자: 주소를 늘어놓지 말고 썸네일 + 제목) — 답 글에 나온 https 주소 앞 4개 (같은 주소 한 번).
// 미리보기 = conductor GET /api/links/preview (제목 · 설명 · 사이트 · 그림 · SSRF 검사 · linkpreview.py) · 그림 = 우리 API 로 받아 data: (CSP).
// 받는 동안 뼈대 · 못 만들면(없음 · 막힘 · 한도) 그 카드는 안 그린다. 누르면 다른 링크처럼 시스템 브라우저 (main 이 연다).
import { useEffect, useState } from 'react';
import { Icon, Skeleton } from '@brewai/ui';
import { call, isObj, json, strOrNull } from '../../../lib/api';
import { dataUrl } from '../../files/api';
import { hostOf } from '../markdown/render';
import '../links.css';

const MAX_CARDS = 4;
const LINKS = { label: '답에 나온 링크' } as const;

type Card = { url: string; title: string; description: string | null; site: string | null; image: string | null };

// 마크다운 링크 [글](주소) · 맨 주소 — https 만 (render.tsx 가 링크로 그리는 것과 같게) · 끝 문장 부호 · #조각 뺌
const MD_LINK = /\]\((https:\/\/[^)\s]+)\)/g;
const BARE = /https:\/\/[^\s<>()[\]"'`]+/g;
export function linksOf(texts: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of texts) {
    for (const raw of [...[...t.matchAll(MD_LINK)].map((m) => m[1]), ...(t.match(BARE) ?? [])]) {
      const url = raw.replace(/[.,;:!?'"]+$/, '').split('#')[0];
      if (!hostOf(url) || seen.has(url)) continue;
      seen.add(url);
      out.push(url);
    }
  }
  return out.slice(0, MAX_CARDS);
}

// 앱이 켜 있는 동안 주소마다 한 번 (같은 대화를 다시 열어도 다시 안 부른다)
const cards = new Map<string, Promise<Card | null>>();
function cardOf(url: string): Promise<Card | null> {
  let p = cards.get(url);
  if (!p) {
    p = json(`/api/links/preview?url=${encodeURIComponent(url)}`).then(async (d) => {
      if (!isObj(d) || typeof d.title !== 'string' || !d.title) return null;
      const img = strOrNull(d.image);
      const image = img && img.startsWith('/api/links/image/') ? await call(img).then((r) => r.blob()).then(dataUrl).catch(() => null) : null;
      return { url, title: d.title, description: strOrNull(d.description), site: strOrNull(d.site), image };
    }).catch(() => null);
    cards.set(url, p);
  }
  return p;
}

function LinkCard({ url }: { url: string }) {
  const [card, setCard] = useState<Card | null | undefined>(undefined); // undefined = 받는 중
  useEffect(() => {
    let live = true;
    void cardOf(url).then((c) => live && setCard(c));
    return () => {
      live = false;
    };
  }, [url]);
  if (card === null) return null;
  const host = hostOf(url);
  if (card === undefined) {
    return (
      <li className="lk-card" data-state="loading" aria-hidden="true">
        <span className="lk-thumb"><Skeleton height="100%" radius="md" /></span>
        <span className="lk-body"><Skeleton lines={2} /></span>
      </li>
    );
  }
  return (
    <li className="lk-card" data-state="ready" data-url={url}>
      <a href={url} target="_blank" rel="noopener noreferrer" title={url}>
        <span className="lk-thumb">{card.image ? <img src={card.image} alt="" /> : <Icon name="link" size="sm" />}</span>
        <span className="lk-body">
          <b className="lk-title">{card.title}</b>
          {card.description && <span className="lk-desc">{card.description}</span>}
          <span className="lk-site">{card.site && card.site !== host ? `${card.site}, ${host}` : host}</span>
        </span>
      </a>
    </li>
  );
}

// texts = 답 글 조각 · live = 아직 흐르는 중 (다 쓴 뒤에만 부른다)
export function LinkCards({ texts, live }: { texts: readonly string[]; live: boolean }) {
  if (live) return null;
  const urls = linksOf(texts);
  if (!urls.length) return null;
  return <ul className="lk-list" aria-label={LINKS.label}>{urls.map((u) => <LinkCard key={u} url={u} />)}</ul>;
}
