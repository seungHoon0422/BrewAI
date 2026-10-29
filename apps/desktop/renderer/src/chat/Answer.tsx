// 답 한 칸 = (생각 · 도구 상태 줄 + 펼치는 패널) → 글 → 아래 한 줄 (답한 모델 · 생각 깊이 · 걸린 시간).
// 상태 줄(.trace-line) = 유리 알약 하나: 흐르는 동안 '질문을 살펴보는 중 → 계산하는 중 → 답을 다듬는 중' (글이 반짝이는 그라데이션),
// 끝나면 '1.2초 동안 생각함 · 계산기 1회' (생각 깊이를 켰는데 모델이 건너뛰면 '생각 없이 바로 답함').
// 생각 글과 도구 카드는 줄을 눌러야 보인다 (기본 접힘 · 흐르는 중에도).
// 색 점으로 상태를 나누지 않는다 — 글 · 아이콘 · 움직임으로만.
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon, type IconName } from '../icons';
import { ProviderIcon, providerLabel } from '../providers';
import { FAILURE_TEXT, detailText, reasoningLabel, seconds, skippedThinking, thought, tracePhrase, type Trace } from './text';
import {
  isLive, retry, retryWithoutReasoning, useDupCheck, useSession, useSkillLabels, type Answer, type ReasoningPart, type ToolPart, type Turn,
} from './session';

// 살아 있는 동안만 시계를 돌린다 (200ms) — 끝나면 멈춘다
export function useNow(active: boolean, every = 200): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [active, every]);
  return now;
}

// 화면 읽기 프로그램에는 바뀐 글을 2초에 한 번까지만 (매 단계마다 끊어 읽지 않게). flush = 기다리지 않고 바로 (끝 · 멈춤)
function useThrottled<T>(value: T, ms: number, flush = false): T {
  const [shown, setShown] = useState(value);
  const last = useRef(0);
  useEffect(() => {
    const wait = flush ? 0 : Math.max(0, last.current + ms - Date.now());
    const t = setTimeout(() => {
      last.current = Date.now();
      setShown(value);
    }, wait);
    return () => clearTimeout(t);
  }, [value, ms, flush]);
  return shown;
}

const reduceMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

export function AnswerView({ turn, latest, threadId }: { turn: Turn; latest: boolean; threadId: string }) {
  const a = turn.answer;
  const live = isLive(a);
  const body = a.parts.length > 0 || a.status !== 'failed';
  const worked = thought(a) || a.parts.some((p) => p.kind === 'tool') || skippedThinking(a);
  // 상태 줄: 생각 · 도구가 있었거나, 이 창에서 방금 보낸 마지막 답이 흐르는 중 · 멈춤
  const trace = worked || (latest && !a.fromHistory && (live || a.status === 'stopped'));
  return (
    <>
      {body && (
        <div className="msg agent enter" aria-busy={live}>
          {trace && <TraceView a={a} />}
          {a.parts.map((p) => (p.kind === 'text' ? <div key={p.id} className="txt">{p.text}</div> : null))}
          {(a.model || a.status === 'stopped') && (
            <div className="afoot">
              {a.status === 'stopped' && latest && !a.fromHistory && (
                <button className="btn sm" type="button" onClick={() => retry(threadId)}>
                  <Icon name="refresh" small />다시 시도
                </button>
              )}
              <Byline a={a} withTime={!live} />
            </div>
          )}
        </div>
      )}
      {a.status === 'failed' && a.failure && (latest ? (
        <Failed a={a} threadId={threadId} />
      ) : (
        <p className="msg note">{failText(a)}</p>
      ))}
    </>
  );
}

const failText = (a: Answer) => detailText(a.failureDetail)?.text || (a.failure ? FAILURE_TEXT[a.failure] : '');

// 실패 = 한 줄(왜) + 고치는 곳(hint) + 다시 시도 (생각 때문이면 '생각 끄고 다시'도)
function Failed({ a, threadId }: { a: Answer; threadId: string }) {
  const d = detailText(a.failureDetail);
  return (
    <div className="msg agent fail enter" role="alert" data-detail={a.failureDetail ?? undefined}>
      <span className="fmain">
        <span className="ftxt">{failText(a)}</span>
        {d && <span className="fhint">{d.hint}</span>}
        {a.model && d && <span className="fmodel">{a.model.label} · {a.model.id}</span>}
      </span>
      <span className="facts">
        {d?.reasoningOff && a.reasoning !== 'off' && (
          <button className="btn" type="button" onClick={() => retryWithoutReasoning(threadId)}>생각 끄고 다시</button>
        )}
        <button className="btn" type="button" onClick={() => retry(threadId)}>다시 시도</button>
      </span>
    </div>
  );
}

// 답한 모델 (회사 아이콘 · 이름 · 생각 깊이 · 걸린 시간)
// 같은 이름의 다른 모델이 있으면 이름 뒤에 id 도 (입력창 버튼 · 모델 메뉴와 같은 규칙)
function Byline({ a, withTime }: { a: Answer; withTime?: boolean }) {
  const dup = useDupCheck();
  if (!a.model) return null;
  const extra = [a.reasoning !== 'off' ? `생각 ${reasoningLabel(a.reasoning)}` : '', withTime ? seconds(a.durationMs) : ''].filter(Boolean);
  return (
    <span className="by" title={`${providerLabel(a.model.provider, a.model.provider_label)} · ${a.model.id}`}>
      <ProviderIcon provider={a.model.provider} />
      <span className="nm">{a.model.label}</span>
      {dup(a.model) && <span className="mid">{a.model.id}</span>}
      {extra.map((x) => <span key={x} className="x">· {x}</span>)}
    </span>
  );
}

// ── 상태 줄 + 패널 ──
function TraceView({ a }: { a: Answer }) {
  const tools = useSession((s) => s.tools);
  const skills = useSkillLabels();
  const live = isLive(a);
  const now = useNow(live);
  const [open, setOpen] = useState(false); // 기본 접힘 (흐르는 중에도) · 사용자가 누른 대로 둔다
  const panelId = useId();
  const line = useRef<HTMLButtonElement>(null);
  const t: Trace = tracePhrase(a, now, tools, skills);
  const phase = a.status === 'failed' ? 'stopped' : t.phase;
  const step = a.status === 'failed' ? 'stopped' : t.step;
  const text = a.status === 'failed' ? '중간에 멈춤' : t.text;
  const elapsed = live ? now - a.startedAt : null;
  const glyph: GlyphKind = phase === 'live' ? 'live' : phase === 'stopped' ? 'stop' : thought(a) ? 'think' : a.parts.some((p) => p.kind === 'tool') ? 'tool' : 'done';
  // 화면 읽기: 버튼 이름 = 지금 글 그대로 (시간 빼고) · 바뀐 글 알림은 버튼 밖 live 영역에서 2초에 한 번 (끝 · 멈춤은 바로)
  const announced = useThrottled(text, 2000, phase !== 'live');

  const onPanelKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
    line.current?.focus();
  };

  return (
    <div className="trace" data-open={open}>
      <button ref={line} className="trace-line" type="button" data-step={step} data-phase={phase} data-glyph={glyph}
        aria-expanded={open} aria-controls={panelId} aria-label={text} title={open ? '과정 접기' : '생각과 도구 사용 과정 보기'}
        onClick={() => setOpen((v) => !v)}>
        <TraceGlyph kind={glyph} />
        <TraceText text={text} live={phase === 'live'} />
        {elapsed != null && <span className="tm" aria-hidden="true">{seconds(elapsed)}</span>}
        <span className="chev" aria-hidden="true"><Icon name="down" small /></span>
      </button>
      <span className="sr" aria-live="polite">{announced}</span>
      <div className="trace-panel" id={panelId} role="region" aria-label="생각과 도구 사용 과정" hidden={!open} onKeyDown={onPanelKey}>
        {open && <TracePanel a={a} now={now} />}
      </div>
    </div>
  );
}

// 끝난 줄의 아이콘 = 한 일: 생각했으면 말풍선 · 도구만 썼으면 렌치 · 생각을 건너뛰었으면 체크 · 멈춤 = 네모
type GlyphKind = 'live' | 'think' | 'tool' | 'done' | 'stop';
const GLYPH: Record<Exclude<GlyphKind, 'live'>, IconName> = { think: 'think', tool: 'wrench', done: 'check', stop: 'stop' };
function TraceGlyph({ kind }: { kind: GlyphKind }) {
  if (kind === 'live') {
    return (
      <span className="glyph breath" aria-hidden="true"><i /><i /><i /></span>
    );
  }
  return <span className="glyph" aria-hidden="true"><Icon name={GLYPH[kind]} small /></span>;
}

// 글: 흐르는 동안 반짝이는 그라데이션 · 바뀔 때 겹쳐 사라짐(160ms) · 폭은 200ms 동안 이어진다
function TraceText({ text, live }: { text: string; live: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.width = '';
    const next = el.scrollWidth;
    const before = prev.current;
    prev.current = next;
    if (before == null || before === next || reduceMotion()) return;
    el.style.width = `${before}px`;
    const raf = requestAnimationFrame(() => {
      el.style.width = `${next}px`;
    });
    const t = setTimeout(() => {
      el.style.width = '';
    }, 220);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [text]);
  return (
    <span ref={ref} className={live ? 'trace-txt run' : 'trace-txt'} aria-hidden="true">
      <span key={text} className="ph">{text}</span>
    </span>
  );
}

function TracePanel({ a, now }: { a: Answer; now: number }) {
  const items = a.parts.filter((p): p is ReasoningPart | ToolPart => p.kind !== 'text');
  const live = isLive(a);
  // 생각 토큰은 있는데 글이 안 왔다 = 모델이 생각 내용을 보내지 않았다 (display omitted · redacted)
  const silent = !live && !items.some((p) => p.kind === 'reasoning') && (a.usage?.reasoning_tokens ?? 0) > 0;
  const u = a.usage;
  const foot = !live && u
    ? [
        `요청 ${u.requests}회`,
        u.input_tokens != null || u.output_tokens != null ? `토큰 입력 ${u.input_tokens ?? '—'} / 출력 ${u.output_tokens ?? '—'}` : '',
        u.reasoning_tokens ? `생각 토큰 ${u.reasoning_tokens}` : '',
      ].filter(Boolean).join(' · ')
    : '';
  return (
    <>
      {silent && <ThinkBlock p={{ kind: 'reasoning', id: 'silent', text: '', live: false, ms: null, at: 0 }} now={now} />}
      {items.length === 0 && !silent && <p className="tp-none">{live ? '아직 생각이나 도구 사용이 없어요' : '생각이나 도구 사용이 없었어요'}</p>}
      {items.map((p) => (p.kind === 'reasoning' ? <ThinkBlock key={p.id} p={p} now={now} /> : <ToolItem key={p.id} p={p} />))}
      {foot && <p className="tp-foot">{foot}</p>}
    </>
  );
}

// 생각 글: 흐르는 동안 끝에 붙어 내려간다 (사용자가 위로 올리면 멈춤 · 24px 안이면 다시 붙음)
function ThinkBlock({ p, now }: { p: ReasoningPart; now: number }) {
  const body = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [scrolled, setScrolled] = useState(false);
  const ms = p.live ? now - p.at : p.ms;
  useLayoutEffect(() => {
    const el = body.current;
    if (el && p.live && stick.current) el.scrollTop = el.scrollHeight;
  }, [p.text, p.live]);
  const onScroll = () => {
    const el = body.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setScrolled(el.scrollTop > 2);
  };
  return (
    <section className="tp-think" data-live={p.live}>
      <h4 className="tp-h">
        <Icon name="think" small />생각
        {ms != null && <span className="tm">{seconds(ms)}</span>}
      </h4>
      <div ref={body} className="tp-body" tabIndex={0} data-scrolled={scrolled} onScroll={onScroll} aria-label="생각 내용">
        {p.text ? p.text : p.live ? '…' : <span className="tp-empty">모델이 생각 내용을 보내지 않았어요</span>}
        {p.live && <span className="caret" aria-hidden="true">▍</span>}
      </div>
    </section>
  );
}

const TOOL_ICON: Record<string, IconName> = {
  calculator: 'calc', current_time: 'clock', unit_convert: 'ruler', date_calc: 'cal', text_stats: 'text', use_skill: 'layers',
};
const TOOL_STATE: Record<ToolPart['status'], { text: string; icon?: IconName }> = {
  running: { text: '실행 중' },
  done: { text: '완료', icon: 'check' },
  error: { text: '실패', icon: 'x' },
  cancelled: { text: '멈춤' },
};

const asObj = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const show = (v: unknown): string => (v == null ? '' : typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v));

// 도구마다 사람이 읽는 두세 줄 (입력 · 결과). 모르는 도구 = JSON 그대로
function toolRows(p: ToolPart): { k: string; v: string; mono?: boolean; err?: boolean }[] {
  const args = asObj(p.args);
  const res = asObj(p.result);
  const rows: { k: string; v: string; mono?: boolean; err?: boolean }[] = [];
  if (p.name === 'calculator') rows.push({ k: '수식', v: show(args?.expression) || p.argsText || '…', mono: true });
  else if (p.name === 'current_time') rows.push({ k: '시간대', v: show(args?.timezone) || 'Asia/Seoul' });
  else if (p.name === 'use_skill') rows.push({ k: '스킬', v: show(res?.label) || show(args?.name) || '…' });
  else if (p.name === 'unit_convert') rows.push({ k: '변환', v: args ? `${show(args.value)} ${show(args.from_unit)} → ${show(args.to_unit)}` : p.argsText || '…', mono: true });
  else if (p.name === 'date_calc') rows.push({ k: '계산', v: args ? [show(args.operation), show(args.date), show(args.other_date), args.days != null ? `${show(args.days)}일` : ''].filter(Boolean).join(' · ') : p.argsText || '…' });
  else if (p.name === 'text_stats') rows.push({ k: '글', v: typeof args?.text === 'string' ? `${Array.from(args.text).length}자 받음` : '…' });
  else if (p.argsText || p.args !== undefined) rows.push({ k: '입력', v: p.args !== undefined ? show(p.args) : p.argsText, mono: true });
  if (p.status === 'running' || p.status === 'cancelled') return rows;
  if (res && 'error' in res) {
    rows.push({ k: '오류', v: show(res.message) || show(res.error), err: true });
  } else if (p.name === 'calculator' && res && 'result' in res) {
    rows.push({ k: '결과', v: show(res.result), mono: true });
  } else if (p.name === 'use_skill' && res) {
    // 지침 본문은 모델만 본다 — 카드엔 줄 수만 (기록에서 연 답은 서버가 본문을 빼고 lines 를 준다)
    const lines = typeof res.lines === 'number' ? res.lines : typeof res.instructions === 'string' ? res.instructions.split('\n').length : null;
    rows.push({ k: '결과', v: `지침 불러옴${lines != null ? ` · ${lines}줄` : ''}` });
  } else if (p.name === 'unit_convert' && res && 'text' in res) {
    rows.push({ k: '결과', v: show(res.text), mono: true });
  } else if (p.name === 'date_calc' && res && 'date' in res) {
    rows.push({ k: '결과', v: `${show(res.date)} ${show(res.weekday)}` });
  } else if (p.name === 'date_calc' && res && 'days' in res) {
    rows.push({ k: '결과', v: `${show(res.text)} (${show(res.days)}일)` });
  } else if (p.name === 'text_stats' && res && 'characters' in res) {
    rows.push({ k: '결과', v: `${show(res.characters)}자 · 공백 빼고 ${show(res.characters_no_spaces)}자 · 단어 ${show(res.words)} · ${show(res.lines)}줄` });
  } else if (p.name === 'current_time' && res && 'date' in res) {
    rows.push({ k: '결과', v: `${show(res.date)} ${show(res.time)} ${show(res.weekday)}${res.utc_offset ? ` (UTC${show(res.utc_offset)})` : ''}` });
  } else if (p.result !== undefined) {
    rows.push({ k: '결과', v: show(p.result), mono: true });
  }
  return rows;
}

function ToolItem({ p }: { p: ToolPart }) {
  const st = TOOL_STATE[p.status];
  return (
    <div className="tp-tool" data-state={p.status} data-tool={p.name} role="group"
      aria-label={p.name === 'use_skill' ? '스킬 사용' : `${p.label} 도구`}>
      <div className="th">
        <span className="ttile" aria-hidden="true"><Icon name={TOOL_ICON[p.name] ?? 'wrench'} small /></span>
        <b title={p.name}>{p.label}</b>
        <span className="tst">
          {p.status === 'running' ? <span className="spin12" aria-hidden="true" /> : st.icon && <Icon name={st.icon} small />}
          {st.text}
          {p.ms != null && p.status !== 'running' && <span className="tm"> · {seconds(p.ms)}</span>}
        </span>
      </div>
      <dl>
        {toolRows(p).map((r) => (
          <div key={r.k} className={r.err ? 'err' : undefined}>
            <dt>{r.k}</dt>
            <dd className={r.mono ? 'mono' : undefined} title={r.v}>{r.v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
