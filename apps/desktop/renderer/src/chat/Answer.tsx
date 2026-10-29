// 답 한 칸 = 생각 블록 · 도구 카드 · 글 을 나온 순서대로 + 아래 상태 줄 (지금 하는 일 · 걸린 시간 · 답한 모델).
// 상태 줄은 마지막 답에만 (생각하는 중 → 계산기 실행 중 → 답 쓰는 중 → 완료). 지난 답은 모델 · 걸린 시간만 한 줄.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '../icons';
import { ProviderIcon, providerLabel } from '../providers';
import { FAILURE_TEXT, STEP_DOT, reasoningLabel, seconds, stepDoing } from './text';
import { isLive, retry, useSession, type Answer, type ReasoningPart, type ToolPart, type Turn } from './session';

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

export function AnswerView({ turn, latest, threadId }: { turn: Turn; latest: boolean; threadId: string }) {
  const a = turn.answer;
  const live = isLive(a);
  const body = a.parts.length > 0 || a.status !== 'failed';
  return (
    <>
      {body && (
        <div className="msg agent enter" aria-busy={live}>
          {a.parts.map((p) =>
            p.kind === 'reasoning' ? <Thinking key={p.id} p={p} />
            : p.kind === 'tool' ? <ToolCard key={p.id} p={p} />
            : <div key={p.id} className="txt">{p.text}</div>,
          )}
          {latest && !a.fromHistory && a.status !== 'failed'
            ? <StatusLine a={a} threadId={threadId} />
            : <div className="afoot"><Byline a={a} withTime /></div>}
        </div>
      )}
      {a.status === 'failed' && a.failure && (latest ? (
        <div className="msg agent fail enter" role="alert">
          <span>{FAILURE_TEXT[a.failure]}</span>
          <button className="btn" type="button" onClick={() => retry(threadId)}>다시 시도</button>
        </div>
      ) : (
        <p className="msg note">{FAILURE_TEXT[a.failure]}</p>
      ))}
    </>
  );
}

// 답한 모델 (회사 아이콘 · 이름 · 생각 깊이)
function Byline({ a, withTime }: { a: Answer; withTime?: boolean }) {
  if (!a.model) return null;
  const extra = [a.reasoning !== 'off' ? `생각 ${reasoningLabel(a.reasoning)}` : '', withTime ? seconds(a.durationMs) : ''].filter(Boolean);
  return (
    <span className="by" title={`${providerLabel(a.model.provider, a.model.provider_label)} · ${a.model.id}`}>
      <ProviderIcon provider={a.model.provider} />
      <span className="nm">{a.model.label}</span>
      {extra.map((x) => <span key={x} className="x">· {x}</span>)}
    </span>
  );
}

function StatusLine({ a, threadId }: { a: Answer; threadId: string }) {
  const tools = useSession((s) => s.tools);
  const live = isLive(a);
  const now = useNow(live);
  const [open, setOpen] = useState(false);
  const id = useId();
  const current = live ? (a.steps.findLast((s) => s.status === 'running')?.name ?? null) : null;
  // 도구 결과가 이미 왔는데 다음 단계 전이면 = 모델이 결과를 읽는 중
  const tool = current?.startsWith('tool:')
    ? a.parts.findLast((p): p is ToolPart => p.kind === 'tool' && p.name === current.slice(5))
    : undefined;
  const toolDone = tool !== undefined && tool.status !== 'running';
  const text = live ? (toolDone ? '결과 살펴보는 중' : stepDoing(current, tools)) : a.status === 'done' ? '완료' : '멈춤';
  const kind = live ? '' : a.status === 'done' ? 'done' : 'stop';
  const elapsed = live ? now - a.startedAt : a.durationMs;
  const toolCount = a.parts.filter((p) => p.kind === 'tool').length;
  return (
    <>
      <div className="afoot">
        <button className={`act ${kind}`} type="button" data-step={live ? current ?? 'waiting' : a.status}
          aria-expanded={open} aria-controls={id} title="진행 과정 보기" onClick={() => setOpen((v) => !v)}>
          <span className="d" aria-hidden="true" />
          <span className="txt">{text}</span>
          <span className="tm" aria-hidden="true">{seconds(elapsed)}</span>
          {!live && toolCount > 0 && <span className="tm">· 도구 {toolCount}번</span>}
          <span className="chev" aria-hidden="true"><Icon name="down" /></span>
        </button>
        {a.status === 'stopped' && <button className="btn" type="button" onClick={() => retry(threadId)}>다시 시도</button>}
        <Byline a={a} />
      </div>
      {open && (
        <ol className="asteps" id={id} aria-label="진행 과정">
          {a.steps.length === 0 && <li className="none">아직 단계가 없어요</li>}
          {a.steps.map((s, i) => (
            <li key={`${s.name}-${i}`} data-state={STEP_DOT[s.status]}>
              <span className="dot" aria-hidden="true" />
              <span className="nm">{s.status === 'running' ? stepDoing(s.name, tools) : s.label}</span>
              <span className="tm">{s.status === 'running' ? seconds(now - a.startedAt - s.started_ms) : seconds(s.duration_ms)}</span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

// 생각 블록: 흐르는 동안 펼쳐서 보여 주고, 끝나면 접는다 (사용자가 직접 펼치거나 접으면 그대로 둔다)
function Thinking({ p }: { p: ReasoningPart }) {
  const [manual, setManual] = useState<boolean | null>(null);
  const open = manual ?? p.live;
  const now = useNow(p.live);
  const ms = p.live ? now - p.at : p.ms;
  const id = useId();
  const body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = body.current;
    if (el && p.live) el.scrollTop = el.scrollHeight; // 흐르는 동안 마지막 줄이 보이게
  }, [p.text, p.live]);
  return (
    <div className="think" data-live={p.live} data-open={open}>
      <button className="think-head" type="button" aria-expanded={open} aria-controls={id} onClick={() => setManual(!open)}>
        {p.live ? <span className="spin12" aria-hidden="true" /> : <Icon name="think" />}
        <span>{p.live ? '생각하는 중' : '생각'}</span>
        {ms != null && <span className="tm" aria-hidden="true">{seconds(ms)}</span>}
        <span className="chev" aria-hidden="true"><Icon name="down" /></span>
      </button>
      <div className="think-body" id={id} ref={body} hidden={!open}>
        {p.text || '…'}
      </div>
    </div>
  );
}

const TOOL_ICON: Record<string, IconName> = { calculator: 'calc', current_time: 'clock' };
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
  else if (p.argsText || p.args !== undefined) rows.push({ k: '입력', v: p.args !== undefined ? show(p.args) : p.argsText, mono: true });
  if (p.status === 'running' || p.status === 'cancelled') return rows;
  if (res && 'error' in res) {
    rows.push({ k: '오류', v: show(res.message) || show(res.error), err: true });
  } else if (p.name === 'calculator' && res && 'result' in res) {
    rows.push({ k: '결과', v: show(res.result), mono: true });
  } else if (p.name === 'current_time' && res && 'date' in res) {
    rows.push({ k: '결과', v: `${show(res.date)} ${show(res.time)} ${show(res.weekday)}${res.utc_offset ? ` (UTC${show(res.utc_offset)})` : ''}` });
  } else if (p.result !== undefined) {
    rows.push({ k: '결과', v: show(p.result), mono: true });
  }
  return rows;
}

function ToolCard({ p }: { p: ToolPart }) {
  const st = TOOL_STATE[p.status];
  return (
    <div className="tcard enter" data-state={p.status} role="group" aria-label={`${p.label} 도구`}>
      <div className="th">
        <span className="ttile" aria-hidden="true"><Icon name={TOOL_ICON[p.name] ?? 'wrench'} /></span>
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
            <dd className={r.mono ? 'mono' : undefined}>{r.v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
