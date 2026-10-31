// 생각 · 도구 상태 줄(.trace-line) = 유리 알약 하나 + 누르면 펼치는 유리 패널. 글은 trace.ts · 문구는 copy.ts.
// 흐르는 동안 '질문을 살펴보는 중 → 계산하는 중 → 답을 다듬는 중' (글이 반짝이는 그라데이션),
// 끝나면 '1.2초 동안 생각함' '계산기 1회' 조각을 칸 나눔으로 (가운뎃점 없음 · 생각 글이 없으면 시간 없이 '생각함').
// 패널 = 나온 순서대로 생각 블록(조용한 글 · 왼쪽 선)과 도구 블록(카드: 이름 · 입력 · 결과 · 상태)이 확실히 다르게.
// 생각 글과 도구 카드는 줄을 눌러야 보인다 (기본 접힘 · 흐르는 중에도). 색 점으로 상태를 나누지 않는다 — 글 · 아이콘 · 움직임으로만.
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon, type IconName } from '@brewai/ui';
import { seconds } from '../../../lib/format';
import { reduceMotion, useNow, useThrottled } from '../../../lib/hooks';
import { useSkillLabels, useToolLabels } from '../../skills/hooks';
import { TRACE } from '../copy';
import { Markdown } from '../markdown/render';
import { isLive, type Answer, type ReasoningPart } from '../model';
import { thought, thoughtParts, tracePhrase, usedTools } from '../trace';
import { ToolCard } from './ToolCard';

const ANNOUNCE_MS = 2000;

export function TraceView({ a }: { a: Answer }) {
  const tools = useToolLabels();
  const skills = useSkillLabels();
  const live = isLive(a);
  const now = useNow(live);
  const [open, setOpen] = useState(false); // 기본 접힘 (흐르는 중에도) · 사용자가 누른 대로 둔다
  const panelId = useId();
  const line = useRef<HTMLButtonElement>(null);
  const t = tracePhrase(a, now, tools, skills);
  const failed = a.status === 'failed';
  const phase = failed ? 'stopped' : t.phase;
  const step = failed ? 'stopped' : t.step;
  const parts = failed ? [TRACE.stopped] : t.parts;
  const text = failed ? TRACE.stopped : t.text;
  const elapsed = live ? now - a.startedAt : null;
  const glyph: GlyphKind = phase === 'live' ? 'live' : phase === 'stopped' ? 'stop' : thought(a) ? 'think' : usedTools(a) ? 'tool' : 'done';
  // 화면 읽기: 버튼 이름 = 지금 글 그대로 (시간 빼고) · 바뀐 글 알림은 버튼 밖 live 영역에서 2초에 한 번 (끝 · 멈춤은 바로)
  const announced = useThrottled(text, ANNOUNCE_MS, phase !== 'live');

  const onPanelKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
    line.current?.focus();
  };

  return (
    <div className="trace" data-open={open}>
      <button ref={line} className="trace-line ui-glass" type="button" data-step={step} data-phase={phase} data-glyph={glyph}
        aria-expanded={open} aria-controls={panelId} aria-label={text} title={open ? TRACE.closeTitle : TRACE.openTitle}
        onClick={() => setOpen((v) => !v)}>
        <TraceGlyph kind={glyph} />
        <TraceText parts={parts} text={text} live={phase === 'live'} />
        {elapsed != null && <span className="tm ui-num" aria-hidden="true">{seconds(elapsed)}</span>}
        <span className="chev" aria-hidden="true"><Icon name="chevron-down" size="xs" /></span>
      </button>
      {/* .sr = e2e 훅 (trace > .sr[aria-live]) · 모양은 ui-sr */}
      <span className="sr ui-sr" aria-live="polite">{announced}</span>
      <div className="trace-panel ui-glass" id={panelId} role="region" aria-label={TRACE.region} hidden={!open} onKeyDown={onPanelKey}>
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
  return <span className="glyph" aria-hidden="true"><Icon name={GLYPH[kind]} size="sm" /></span>;
}

// 글: 흐르는 동안 반짝이는 그라데이션 · 바뀔 때 겹쳐 사라짐(160ms) · 폭은 200ms 동안 이어진다 · 조각 = 칸 나눔
function TraceText({ parts, text, live }: { parts: string[]; text: string; live: boolean }) {
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
      <span key={text} className="ph">
        {parts.map((p, i) => <span key={i} className="seg">{p}</span>)}
      </span>
    </span>
  );
}

function TracePanel({ a, now }: { a: Answer; now: number }) {
  const thinking = new Set<Answer['parts'][number]>(thoughtParts(a));
  const items = a.parts.filter((p) => p.kind === 'tool' || thinking.has(p));
  const live = isLive(a);
  // 생각 토큰은 있는데 글이 안 왔다 = 모델이 생각 내용을 보내지 않았다 (display omitted · redacted)
  const silent = !live && !items.some((p) => p.kind === 'reasoning') && (a.usage?.reasoning_tokens ?? 0) > 0;
  const foot = !live && a.usage ? TRACE.usage(a.usage) : [];
  return (
    <>
      {(items.length > 0 || silent) && (
        <ol className="tp-list">
          {silent && <li><ThinkBlock p={{ kind: 'reasoning', id: 'silent', text: '', live: false, ms: null, at: 0 }} now={now} /></li>}
          {items.map((p) => <li key={p.id}>{p.kind === 'reasoning' ? <ThinkBlock p={p} now={now} /> : p.kind === 'tool' ? <ToolCard p={p} /> : null}</li>)}
        </ol>
      )}
      {items.length === 0 && !silent && <p className="tp-none">{live ? TRACE.noneLive : TRACE.noneDone}</p>}
      {foot.length > 0 && <p className="tp-foot ui-num">{foot.map((f) => <span key={f}>{f}</span>)}</p>}
    </>
  );
}

// 생각 블록 = 조용한 글 (왼쪽 선 · 흐린 글색). 흐르는 동안 끝에 붙어 내려간다 (사용자가 위로 올리면 멈춤 · 24px 안이면 다시 붙음)
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
    <section className="tp-think" data-kind="think" data-live={p.live}>
      <h4 className="tp-h">
        <Icon name="think" size="sm" />{TRACE.think}
        {ms != null && ms >= 100 && <span className="tm ui-num">{seconds(ms)}</span>}
      </h4>
      <div ref={body} className="tp-body ui-scroll" tabIndex={0} data-scrolled={scrolled} onScroll={onScroll} aria-label={TRACE.thinkBody}>
        {p.text ? <Markdown text={p.text} live={p.live} smooth={false} /> : p.live ? '…' : <span className="tp-empty">{TRACE.thinkSilent}</span>}
        {p.live && !p.text && <span className="caret" aria-hidden="true">▍</span>}
      </div>
    </section>
  );
}
