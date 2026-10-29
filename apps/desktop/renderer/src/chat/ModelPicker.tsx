// 입력창의 모델 버튼 + 유리 팝오버 (design/prototype.html .model · .menu 결). 검색 → 최근 사용 → 회사별 묶음 → 생각 깊이.
// 넓은 창(1040px 이상) = 두 칸 (목록 · 고른 줄의 자세히), 좁은 창 = 한 칸 + 자세히는 옆에 뜨는 카드.
// 목록 = GET /api/models (노출된 모델만). 열 때마다 다시 읽는다 → 숨겨진 모델은 바로 빠진다 (P2-1).
// 같은 표시 이름이 둘이면 둘째 줄을 진하게 + 등록한 곳(config.yaml · 관리 화면)을 같이 (키 없는 쪽을 피할 수 있게).
//   입력창 버튼도 이름 뒤에 id 를 붙인다 (session.ts dupCheck — 답 아래 줄 · 진행 상황도 같은 규칙).
// 최근 연결에 실패한 모델 = 경고 점 + 이유 (고를 수는 있다).
// 키보드 (combobox): 검색칸에서 ↑↓ Home End = 이동(머리글 건너뜀 · 끝에서 돌아감) · Enter = 고르고 닫기 · Esc = 검색 지우기 → 닫기
//   · Tab = 생각 깊이 (←→ 로 바꾸기). 버튼에서 ↓/↑ = 열기
import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { Model } from '../api';
import { Icon } from '../icons';
import { ProviderIcon, providerLabel } from '../providers';
import { FAILURE_TEXT, REASONING, ago, healthShort, reasoningLabel, tokensShort } from './text';
import {
  clearModelNotice, effectiveModel, effectiveReasoning, loadModels, pickModel, pickReasoning, useDupCheck, useSession,
} from './session';

type Group = { provider: string; label: string; models: Model[] };
type Opt = { key: string; model: Model };

// 회사별 묶음 = 목록에 처음 나온 순서 (기본 모델이 맨 앞 · 나머지는 관리자 순서). 묶음 안 순서도 그대로 (안정)
function groups(list: Model[]): Group[] {
  const out: Group[] = [];
  for (const m of list) {
    const g = out.find((x) => x.provider === m.provider);
    if (g) g.models.push(m);
    else out.push({ provider: m.provider, label: providerLabel(m.provider, m.provider_label), models: [m] });
  }
  return out;
}

const norm = (s: string) => s.normalize('NFC').toLowerCase();
const RECENT_SHOWN = 3;
const WIDE = '(min-width: 1040px)';
const failing = (m: Model) => m.health === 'error';

function useMedia(query: string): boolean {
  const get = () => {
    try {
      return window.matchMedia(query).matches;
    } catch {
      return true;
    }
  };
  const [on, setOn] = useState(get);
  useEffect(() => {
    let mq: MediaQueryList;
    try {
      mq = window.matchMedia(query);
    } catch {
      return;
    }
    const f = () => setOn(mq.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, [query]);
  return on;
}

// 검색어와 맞는 부분을 굵게
function Hit({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const i = norm(text).indexOf(q);
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<b className="hit">{text.slice(i, i + q.length)}</b>{text.slice(i + q.length)}</>;
}

const caps = (m: Model) => [m.supports_reasoning ? '생각' : '', m.supports_tools ? '도구' : '', m.supports_vision ? '이미지' : ''].filter(Boolean);
const SOURCE: Record<string, string> = { config: 'config.yaml', ui: 'LiteLLM 관리 화면', mixed: 'config.yaml + 관리 화면' };
const sourceOf = (m: Model) => (m.source ? SOURCE[m.source] : '출처 모름');
// 실패 이유를 이름에 붙인다 (툴팁 · 화면 읽기 프로그램 이름)
const failNote = (m: Model) => (failing(m) ? ` · 최근 연결 실패 (${healthShort(m.health_code)})` : '');

export function ModelPicker() {
  const models = useSession((s) => s.models);
  const pref = useSession((s) => s.reasoning);
  const current = useSession(effectiveModel);
  const reasoning = useSession(effectiveReasoning);
  const notice = useSession((s) => s.modelNotice);
  const recentIds = useSession((s) => s.recentModels);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<string | null>(null); // 강조한 줄 (Opt.key)
  const [refreshing, setRefreshing] = useState(false);
  const [card, setCard] = useState<string | null>(null); // 좁은 창: 자세히 카드를 띄운 줄
  const wide = useMedia(WIDE);
  const wrap = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const hover = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uid = useId();
  const popId = `${uid}-pop`;
  const listId = `${uid}-list`;
  const canThink = current?.supports_reasoning ?? false;
  const q = norm(query.trim());

  // 같은 표시 이름 (대소문자 · 공백 무시) 의 다른 모델이 목록에 있다
  const dup = useDupCheck();

  const match = (m: Model) =>
    !q || [m.label, m.id, providerLabel(m.provider, m.provider_label), m.family ?? ''].some((x) => norm(x).includes(q));
  const shown = models.list.filter(match);
  const recent = q ? [] : recentIds.map((id) => models.list.find((m) => m.id === id)).filter((m): m is Model => !!m).slice(0, RECENT_SHOWN);
  const grouped = groups(shown);
  const opts: Opt[] = [...recent.map((m) => ({ key: `r:${m.id}`, model: m })), ...grouped.flatMap((g) => g.models.map((m) => ({ key: `m:${m.id}`, model: m })))];
  const activeOpt = opts.find((o) => o.key === active) ?? null;
  const optId = (key: string) => `${uid}-o-${opts.findIndex((o) => o.key === key)}`;
  const detail = activeOpt?.model ?? current;

  const close = (refocus: boolean) => {
    setOpen(false);
    setQuery('');
    setCard(null);
    if (refocus) btn.current?.focus();
  };
  const openMenu = () => {
    setOpen(true);
    setQuery('');
    setActive(current ? `m:${current.id}` : null);
    setRefreshing(true);
    void loadModels().finally(() => setRefreshing(false)); // 최신 목록 (관리자가 방금 숨긴 모델은 빠진다)
  };

  // 열리면 검색칸으로 (바로 입력)
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  // 강조한 줄이 목록에서 빠지면(숨김 · 검색) 고른 모델 → 첫 줄로
  useEffect(() => {
    if (!open || opts.some((o) => o.key === active)) return;
    const sel = current && opts.find((o) => o.key === `m:${current.id}`);
    setActive((sel || opts[0])?.key ?? null);
  });

  // 강조한 줄이 보이게
  useEffect(() => {
    if (!open || !active) return;
    document.getElementById(optId(active))?.scrollIntoView({ block: 'nearest' });
  }, [active, open]); // eslint-disable-line react-hooks/exhaustive-deps

  // 바깥을 누르면 닫는다 (포커스는 누른 곳으로). Esc 는 포커스가 어디 있든 닫고 버튼으로
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) close(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      close(true);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // 기본 모델로 돌아갔다는 안내는 잠깐만
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(clearModelNotice, 8000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => () => {
    if (hover.current) clearTimeout(hover.current);
  }, []);

  const pick = (m: Model) => {
    pickModel(m.id);
    close(true);
  };

  const onButtonKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) openMenu();
    }
  };
  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const i = opts.findIndex((o) => o.key === active);
    const move = (to: number) => {
      e.preventDefault();
      if (!opts.length) return;
      const next = opts[(to + opts.length) % opts.length].key;
      setActive(next);
      if (!wide) setCard(next); // 키보드 = 자세히 카드를 바로
    };
    if (e.key === 'ArrowDown') move(i < 0 ? 0 : i + 1);
    else if (e.key === 'ArrowUp') move(i < 0 ? opts.length - 1 : i - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(opts.length - 1);
    else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (activeOpt) pick(activeOpt.model);
    } else if (e.key === 'Escape' && query) {
      e.preventDefault();
      e.stopPropagation(); // 먼저 검색만 지운다 (닫기는 다음 Esc)
      setQuery('');
    }
  };
  // 포커스가 팝오버 밖으로 나가면(Tab) 닫는다
  const onBlur = (e: FocusEvent) => {
    if (open && e.relatedTarget && !wrap.current?.contains(e.relatedTarget as Node)) close(false);
  };
  const onRowHover = (key: string) => {
    setActive(key);
    if (wide) return;
    if (hover.current) clearTimeout(hover.current);
    hover.current = setTimeout(() => setCard(key), 300);
  };

  const label = current?.label ?? '기본 모델';
  const curDup = !!current && dup(current);
  const tip = current
    ? `${label}${current.label !== current.id ? ` (${current.id})` : ''} · ${providerLabel(current.provider, current.provider_label)}`
      + (failing(current) ? ` · 최근 연결에 실패했어요 · ${healthShort(current.health_code)}` : '')
    : models.status === 'error' ? FAILURE_TEXT[models.error ?? 'offline'] : '허용된 모델만 보여요';

  const renderOpt = (o: Opt) => (
    <ModelRow key={o.key} id={optId(o.key)} sec={o.key.startsWith('r:') ? 'recent' : 'all'} m={o.model} q={q} dup={dup(o.model)} selected={o.model.id === current?.id}
      active={o.key === active} onPick={pick} onHover={() => onRowHover(o.key)}
      onLeave={() => {
        if (hover.current) clearTimeout(hover.current);
      }} />
  );
  const cardModel = !wide && card ? opts.find((o) => o.key === card)?.model ?? null : null;

  return (
    <span className="mpick" ref={wrap} onBlur={onBlur}>
      {notice && <span className="mnotice" role="status">{notice}</span>}
      <button ref={btn} className="model" type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? popId : undefined}
        title={tip} onClick={() => (open ? close(false) : openMenu())} onKeyDown={onButtonKey}>
        <ProviderIcon provider={current?.provider ?? 'other'} className={current ? undefined : 'none'} />
        <span className="nm">{label}</span>
        {curDup && <span className="mid" title={current.id}>{current.id}</span>}
        {current && failing(current) && <><span className="wdot" aria-hidden="true" /><span className="sr">최근 연결 실패</span></>}
        {reasoning !== 'off' && <span className="eff">· {reasoningLabel(reasoning)}</span>}
        <Icon name="down" />
      </button>
      {open && (
        <div className="menu" id={popId} role="dialog" aria-label="모델과 생각 깊이" data-wide={wide}>
          <div className="mcol">
            <div className="msearch">
              <Icon name="search" small />
              <input ref={input} type="search" role="combobox" aria-label="모델 검색" placeholder="이름 또는 ID로 찾기"
                aria-expanded="true" aria-controls={listId} aria-autocomplete="list"
                aria-activedescendant={activeOpt ? optId(activeOpt.key) : undefined}
                value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onSearchKey} spellCheck={false} autoComplete="off" />
              {refreshing && models.list.length > 0 && <span className="spin12" aria-hidden="true" title="목록 새로 읽는 중" />}
            </div>
            <div className="mlist" role="listbox" id={listId} aria-label="모델" tabIndex={-1}>
              {models.status === 'loading' && models.list.length === 0 && (
                <div className="mstate" role="presentation">
                  {[0, 1, 2].map((i) => <span key={i} className="mskel" aria-hidden="true"><i /><i /></span>)}
                  <span>모델 목록을 불러오는 중…</span>
                </div>
              )}
              {models.status === 'error' && models.list.length === 0 && (
                <div className="mstate" role="presentation">
                  <span>{models.error === 'offline' ? '서버에 연결할 수 없어요' : '모델 목록을 불러오지 못했어요'}</span>
                  <button className="btn sm" type="button" onClick={() => void loadModels()}>
                    <Icon name="refresh" small />다시 시도
                  </button>
                </div>
              )}
              {models.status === 'ready' && models.list.length === 0 && <p className="mstate" role="presentation">쓸 수 있는 모델이 없어요</p>}
              {models.list.length > 0 && shown.length === 0 && (
                <p className="mstate" role="presentation">
                  '{query.trim()}'에 맞는 모델이 없어요
                  <button className="link" type="button" onClick={() => { setQuery(''); input.current?.focus(); }}>검색 지우기</button>
                </p>
              )}
              {recent.length > 0 && (
                <Section label="최근 사용" heading="div">{recent.map((m) => renderOpt({ key: `r:${m.id}`, model: m }))}</Section>
              )}
              {grouped.map((g) => (
                <Section key={g.provider} label={g.label} provider={g.provider}>
                  {g.models.map((m) => renderOpt({ key: `m:${m.id}`, model: m }))}
                </Section>
              ))}
            </div>
            {models.list.length > 0 && <Depth canThink={canThink} pref={pref} hasModel={!!current} />}
            <div className="foot">허용된 모델만 보여요</div>
          </div>
          {wide && detail && <Detail m={detail} dup={dup(detail)} />}
          {cardModel && <Detail m={cardModel} dup={dup(cardModel)} card />}
        </div>
      )}
    </span>
  );
}

function Section({ label, provider, heading = 'h6', children }: { label: string; provider?: string; heading?: 'h6' | 'div'; children: ReactNode }) {
  const id = useId();
  const H = heading;
  return (
    <div role="group" aria-labelledby={id} className="mgroup">
      <H id={id} className="mh">
        {provider && <ProviderIcon provider={provider} />}
        {label}
      </H>
      {children}
    </div>
  );
}

function ModelRow({ id, sec, m, q, dup, selected, active, onPick, onHover, onLeave }: {
  id: string; sec: 'recent' | 'all'; m: Model; q: string; dup: boolean; selected: boolean; active: boolean;
  onPick: (m: Model) => void; onHover: () => void; onLeave: () => void;
}) {
  const name = dup ? `${m.label} (${m.id} · ${sourceOf(m)})` : m.label;
  const ctx = tokensShort(m.max_input_tokens);
  return (
    // 포커스는 검색칸에 두고 aria-activedescendant 로 가리킨다 (combobox)
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events
    <div id={id} role="option" aria-selected={selected} aria-label={`${name}${failNote(m)}`} data-model={m.id} data-sec={sec} data-active={active || undefined}
      data-dup={dup || undefined} data-health={m.health} className="mopt"
      title={`${name}${failNote(m)}`}
      onClick={() => onPick(m)} onMouseMove={active ? undefined : onHover} onMouseLeave={onLeave}>
      <span className="l1">
        <ProviderIcon provider={m.provider} />
        <span className="nm"><Hit text={m.label} q={q} /></span>
        {m.is_default && <><span className="star" title="기본 모델" aria-hidden="true">★</span><span className="sr">기본</span></>}
        {failing(m) && <span className="wdot" aria-hidden="true" />}
        <span className="caps">
          {caps(m).map((c) => <span key={c} className="cap">{c}</span>)}
          {ctx && <span className="ctx">{ctx}</span>}
        </span>
        <span className="chk" aria-hidden="true">{selected && <Icon name="check" small />}</span>
      </span>
      {dup ? (
        <span className="l2 dup"><Hit text={m.id} q={q} /><span className="src">{sourceOf(m)}</span></span>
      ) : (
        <span className="l2"><Hit text={m.id} q={q} /></span>
      )}
    </div>
  );
}

// 생각 깊이 = 세 칸 짜리 분할 버튼 (radiogroup). 모델이 못 받으면 '끄기' 에 고정
function Depth({ canThink, pref, hasModel }: { canThink: boolean; pref: string; hasModel: boolean }) {
  const id = useId();
  const value = canThink ? pref : 'off';
  const i = Math.max(0, REASONING.findIndex((r) => r.id === value));
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    if (!canThink) return;
    const next = REASONING[(i + dir + REASONING.length) % REASONING.length];
    pickReasoning(next.id);
    refs.current[REASONING.indexOf(next)]?.focus();
  };
  return (
    <div className="mdepth">
      <h6 id={id}>생각 깊이</h6>
      <div className="seg" role="radiogroup" aria-labelledby={id} aria-disabled={!canThink || undefined} onKeyDown={onKey}
        title={canThink ? undefined : '이 모델은 생각 깊이를 고를 수 없어요'} style={{ ['--i' as string]: i }}>
        <span className="thumb" aria-hidden="true" />
        {REASONING.map((r, n) => (
          <button key={r.id} ref={(el) => { refs.current[n] = el; }} type="button" role="radio" aria-checked={r.id === value}
            aria-disabled={!canThink || undefined} tabIndex={r.id === value ? 0 : -1} data-group="reasoning"
            onClick={() => canThink && pickReasoning(r.id)}>
            {r.label}
          </button>
        ))}
      </div>
      <p className="msub">{REASONING[i].sub}</p>
      {hasModel && !canThink && <p className="mnote">이 모델은 생각 깊이를 고를 수 없어요</p>}
    </div>
  );
}

// 자세히: 이름 · id(복사) · 회사 · 계열 · 컨텍스트 · 출력 · 기능 · 출처 · 상태
function Detail({ m, dup, card }: { m: Model; dup: boolean; card?: boolean }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [m.id]);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(m.id);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = m.id;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {}
      ta.remove();
    }
    setCopied(true);
  };
  const status = failing(m)
    ? `⚠ ${healthShort(m.health_code)}${m.health_at ? ` · ${ago(m.health_at)}` : ''}`
    : m.health === 'ok' ? `정상${m.health_at ? ` · ${ago(m.health_at)}` : ''}` : '확인 전';
  const rows: [string, string][] = [
    ['컨텍스트', tokensShort(m.max_input_tokens) ?? '—'],
    ...(m.max_output_tokens ? [['출력', tokensShort(m.max_output_tokens) ?? '—'] as [string, string]] : []),
    ['기능', caps(m).join(' · ') || '—'],
    ['출처', m.source ? SOURCE[m.source] : '알 수 없음'],
    ['상태', status],
  ];
  return (
    <aside className={card ? 'mdetail card' : 'mdetail'} aria-label={`${m.label} 자세히`} data-health={m.health}>
      <div className="dh">
        <ProviderIcon provider={m.provider} large />
        <b>{m.label}</b>
      </div>
      <div className="did">
        <code className={dup ? 'dup' : undefined}>{m.id}</code>
        <button className="ib" type="button" aria-label="ID 복사" title="ID 복사" onClick={() => void copy()}>
          <Icon name={copied ? 'check' : 'link'} small />
        </button>
        {copied && <span className="toast" role="status">복사했어요</span>}
      </div>
      <p className="dfam">{[providerLabel(m.provider, m.provider_label), m.family ? `${m.family} 계열` : ''].filter(Boolean).join(' · ')}</p>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k} className={k === '상태' && failing(m) ? 'warn' : undefined}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {failing(m) && <p className="dnote">고를 수는 있지만 답이 실패할 수 있어요</p>}
      {dup && <p className="dnote soft">같은 이름의 모델이 더 있어요 — ID 로 구분해요</p>}
    </aside>
  );
}
