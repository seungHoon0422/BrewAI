// 생각 · 도구 상태 줄(.trace-line) = 유리 알약 하나 + 누르면 펼치는 유리 패널. 글은 trace.ts · 문구는 copy.ts.
// 흐르는 동안 세 모양: 첫 이벤트 전 = 점 셋 + '응답을 기다리는 중' (반짝임 없음) → 생각하는 동안 = 반짝임 아이콘 + '생각하는 중'
// (글 위로 옅은 빛이 지나간다 · 움직임 줄이기 = 멈춘 글) → 도구 · 팀 · 답 쓰기 = 숨 쉬는 막대 + 그 일 (도구 · 팀 문구가 먼저).
// 끝나면 '1.2초 동안 생각함' 'Exa 웹 검색 2회' 조각을 칸 나눔으로 (가운뎃점 없음 · 생각 글이 없으면 시간 없이 '생각함').
// 패널 = 나온 순서대로 생각 블록(조용한 글 · 왼쪽 선)과 도구 블록(카드: 이름 · 입력 · 결과 · 상태)이 확실히 다르게.
// 앱 도구 고르기 = 한 줄 메모 · 생각 글이 안 온 생각(토큰만)은 블록을 그리지 않는다 (빈 생각 블록 없음).
// 끝난 답에 패널에 그릴 것이 없으면 (토큰만 · 생각 건너뜀 · 한 일 없이 멈춤) 줄은 버튼이 아닌 알약 = 펼치지 않는다 + 작은 글 '생각 토큰 N'.
// 생각 글과 도구 카드는 줄을 눌러야 보인다 (기본 접힘 · 흐르는 중에도). 색 점으로 상태를 나누지 않는다 — 글 · 아이콘 · 움직임으로만.
// 팀 (slice 06) = TeamGroup: 병렬 묶음 모양 · 팀원마다 막대 · 팀원 줄(역할 · 할 일 · 상태) 아래 그 팀원의 도구 줄 · '오른쪽에서 보기'.
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon, Meta, Spinner, type IconName } from '@brewai/ui';
import type { CSSProperties } from 'react';
import { seconds } from '../../../lib/format';
import { reduceMotion, useNow, useThrottled } from '../../../lib/hooks';
import { AppIcon } from '../../connections/components/AppIcon';
import { appLabels } from '../../connections/hooks';
import { useSkillLabels, useToolLabels } from '../../skills/hooks';
import { TEAM, TOOL, TRACE, teamReason } from '../copy';
import { Markdown } from '../markdown/render';
import { isLive, type Answer, type MemberStep, type ReasoningPart, type TeamMember, type ToolPart } from '../model';
import { groupTiming, hasPanel, isMemberPick, memberAppName, memberDone, memberFailed, panelItems, shortDuration, thought, thoughtParts, tracePhrase, usedTools, type ToolGroup, type TraceKind } from '../trace';
import { AppNote, ToolCard } from './ToolCard';

const ANNOUNCE_MS = 2000;

// onTeam = 오른쪽 진행 상황 열기 (팀이 있는 답 · 대화 화면이 준다)
export function TraceView({ a, onTeam }: { a: Answer; onTeam?: () => void }) {
  const tools = useToolLabels();
  const skills = useSkillLabels();
  const live = isLive(a);
  const now = useNow(live);
  const [open, setOpen] = useState(false); // 기본 접힘 (흐르는 중에도) · 사용자가 누른 대로 둔다
  const panelId = useId();
  const line = useRef<HTMLButtonElement>(null);
  const chip = useRef<HTMLDivElement>(null);
  const hadFocus = useRef(false);
  const t = tracePhrase(a, tools, skills);
  const failed = a.status === 'failed';
  const phase = failed ? 'stopped' : t.phase;
  const step = failed ? 'stopped' : t.step;
  const kind: TraceKind = failed ? 'stopped' : t.kind;
  const parts = failed ? [TRACE.stopped] : t.parts;
  const meta = failed ? [] : t.meta;
  const text = failed ? TRACE.stopped : t.text;
  const elapsed = live ? now - a.startedAt : null;
  const glyph = glyphOf(kind, a);
  // 펼칠 것이 있나: 흐르는 중 = 늘 (곧 생긴다) · 끝 = 생각 글이나 도구가 있을 때만 (빈 패널 없음)
  const expandable = live || hasPanel(a);
  // 화면 읽기: 버튼 이름 = 지금 글 그대로 (시간 빼고) · 바뀐 글 알림은 버튼 밖 live 영역에서 2초에 한 번 (끝 · 멈춤은 바로)
  const announced = useThrottled(text, ANNOUNCE_MS, phase !== 'live');
  // 흐르던 버튼에 포커스가 있었는데 끝나서 알약이 되면 = 포커스를 알약으로 옮긴다 (몸으로 떨어지지 않게 · 버튼은 이 그리기 뒤에 빠진다)
  if (!expandable && line.current && line.current === document.activeElement) hadFocus.current = true;
  useLayoutEffect(() => {
    if (expandable || !hadFocus.current) return;
    hadFocus.current = false;
    chip.current?.focus();
  }, [expandable]);

  const onPanelKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
    line.current?.focus();
  };

  const body = (
    <>
      <TraceGlyph kind={glyph} />
      <TraceText parts={parts} text={text} run={kind === 'thinking' || kind === 'busy'} />
      {meta.length > 0 && <span className="tmeta ui-num" aria-hidden="true">{meta.join(' ')}</span>}
      {elapsed != null && <span className="tm ui-num" aria-hidden="true">{seconds(elapsed)}</span>}
    </>
  );
  return (
    <div className="trace" data-open={open && expandable}>
      {expandable ? (
        <button ref={line} className="trace-line ui-glass" type="button" data-step={step} data-phase={phase} data-kind={kind} data-glyph={glyph}
          aria-expanded={open} aria-controls={panelId} aria-label={text} title={open ? TRACE.closeTitle : TRACE.openTitle}
          onClick={() => setOpen((v) => !v)}>
          {body}
          <span className="chev" aria-hidden="true"><Icon name="chevron-down" size="xs" /></span>
        </button>
      ) : (
        // 펼치지 않는 알약 = 버튼 아님 (누를 것 없음 · 꺾쇠 없음). 이름 = 보이는 글 그대로 · tabIndex -1 = 포커스 옮겨 받기만
        <div ref={chip} className="trace-line ui-glass" role="group" tabIndex={-1} data-static="true" data-step={step} data-phase={phase} data-kind={kind}
          data-glyph={glyph} aria-label={text}>
          {body}
        </div>
      )}
      {/* .sr = e2e 훅 (trace > .sr[aria-live]) · 모양은 ui-sr */}
      <span className="sr ui-sr" aria-live="polite">{announced}</span>
      {expandable && (
        <div className="trace-panel ui-glass" id={panelId} role="region" aria-label={TRACE.region} hidden={!open} onKeyDown={onPanelKey}>
          {open && <TracePanel a={a} now={now} onTeam={onTeam} />}
        </div>
      )}
    </div>
  );
}

// 줄 아이콘. 흐르는 중: 기다림 = 점 셋 · 생각 = 반짝임 · 도구 · 팀 · 답 쓰기 = 숨 쉬는 막대
// 끝 = 한 일: 생각했으면 말풍선 · 도구만 썼으면 렌치 · 생각을 건너뛰었으면 체크 · 멈춤 = 네모
type GlyphKind = 'wait' | 'spark' | 'live' | 'think' | 'tool' | 'done' | 'stop';
const glyphOf = (kind: TraceKind, a: Answer): GlyphKind =>
  kind === 'waiting' ? 'wait' : kind === 'thinking' ? 'spark' : kind === 'busy' ? 'live' : kind === 'stopped' ? 'stop'
  : thought(a) ? 'think' : usedTools(a) ? 'tool' : 'done';
const GLYPH: Record<Exclude<GlyphKind, 'live' | 'wait'>, IconName> = { spark: 'sparkle', think: 'think', tool: 'wrench', done: 'check', stop: 'stop' };
function TraceGlyph({ kind }: { kind: GlyphKind }) {
  if (kind === 'live') return <span className="glyph breath" aria-hidden="true"><i /><i /><i /></span>;
  if (kind === 'wait') return <span className="glyph dots" aria-hidden="true"><i /><i /><i /></span>;
  return <span className="glyph" data-glyph-icon={kind} aria-hidden="true"><Icon name={GLYPH[kind]} size="sm" /></span>;
}

// 글: 생각 · 일하는 동안(run) 옅은 빛이 글 위로 지나간다 (기다림엔 없음) · 바뀔 때 겹쳐 사라짐(160ms) · 폭은 200ms 동안 이어진다 · 조각 = 칸 나눔
function TraceText({ parts, text, run }: { parts: string[]; text: string; run: boolean }) {
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
    <span ref={ref} className={run ? 'trace-txt run' : 'trace-txt'} aria-hidden="true">
      <span key={text} className="ph">
        {parts.map((p, i) => <span key={i} className="seg">{p}</span>)}
      </span>
    </span>
  );
}

function TracePanel({ a, now, onTeam }: { a: Answer; now: number; onTeam?: () => void }) {
  const thinking = new Set<Answer['parts'][number]>(thoughtParts(a));
  const items = a.parts.filter((p) => p.kind === 'tool' || thinking.has(p));
  const live = isLive(a);
  // 끝난 답은 그릴 것이 있을 때만 패널이 있다 (hasPanel) → 빈 줄 글은 흐르는 중에만
  const foot = !live && a.usage ? TRACE.usage(a.usage) : [];
  const apps = appLabels();
  return (
    <>
      {items.length > 0 && (
        <ol className="tp-list">
          {panelItems(items.filter((p): p is ReasoningPart | ToolPart => p.kind !== 'text')).map((it) =>
            it.kind === 'think' ? <li key={it.part.id}><ThinkBlock p={it.part} now={now} /></li>
            : it.kind === 'note' ? <li key={it.part.id}><AppNote p={it.part} apps={apps} /></li>
            : it.kind === 'tool' ? <li key={it.part.id}><ToolCard p={it.part} /></li>
            : it.kind === 'team' ? <li key={`t${it.group.batch}:${it.group.tools[0].id}`}><TeamGroup g={it.group} team={a.team ?? []} now={now} onTeam={onTeam} /></li>
            : <li key={`g${it.group.batch}:${it.group.tools[0].id}`}><ParallelGroup g={it.group} now={now} /></li>)}
        </ol>
      )}
      {items.length === 0 && live && <p className="tp-none">{TRACE.noneLive}</p>}
      {foot.length > 0 && <p className="tp-foot ui-num">{foot.map((f) => <span key={f}>{f}</span>)}</p>}
    </>
  );
}

// 동시에 돈 도구 묶음 = 머리 줄('동시에 3개' · 걸린 시간 · 하나씩이면) + 실행 막대(모두 같은 때 시작 · 길이 = 실행 시간) + 카드들
// 시간은 모두 실행 시간 (모델이 인자를 다 쓴 뒤 ~ 결과) = 머리 줄 '하나씩이면' = 카드 시간의 합
function ParallelGroup({ g, now }: { g: ToolGroup; now: number }) {
  const n = g.tools.length;
  const timing = groupTiming(g, now);
  const running = g.tools.filter((p) => p.status === 'running').length;
  const meta = running > 0 ? [TOOL.parallelRunning(running)]
    : timing?.done ? [TOOL.wall(shortDuration(timing.wall)), TOOL.serial(shortDuration(timing.sum))] : [];
  return (
    <section className="tp-par" data-kind="parallel" data-count={n} data-running={running > 0} role="group" aria-label={TOOL.parallel(n)}>
      <h4 className="tp-par-h">
        <Icon name="layers" size="sm" />
        <span className="tp-par-n">{TOOL.parallel(n)}</span>
        <Meta className="tp-par-meta ui-num" items={meta} />
      </h4>
      {timing && timing.lanes.length > 0 && (
        <ol className="tp-lanes" aria-label={TOOL.lanes}>
          {timing.lanes.map((l, i) => (
            <li key={l.id} className="tp-lane" data-running={l.running} aria-label={g.tools[i].label}
              style={{ '--to': l.to.toFixed(4) } as CSSProperties}>
              <i className="run" aria-hidden="true" />
            </li>
          ))}
        </ol>
      )}
      <ol className="tp-par-list">
        {g.tools.map((p) => <li key={p.id}><ToolCard p={p} took={timing?.done ? shortDuration(timing.run[p.id] ?? 0) : undefined} /></li>)}
      </ol>
    </section>
  );
}

// 팀 묶음 = 병렬 묶음과 같은 모양: 머리 줄('팀원 2명이 나눠서' · 시간 · 오른쪽에서 보기) + 팀원마다 막대 + 팀원 줄 (역할 · 할 일 · 상태)
// 그 아래 팀원이 쓴 도구 (앱 고르기 = 한 줄 메모 · 앱 도구 = 카드 머리 줄). 거절된 호출(한 명뿐 · 자리 없음) = 평범한 도구 카드
function TeamGroup({ g, team, now, onTeam }: { g: ToolGroup; team: TeamMember[]; now: number; onTeam?: () => void }) {
  const rows = g.tools.map((p) => ({ p, m: team.find((x) => x.callId === p.id && !x.code?.startsWith('team_')) }));
  const members = rows.filter((r) => r.m);
  const n = members.length;
  if (!n) {
    return <ol className="tp-par-list">{g.tools.map((p) => <li key={p.id}><ToolCard p={p} /></li>)}</ol>;
  }
  const timing = groupTiming({ batch: g.batch, tools: members.map((r) => r.p) }, now);
  const running = members.filter((r) => r.m && !memberDone(r.m)).length;
  const meta = running > 0 ? [TEAM.running(running)]
    : timing?.done ? [TOOL.wall(shortDuration(timing.wall)), TOOL.serial(shortDuration(timing.sum))] : [];
  return (
    <section className="tp-par tp-team" data-kind="team" data-count={n} data-running={running > 0} role="group" aria-label={TEAM.group(n)}>
      <h4 className="tp-par-h">
        <Icon name="team" size="sm" />
        <span className="tp-par-n">{TEAM.group(n)}</span>
        <Meta className="tp-par-meta ui-num" items={meta} />
        {onTeam && <button type="button" className="tp-team-open" onClick={onTeam}>{TEAM.openPanel}</button>}
      </h4>
      {timing && timing.lanes.length > 0 && (
        <ol className="tp-lanes" aria-label={TOOL.lanes}>
          {timing.lanes.map((l, i) => (
            <li key={l.id} className="tp-lane" data-running={l.running} aria-label={members[i].m?.role ?? members[i].p.label}
              style={{ '--to': l.to.toFixed(4) } as CSSProperties}>
              <i className="run" aria-hidden="true" />
            </li>
          ))}
        </ol>
      )}
      <ol className="tp-par-list">
        {rows.map(({ p, m }) => (
          <li key={p.id}>{m ? <MemberBlock m={m} now={now} /> : <ToolCard p={p} />}</li>
        ))}
      </ol>
    </section>
  );
}

// 팀원 상태 = 글 + 아이콘 + 움직임 (색 점 없음)
export const MEMBER_ICON: Partial<Record<TeamMember['status'], IconName>> = { waiting: 'clock', done: 'check', error: 'close', cancelled: 'stop', waiting_user: 'alert' };
export function MemberState({ status, took, id }: { status: TeamMember['status'] | MemberStep['status']; took?: string; id?: string }) {
  const icon = MEMBER_ICON[status as TeamMember['status']];
  return (
    <span className="tst" id={id}>
      {status === 'running' ? <Spinner size="xs" /> : icon && <Icon name={icon} size="sm" />}
      <span>{TEAM.state[status]}</span>
      {took && <span className="tm ui-num">{took}</span>}
    </span>
  );
}
// 팀원이 걸린 시간: 도는 중 = 시작부터 지금까지 · 끝 = 끝 이벤트의 ms (1초 아래 = ms · 기록엔 없다 = 빈칸)
export const memberTook = (m: TeamMember, now: number) =>
  memberDone(m) ? (m.ms == null ? '' : shortDuration(m.ms)) : m.at ? seconds(now - m.at) : '';
// 팀원 도구 줄 시간 = 1초 아래는 ms ('0.0초' 대신 · 묶음 시간과 같은 규칙)
export const stepTook = (s: MemberStep, now: number) =>
  s.status === 'running' ? (s.at ? seconds(now - s.at) : '') : s.durationMs == null ? '' : shortDuration(s.durationMs);

function MemberBlock({ m, now }: { m: TeamMember; now: number }) {
  return (
    <div className="tp-tool tp-member" data-kind="member" data-agent={m.agent} data-state={m.status} role="group" aria-label={m.role}>
      <div className="th">
        <span className="ttile" aria-hidden="true"><Icon name="user" size="sm" /></span>
        <b title={m.role}>{m.role}</b>
        <span className="tp-member-task" title={m.task}>{m.task}</span>
        <MemberState status={m.status} took={memberTook(m, now)} />
      </div>
      {memberFailed(m) && <p className="tp-member-why">{teamReason(m.code)}</p>}
      {m.steps.length > 0 && (
        <ol className="tp-member-steps" aria-label={TEAM.tools(m.role)}>
          {m.steps.map((st) => (
            <li key={st.id}>{isMemberPick(st) ? <MemberPick s={st} /> : <ToolCard p={stepPart(st)} took={stepTook(st, now) || undefined} />}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

// 팀원 도구 줄 → 도구 카드 모양 (입력 · 결과는 팀원 대화 안이라 없다 = 머리 줄만)
function stepPart(s: MemberStep): ToolPart {
  const status = s.status === 'waiting' ? 'waiting' : s.status;
  return {
    kind: 'tool', id: s.id, name: s.name.replace(/^tool:/, ''), label: s.label, argsText: '', args: undefined, result: undefined, status,
    ms: s.durationMs, at: s.at, ready: null, batch: 0, ...(s.app ? { app: { handle: s.app, name: memberAppName(s) || s.app, write: false } } : {}),
  };
}
// 팀원의 앱 고르기 = 한 줄 메모 (이름표 '앱: <이름>')
function MemberPick({ s }: { s: MemberStep }) {
  return (
    <p className="tp-note" data-kind="member-pick" data-step={s.name} data-state={s.status} data-app={s.app ?? undefined}>
      {s.status === 'running' ? <Spinner size="xs" />
        : s.status === 'error' || s.status === 'cancelled' || !s.app ? <Icon name={s.status === 'error' ? 'close' : s.status === 'cancelled' ? 'stop' : 'plug'} size="sm" />
        : <AppIcon handle={s.app} name={memberAppName(s) || s.app} size="xs" />}
      <span className="tn">{s.label}</span>
    </p>
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
        {p.text ? <Markdown text={p.text} live={p.live} smooth={false} /> : '…'}
        {p.live && !p.text && <span className="caret" aria-hidden="true">▍</span>}
      </div>
    </section>
  );
}
