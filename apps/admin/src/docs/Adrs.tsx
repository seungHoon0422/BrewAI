import { useEffect, useRef } from 'react';
import { Rich, Sources, St, type Tone } from './parts';
import type { Adr } from './types';

const TONE: Record<string, Tone> = { 확정: 'on', 제안: 'now', 폐기: 'off', 대체: 'off' };
export const adrTone = (s: string | null): Tone => (s && TONE[s]) || 'off';

// 결정 기록 = docs/adr/*.md. 목록 → 고른 것 (#/docs/adr/0007). 번호가 없으면 가장 최근 것
export default function Adrs({ adrs, sel }: { adrs: Adr[]; sel: string | null }) {
  const cur = sel === null ? adrs.at(-1) : adrs.find((a) => a.key === sel);
  const docRef = useRef<HTMLElement>(null);
  const first = useRef(true);

  useEffect(() => {
    // 좁은 화면(목록 위 · 본문 아래)에서 다른 것을 고르면 본문으로 내려간다
    if (first.current) {
      first.current = false;
      return;
    }
    if (window.matchMedia('(max-width: 760px)').matches) docRef.current?.scrollIntoView({ block: 'start' });
  }, [sel]);

  if (adrs.length === 0) return <p className="missing">docs/adr/ 에 결정 기록이 없습니다.</p>;

  return (
    <>
      <div className="adr">
        <nav aria-label="결정 기록 목록">
          <ol className="adr-list">
            {adrs.map((a) => (
              <li key={a.key}>
                <a href={`#/docs/adr/${a.key}`} aria-current={a === cur ? 'true' : undefined}>
                  <span className="num">{a.key}</span>
                  <span className="t">{a.title}</span>
                  <span className="m">
                    {a.status && <St tone={adrTone(a.status)}>{a.status}</St>}
                    {a.date && <time dateTime={a.date}>{a.date}</time>}
                  </span>
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <article ref={docRef} className="adr-doc" aria-labelledby="adr-title">
          {cur ? (
            <>
              <header>
                <span className="rid">ADR-{cur.key}</span>
                <h2 id="adr-title">{cur.title}</h2>
                <p className="adr-meta">
                  {cur.status && <St tone={adrTone(cur.status)}>{cur.status}</St>}
                  {cur.date && <time dateTime={cur.date}>{cur.date}</time>}
                  {cur.note && <Rich html={cur.note} />}
                </p>
              </header>
              <Rich as="div" className="md" html={cur.html} />
              <Sources files={[cur.file]} />
            </>
          ) : (
            <h2 id="adr-title" className="missing">
              ADR-{sel} 은 없습니다
            </h2>
          )}
        </article>
      </div>
    </>
  );
}
