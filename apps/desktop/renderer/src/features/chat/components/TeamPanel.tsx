// 오른쪽 '진행 상황' (slice 06 · design/prototype.html 의 팀 패널을 보고 새로 그림) — 요약 줄 · 트리(총괄 → 팀원 → 도구 줄) · 팀원 펼침.
// 대화에서 처음 팀이 생기면 저절로 열린다 (넓은 창만 · 좁으면 머리 토글로 덮개). 닫음은 대화마다 기억한다 (localStorage · 막혀 있어도 화면은 돈다).
// 상태 = 글 + 아이콘 + 움직임 (색 점 없음 · TraceView 와 같은 규칙). 역할 · 할 일 = 글자로만 (마크다운 · HTML 아님).
// 덮개 = 사람이 열면 포커스가 패널로 (토글이 덮개 밑에 숨는다) · Esc 는 문서 어디서나 · 닫으면 포커스는 토글로 (ChatScreen onClose).
import { useEffect, useId, useRef, useState } from 'react';
import { Badge, Icon, IconButton, Meta } from '@brewai/ui';
import { useMedia, useNow, useThrottled } from '../../../lib/hooks';
import { createStore } from '../../../lib/store';
import { TEAM, teamReason } from '../copy';
import { isLive, type Answer, type Conv, type TeamMember } from '../model';
import { hasTeam, isMemberPick, memberDone, memberFailed, teamOf } from '../trace';
import { MemberState, memberTook, stepTook } from './TraceView';

const ANNOUNCE_MS = 2000;
export const WIDE = '(min-width: 1100px)'; // chat.css .thread.has-team 2열과 같은 폭

// ── 열림 상태 (대화마다) — open · closed = 사람이 고른 것 · 없음 = 팀이 생기면 저절로 (넓은 창) ──
type Pref = 'open' | 'closed';
const PREF_KEY = 'brewai.chat.teamPanel';
const PREF_MAX = 50; // 오래된 대화 기억은 버린다
function readPrefs(): Record<string, Pref> {
  try {
    const raw = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') as Record<string, unknown>;
    return Object.fromEntries(Object.entries(raw).filter((e): e is [string, Pref] => e[1] === 'open' || e[1] === 'closed'));
  } catch {
    return {};
  }
}
const store = createStore<Record<string, Pref>>(readPrefs());
function setPref(threadId: string, pref: Pref) {
  store.set((s) => {
    const next = { ...s };
    delete next[threadId];
    next[threadId] = pref; // 맨 뒤 = 최근
    const keys = Object.keys(next);
    for (const k of keys.slice(0, Math.max(0, keys.length - PREF_MAX))) delete next[k];
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(next));
    } catch {}
    return next;
  });
}
// 패널이 보여 줄 답 (대화마다 · 이 창에서만): '오른쪽에서 보기' 를 누른 답. over = 그때의 마지막 팀 답 →
// 그 뒤 새 팀이 생기면 새 팀을 보여 준다 · 머리 토글로 열면 고른 답을 지운다 (= 마지막 팀 답)
type Pick = { runId: string; over: string | null };
const picks = createStore<Record<string, Pick>>({});
let focusOnOpen: string | null = null; // 사람이 방금 연 대화 (덮개면 포커스를 패널로 · 저절로 열림 · 다시 그림엔 안 옮긴다)
export function openTeamPanel(threadId: string, pick?: Pick) {
  picks.set((s) => {
    if (!pick && !(threadId in s)) return s;
    const next = { ...s };
    if (pick) next[threadId] = pick;
    else delete next[threadId];
    return next;
  });
  focusOnOpen = threadId;
  setPref(threadId, 'open');
}
export const closeTeamPanel = (threadId: string) => setPref(threadId, 'closed');

// 팀이 생긴 마지막 답 (없으면 null) · pick = '오른쪽에서 보기' 로 고른 답 (그 뒤 새 팀이 없을 때만)
export const lastTeamAnswer = (conv: Conv): Answer | null => conv.turns.findLast((t) => hasTeam(t.answer))?.answer ?? null;
export function teamAnswer(conv: Conv, pick?: Pick): Answer | null {
  const last = lastTeamAnswer(conv);
  if (!pick || !last || pick.over !== last.runId) return last;
  return conv.turns.find((t) => t.answer.runId === pick.runId && hasTeam(t.answer))?.answer ?? last;
}

// 대화 화면이 쓴다: 팀이 있나 · 열렸나 · 넓은 창(2열)인가 (새 대화 = 없음)
export function useTeamPanel(conv: Conv | undefined) {
  const pref = store.use((s) => (conv ? s[conv.id] : undefined));
  const wide = useMedia(WIDE);
  const team = conv?.turns.some((t) => hasTeam(t.answer)) ?? false;
  const open = team && (pref === 'open' || (pref === undefined && wide));
  return { team, open, wide };
}

// onClose = 닫은 뒤 (대화 화면이 포커스를 머리 토글로 돌린다)
export function TeamPanel({ conv, overlay, onClose }: { conv: Conv; overlay: boolean; onClose?: () => void }) {
  const pick = picks.use((s) => s[conv.id]);
  const a = teamAnswer(conv, pick);
  const live = a ? isLive(a) : false;
  const now = useNow(live);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const close = () => {
    closeTeamPanel(conv.id);
    onClose?.();
  };
  // 덮개(좁은 창)를 사람이 열었다 = 포커스를 닫기 버튼으로 (토글 · 보내기 버튼이 덮개 밑에 있다)
  useEffect(() => {
    if (focusOnOpen !== conv.id) return;
    focusOnOpen = null;
    if (overlay) closeBtn.current?.focus();
  }, [conv.id, overlay]);
  // 덮개 = Esc 로 닫는다 (포커스가 패널 밖이어도 · 다른 곳이 먼저 쓴 Esc 는 건너뛴다)
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!overlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [overlay]);
  return (
    <aside className="team-panel" aria-label={TEAM.panel} data-overlay={overlay || undefined}>
      <div className="team-head">
        <h2 className="ttl">{TEAM.panel}</h2>
        <IconButton ref={closeBtn} icon="close" size="sm" label={TEAM.close} onClick={close} />
      </div>
      {a && <TeamBody a={a} now={now} />}
    </aside>
  );
}

// 요약 줄: 일을 나누는 중 → n명이 함께 일하는 중 → n명이 함께 끝냈어요 · n명 중 k명이 끝냈어요 (+ 실패 수) · 멈춤 · 실행이 끊김
function summary(a: Answer, members: TeamMember[]): { text: string; meta: string[] } {
  const n = members.length;
  const failed = members.filter(memberFailed).length;
  const done = members.filter((m) => m.status === 'done').length;
  const meta = failed && done ? [TEAM.failedN(failed)] : [];
  if (!n) return { text: a.status === 'failed' ? TEAM.cut : TEAM.splitting, meta };
  if (a.status === 'failed') return { text: TEAM.cut, meta }; // 총괄 쪽 (게이트웨이 · 연결)이 끊겼다 = 팀원 탓이 아니다
  if (members.some((m) => !memberDone(m))) return { text: isLive(a) ? TEAM.together(n) : TEAM.stopped, meta };
  if (a.status === 'stopped' || members.some((m) => m.status === 'cancelled')) return { text: TEAM.stopped, meta };
  if (!done) return { text: TEAM.allFailed(n), meta };
  return { text: done === n ? TEAM.finished(n) : TEAM.partly(n, done), meta };
}

const leadStatus = (a: Answer): TeamMember['status'] =>
  isLive(a) ? 'running' : a.status === 'done' ? 'done' : a.status === 'stopped' ? 'cancelled' : 'error';

function TeamBody({ a, now }: { a: Answer; now: number }) {
  const members = teamOf(a);
  const s = summary(a, members);
  // 화면 읽기 = 2초에 한 번 (끝 · 멈춤은 바로)
  const announced = useThrottled(s.text, ANNOUNCE_MS, !isLive(a));
  const lead = leadStatus(a);
  return (
    <>
      <p className="team-sum" data-state={lead}>
        <span className="team-sum-t">{s.text}</span>
        <Meta className="team-sum-meta" items={s.meta} />
      </p>
      <span className="sr ui-sr" aria-live="polite">{announced}</span>
      <div className="team-tree ui-scroll">
        <div className="tm-node" data-kind="lead" data-state={lead}>
          <div className="tm-row">
            <span className="tm-ico" aria-hidden="true"><Icon name="team" size="sm" /></span>
            <b>{TEAM.lead}</b>
            <span className="tm-role">{TEAM.leadRole}</span>
            <MemberState status={lead} />
          </div>
          {members.length > 0 && (
            <ol className="tm-kids" aria-label={TEAM.tree}>
              {members.map((m) => <li key={m.callId}><MemberNode m={m} now={now} /></li>)}
            </ol>
          )}
        </div>
      </div>
    </>
  );
}

// 팀원 줄 = 누르면 펼침 (맡은 일 · 모델 · 받은 도구 · 사용량) · 그 아래 도구 줄
function MemberNode({ m, now }: { m: TeamMember; now: number }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const tools = m.tools.filter((t) => t.name);
  const why = memberFailed(m);
  // 이름 = '<역할> 자세히' (짧게) · 설명 = 할 일 + 상태 · 시간 + 실패 이유 (화면 읽기가 펼치지 않아도 상태를 읽는다)
  const described = [`${id}-task`, `${id}-state`, ...(why ? [`${id}-why`] : [])].join(' ');
  return (
    <div className="tm-node" data-kind="member" data-agent={m.agent} data-state={m.status}>
      <button type="button" className="tm-row" aria-expanded={open} aria-controls={id} aria-label={TEAM.details(m.role)} aria-describedby={described}
        onClick={() => setOpen((v) => !v)}>
        <span className="tm-ico" aria-hidden="true"><Icon name="user" size="sm" /></span>
        <b>{m.role}</b>
        <span className="tm-role" id={`${id}-task`} title={m.task}>{m.task}</span>
        <MemberState id={`${id}-state`} status={m.status} took={memberTook(m, now)} />
        <span className="chev" aria-hidden="true"><Icon name="chevron-down" size="xs" /></span>
      </button>
      {why && <p className="tm-why" id={`${id}-why`}>{teamReason(m.code)}</p>}
      <dl className="tm-detail" id={id} hidden={!open}>
        <div data-row="task"><dt>{TEAM.task}</dt><dd>{m.task}</dd></div>
        <div data-row="model"><dt>{TEAM.model}</dt><dd>{m.modelLabel}</dd></div>
        <div data-row="tools">
          <dt>{TEAM.given}</dt>
          <dd>{tools.length ? (
            <span className="tm-chips">{tools.map((t) => <Badge key={t.name} size="sm" title={t.name}>{t.label}</Badge>)}</span>
          ) : TEAM.noTools}</dd>
        </div>
        {m.usage && (
          <div data-row="usage">
            <dt>{TEAM.usage}</dt>
            <dd><Meta className="ui-num" items={[TEAM.requests(m.usage.requests), TEAM.tokens(m.usage.input_tokens, m.usage.output_tokens)]} /></dd>
          </div>
        )}
      </dl>
      {m.steps.length > 0 && (
        <ol className="tm-tools" aria-label={TEAM.tools(m.role)}>
          {m.steps.map((st) => (
            <li key={st.id} className="tm-tool" data-state={st.status} data-step={st.name} data-app={st.app ?? undefined}>
              <span className="ti" aria-hidden="true"><Icon name={st.app || isMemberPick(st) ? 'plug' : 'wrench'} size="xs" /></span>
              <span className="tl" title={st.label}>{st.label}</span>
              <MemberState status={st.status} took={stepTook(st, now)} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
