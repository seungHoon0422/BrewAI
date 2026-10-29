import { useEffect, useRef, useSyncExternalStore, type MouseEvent, type RefObject } from 'react';
import { Icon } from '../icons';
import { Rich, Sources, St, type Tone } from './parts';
import type { Ask, Card, CardState, DocsData, Pc } from './types';

// 보드 = roadmap slice_hint · docs/slices · HANDOFF(👤 내가 할 일 · 결정 대기)를 카드로 (docs-plugin.ts buildBoard)
// 주소: #/docs/board · 카드 상세 = #/docs/board/<key> (slice-02 · P2)
const COLS: { state: CardState; label: string; tone: Tone }[] = [
  { state: 'todo', label: '예정', tone: 'off' },
  { state: 'doing', label: '진행 중', tone: 'now' },
  { state: 'done', label: '완료', tone: 'on' },
];
// 폰(한 줄)에서는 진행 중부터. CSS order 가 아니라 DOM 순서를 바꾼다 → Tab · 스크린 리더도 같은 순서
const PHONE = '(max-width:760px)';
const COLS_PHONE = [COLS[1], COLS[0], COLS[2]];
function usePhone() {
  return useSyncExternalStore(
    (cb) => {
      const q = window.matchMedia(PHONE);
      q.addEventListener('change', cb);
      return () => q.removeEventListener('change', cb);
    },
    () => window.matchMedia(PHONE).matches,
    () => false,
  );
}
const KIND = { slice: '슬라이스', phase: '단계' } as const;
const BOARD = '#/docs/board';
const cardHref = (key: string) => `${BOARD}/${key}`; // key = 영문·숫자·- 만 (slice-02 · P2)

export default function Board({ data, sel }: { data: DocsData; sel: string | null }) {
  const { cards, mine, confirm, here } = data.board;
  const phone = usePhone();
  const card = sel === null ? null : (cards.find((c) => c.key.toLowerCase() === sel.toLowerCase()) ?? null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const lastKey = useRef<string | null>(null);
  const selfClose = useRef(false); // 주소가 바뀌어 우리가 닫은 것 (close 이벤트는 나중에 온다 → 그때 주소를 다시 바꾸지 않는다)

  // 열기 · 닫기는 주소를 따른다 (뒤로 가기 · 바로 열기 그대로)
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (card) {
      lastKey.current = card.key;
      if (!d.open) d.showModal();
      d.scrollTop = 0;
      closeRef.current?.focus();
    } else if (d.open) {
      selfClose.current = true;
      d.close();
    }
    if (!card && lastKey.current) {
      // 닫히면 그 카드로 포커스를 돌려준다
      document.querySelector<HTMLButtonElement>(`button.card[data-key="${CSS.escape(lastKey.current)}"]`)?.focus();
      lastKey.current = null;
    }
  }, [card]);

  const close = () => {
    if (window.location.hash !== BOARD) window.location.replace(BOARD);
  };
  // 브라우저가 직접 닫은 경우만 (Esc 를 막지 못했을 때) 주소를 보드로
  const onClosed = () => {
    if (selfClose.current) selfClose.current = false;
    else close();
  };
  const onBackdrop = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget) close();
  };

  const of = (key: string) => cards.find((c) => c.key === key) ?? null;
  const asksOf = (list: Ask[], key: string) => list.filter((a) => a.card === key);

  return (
    <>
      <div className="asks">
        <AskGroup id="mine" icon="👤" title="내가 할 일" hint="사람만 할 수 있는 확인 · 실행" list={mine} of={of} here={here} />
        <AskGroup id="confirm" icon="❓" title="컨펌 필요" hint="Claude 가 정하기 전에 물어볼 것" list={confirm} of={of} here={here} />
      </div>

      <section className="dsec" aria-labelledby="board-title">
        <h2 id="board-title">
          작업 보드 <span className="hint">카드를 누르면 상세</span>
        </h2>
        {cards.length === 0 ? (
          <p className="missing">docs/roadmap.json 에 phase 가 없습니다.</p>
        ) : (
          <div className="kanban">
            {(phone ? COLS_PHONE : COLS).map((col) => {
              const list = cards.filter((c) => c.state === col.state);
              return (
                <section key={col.state} className="kcol" data-state={col.state} aria-labelledby={`col-${col.state}`}>
                  <h3 id={`col-${col.state}`}>
                    <St tone={col.tone}>{col.label}</St>
                    <span className="count">{list.length}</span>
                  </h3>
                  {list.length === 0 ? (
                    <p className="kempty">없음</p>
                  ) : (
                    <ul>
                      {list.map((c) => (
                        <li key={c.key}>
                          <CardButton c={c} mine={asksOf(mine, c.key).length} confirm={asksOf(confirm, c.key).length} />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </section>

      <Sources files={['docs/roadmap.json', 'docs/slices/', 'HANDOFF.md', 'docs/adr/']} />

      <dialog ref={dialogRef} className="drawer" aria-labelledby="card-title" onCancel={(e) => { e.preventDefault(); close(); }} onClose={onClosed} onClick={onBackdrop}>
        {card && (
          <Detail
            c={card}
            mine={asksOf(mine, card.key)}
            confirm={asksOf(confirm, card.key)}
            adrTitle={(k) => data.adrs.find((a) => a.key === k)?.title ?? null}
            closeRef={closeRef}
            onClose={close}
            here={here}
          />
        )}
      </dialog>
    </>
  );
}

function Progress({ p }: { p: NonNullable<Card['progress']> }) {
  return (
    <span className="kprog">
      <span className="bar" aria-hidden="true">
        <i style={{ width: `${(p.done / p.total) * 100}%` }} />
      </span>
      <b>
        {p.done}/{p.total}
      </b>
    </span>
  );
}

function CardButton({ c, mine, confirm }: { c: Card; mine: number; confirm: number }) {
  const open = () => {
    if (window.location.hash !== cardHref(c.key)) window.location.hash = cardHref(c.key);
  };
  return (
    <button type="button" className="card" data-key={c.key} aria-haspopup="dialog" aria-label={`${c.label} ${c.title}`} onClick={open}>
      <span className="card-top">
        <span className="rid">{c.label}</span>
        <span className="kind">{KIND[c.kind]}</span>
      </span>
      <span className="card-title">{c.title}</span>
      <span className="card-meta">
        {c.progress ? <Progress p={c.progress} /> : <span className="hint">기준 {c.checklist.length}개</span>}
        <span className="ph-id">{c.kind === 'slice' ? c.phase : c.weeks !== null ? `${c.weeks}주` : ''}</span>
        {mine > 0 && <span className="flagc mine">👤 {mine}</span>}
        {confirm > 0 && <span className="flagc ask">❓ {confirm}</span>}
      </span>
    </button>
  );
}

function AskGroup({ id, icon, title, hint, list, of, here }: { id: string; icon: string; title: string; hint: string; list: Ask[]; of: (k: string) => Card | null; here: Pc | null }) {
  return (
    <section className={`askg ${id}`} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>
        <span aria-hidden="true">{icon}</span> {title}
        <span className="count">{list.length}</span>
        <span className="hint">{hint}</span>
      </h2>
      {list.length === 0 ? (
        <p className="kempty">없음</p>
      ) : (
        <ol>
          {list.map((a, i) => (
            <AskItem key={i} a={a} card={a.card ? of(a.card) : null} here={here} />
          ))}
        </ol>
      )}
    </section>
  );
}

function AskItem({ a, card, here, inDrawer = false }: { a: Ask; card: Card | null; here: Pc | null; inDrawer?: boolean }) {
  return (
    <li className="ask">
      {a.title && <b className="ask-title">{a.title}</b>}
      {a.options.length > 0 ? (
        <ul className="opts" aria-label="선택지">
          {a.options.map((o, i) => (
            <Rich key={i} as="li" html={o} />
          ))}
        </ul>
      ) : (
        <Rich as="p" className="ask-body" html={a.html} />
      )}
      {a.due && (
        <p className="ask-due">
          기한 · <Rich html={a.due} />
        </p>
      )}
      <p className="ask-foot">
        {a.pc && (
          <span className="pc" data-here={a.pc === here ? '' : undefined}>
            {a.pc} PC{a.pc === here ? ' · 지금 이 PC' : ''}
          </span>
        )}
        {card && !inDrawer && (
          <a href={cardHref(card.key)}>
            {card.label} · {card.title}
            <Icon name="right" />
          </a>
        )}
        <span className="from">{a.from.join(' · ')}</span>
      </p>
    </li>
  );
}

function Detail({
  c,
  mine,
  confirm,
  adrTitle,
  closeRef,
  onClose,
  here,
}: {
  c: Card;
  mine: Ask[];
  confirm: Ask[];
  adrTitle: (k: string) => string | null;
  closeRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  here: Pc | null;
}) {
  const col = COLS.find((x) => x.state === c.state)!;
  const checked = c.checklist.filter((x) => x.done).length;
  return (
    <div className="drawer-in">
      <header className="drawer-head">
        <div className="drawer-tags">
          <span className="rid">{c.label}</span>
          <span className="kind">{KIND[c.kind]}</span>
          <St tone={col.tone} title={c.why}>
            {col.label}
          </St>
          {c.kind === 'slice' && <span className="hint">{c.phase}</span>}
          {c.weeks !== null && <span className="hint">{c.weeks}주</span>}
        </div>
        <h2 id="card-title">{c.title}</h2>
        <p className="hint">{c.why}</p>
        <button ref={closeRef} type="button" className="x" aria-label="닫기" onClick={onClose}>
          ×
        </button>
      </header>

      {(mine.length > 0 || confirm.length > 0) && (
        <div className="drawer-asks">
          {mine.length > 0 && (
            <section className="askg mine" aria-labelledby="d-mine">
              <h3 id="d-mine">
                <span aria-hidden="true">👤</span> 확인할 것 <span className="count">{mine.length}</span>
              </h3>
              <ol>
                {mine.map((a, i) => (
                  <AskItem key={i} a={a} card={c} here={here} inDrawer />
                ))}
              </ol>
            </section>
          )}
          {confirm.length > 0 && (
            <section className="askg confirm" aria-labelledby="d-confirm">
              <h3 id="d-confirm">
                <span aria-hidden="true">❓</span> 컨펌할 것 <span className="count">{confirm.length}</span>
              </h3>
              <ol>
                {confirm.map((a, i) => (
                  <AskItem key={i} a={a} card={c} here={here} inDrawer />
                ))}
              </ol>
            </section>
          )}
        </div>
      )}

      <section className="dpart" aria-labelledby="d-goal">
        <h3 id="d-goal">목표</h3>
        {c.goal ? <Rich as="p" html={c.goal} /> : <p className="hint">없음</p>}
        {c.hint && c.kind === 'slice' && (
          <details className="more">
            <summary>roadmap slice_hint</summary>
            <Rich as="p" className="hint" html={c.hint} />
          </details>
        )}
      </section>

      <section className="dpart" aria-labelledby="d-check">
        <h3 id="d-check">
          완료 기준 {c.progress ? <b className="hint">{checked}/{c.checklist.length}</b> : <span className="hint">{c.checklist.length}개 · 아직 판정 전</span>}
        </h3>
        {c.checklist.length === 0 ? (
          <p className="hint">없음</p>
        ) : (
          <ul className="check" aria-label="완료 기준">
            {c.checklist.map((x, i) => (
              <li key={i} className={x.done ? 'done' : undefined}>
                <Icon name={x.done ? 'check' : 'circle'} />
                <span className="sr">{x.done ? '완료: ' : x.done === false ? '남음: ' : '판정 전: '}</span>
                <span>
                  {x.id && <span className="rid">{x.id} </span>}
                  <Rich html={x.html} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <dl className="kv kv2 dkv">
        <div>
          <dt>브랜치</dt>
          <dd>{c.branch ? <code>{c.branch}</code> : <span className="hint">아직 없음</span>}</dd>
        </div>
        <div>
          <dt>완료 기준 id</dt>
          <dd>
            {c.ids.length ? (
              <span className="idlist">
                {c.ids.map((id) => (
                  <code key={id}>{id}</code>
                ))}
              </span>
            ) : (
              <span className="hint">없음</span>
            )}
          </dd>
        </div>
        <div>
          <dt>관련 ADR</dt>
          <dd>
            {c.adrs.length ? (
              <ul className="lines">
                {c.adrs.map((k) => (
                  <li key={k}>
                    <a href={`#/docs/adr/${k}`}>
                      ADR-{k}
                      {adrTitle(k) && ` · ${adrTitle(k)}`}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="hint">없음</span>
            )}
          </dd>
        </div>
      </dl>

      <Sources files={c.files} />
    </div>
  );
}
