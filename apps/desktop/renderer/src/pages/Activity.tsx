// 진행 상황 — 지금 하는 일(이 창의 진행 중인 실행 · 단계가 실시간으로) + 최근 실행 (GET /api/runs).
// 팀(총괄 → 담당 → 도구) 그래프는 서브에이전트가 생기는 P4 에서. 지금은 실행 하나 = 단계 줄 (생각 → 도구 → 답 쓰기).
import { useEffect, useMemo, useState } from 'react';
import { ApiError, listRuns, type Failure, type RunRow, type Step } from '../api';
import { Icon } from '../icons';
import { href } from '../menu';
import { go } from '../router';
import { ProviderIcon, providerLabel } from '../providers';
import { useNow } from '../chat/Answer';
import { isLive, openThread, useDupCheck, useSession, useSkillLabels, type Answer } from '../chat/session';
import { FAILURE_TEXT, RUN_STATUS, STEP_DOT, ago, reasoningLabel, runErrorText, seconds, stepPhrase, tracePhrase } from '../chat/text';
import { Empty, Page, Section } from './Page';

type Live = { threadId: string; title: string; answer: Answer };
type Runs = { status: 'loading' | 'ready' | 'error'; rows: RunRow[]; error: Failure | null };

const openChat = (id: string) => {
  openThread(id);
  go('chat');
};

export function Activity() {
  const convs = useSession((s) => s.convs);
  const version = useSession((s) => s.runsVersion);
  const live = useMemo<Live[]>(
    () =>
      Object.values(convs).flatMap((c) =>
        c.turns.filter((t) => isLive(t.answer)).map((t) => ({ threadId: c.id, title: c.title, answer: t.answer })),
      ),
    [convs],
  );
  const [runs, setRuns] = useState<Runs>({ status: 'loading', rows: [], error: null });
  const [tick, setTick] = useState(0);
  const serverRunning = runs.rows.some((r) => r.status === 'running');

  useEffect(() => {
    const ctrl = new AbortController();
    listRuns(ctrl.signal).then(
      (rows) => setRuns({ status: 'ready', rows, error: null }),
      (e) => {
        if ((e as Error).name !== 'AbortError') setRuns((r) => ({ ...r, status: 'error', error: e instanceof ApiError ? e.kind : 'server' }));
      },
    );
    return () => ctrl.abort();
  }, [version, tick]);

  // 다른 창에서 돌고 있는 실행이 있으면 3초마다 다시 (이 창 실행은 store 가 실시간)
  useEffect(() => {
    if (!serverRunning && live.length === 0) return;
    const t = setInterval(() => setTick((x) => x + 1), 3000);
    return () => clearInterval(t);
  }, [serverRunning, live.length]);

  const liveIds = new Set(live.map((l) => l.answer.runId));
  const recent = runs.rows.filter((r) => !liveIds.has(r.id));

  return (
    <Page id="activity" sub="맡긴 일을 지금 어디까지 했는지, 어떤 모델이 어떤 도구를 썼는지 보여요.">
      <Section title="지금 하는 일" extra={live.length > 0 && <span className="count">{live.length}</span>}>
        {live.length === 0 ? (
          <Empty
            icon="team"
            title="진행 중인 작업이 없어요"
            text="대화에서 일을 맡기면 생각 · 도구 사용 · 답 쓰기 단계가 여기에 실시간으로 쌓여요."
            action={<a className="btn primary" href={href('chat')}>일 맡기기</a>}
          />
        ) : (
          <ul className="rows live">
            {live.map((l) => <LiveRun key={l.answer.runId} l={l} />)}
          </ul>
        )}
      </Section>

      <Section title="최근 실행" extra={runs.status === 'ready' && recent.length > 0 && <span className="count">{recent.length}</span>}>
        {runs.status === 'loading' && runs.rows.length === 0 && (
          <p className="rows-state"><span className="spin12" aria-hidden="true" />불러오는 중…</p>
        )}
        {runs.status === 'error' && (
          <div className="rows-state" role="alert">
            <span>실행 기록을 불러오지 못했어요 · {FAILURE_TEXT[runs.error ?? 'server']}</span>
            <button className="btn" type="button" onClick={() => setTick((x) => x + 1)}>다시 시도</button>
          </div>
        )}
        {runs.status === 'ready' && recent.length === 0 && <p className="rows-state">아직 실행 기록이 없어요</p>}
        {recent.length > 0 && (
          <ul className="rows runs" aria-label="최근 실행">
            {recent.map((r) => <RunItem key={r.id} r={r} />)}
          </ul>
        )}
      </Section>
    </Page>
  );
}

function LiveRun({ l }: { l: Live }) {
  const tools = useSession((s) => s.tools);
  const skills = useSkillLabels();
  const now = useNow(true);
  const a = l.answer;
  return (
    <li className="row run-live" data-run={a.runId}>
      <span className="dot" data-state="run" aria-hidden="true" />
      <div className="row-main">
        <button className="row-link" type="button" onClick={() => openChat(l.threadId)} title="대화 열기">
          <b className="ell">{l.title}</b>
        </button>
        <span className="row-sub">
          <span className="doing">{tracePhrase(a, now, tools, skills).text}</span>
          <span aria-hidden="true"> · {seconds(now - a.startedAt)}</span>
        </span>
        <Steps steps={a.steps} live now={now - a.startedAt} tools={tools} skills={skills} />
      </div>
      {a.model && <ModelTag id={a.model.id} provider={a.model.provider} providerName={a.model.provider_label} label={a.model.label} reasoning={a.reasoning} />}
    </li>
  );
}

function RunItem({ r }: { r: RunRow }) {
  const st = RUN_STATUS[r.status];
  const sub = [
    r.status === 'error' || r.status === 'cancelled' ? runErrorText(r.error_code) : st.label,
    seconds(r.duration_ms),
    ago(r.started_at),
  ].filter(Boolean).join(' · ');
  return (
    <li className="row" data-run={r.id} data-status={r.status}>
      <span className="dot" data-state={st.dot} aria-hidden="true" />
      <div className="row-main">
        <button className="row-link" type="button" onClick={() => openChat(r.thread_id)} title="대화 열기">
          <b className="ell">{r.thread_title}</b>
        </button>
        <span className="row-sub"><span className="sr">{st.label} · </span>{sub}</span>
        <Steps steps={r.steps} />
      </div>
      <ModelTag id={r.model} provider={r.provider} providerName={r.provider_label} label={r.model_label} reasoning={r.reasoning} />
    </li>
  );
}

function Steps({ steps, live, now = 0, tools = {}, skills = {} }: {
  steps: Step[]; live?: boolean; now?: number; tools?: Record<string, string>; skills?: Record<string, string>;
}) {
  if (!steps.length) return null;
  return (
    <ol className="chain" aria-label="단계">
      {steps.map((s, i) => (
        <li key={`${s.name}-${i}`} data-state={STEP_DOT[s.status]}>
          {i > 0 && <span className="arr" aria-hidden="true"><Icon name="right" small /></span>}
          <span className="dot" aria-hidden="true" />
          <span>{live && s.status === 'running' ? stepPhrase(s.name, now - s.started_ms, tools, skills) : s.label}</span>
          <span className="tm">{s.status === 'running' ? seconds(now - s.started_ms) : seconds(s.duration_ms)}</span>
        </li>
      ))}
    </ol>
  );
}

// 같은 이름의 다른 모델이 있으면 id 도 (모델 메뉴 · 답 아래 줄과 같은 규칙)
function ModelTag({ id, provider, providerName, label, reasoning }: { id: string; provider: string; providerName: string; label: string; reasoning: string }) {
  const dup = useDupCheck();
  const think = reasoning === 'low' || reasoning === 'high' ? ` · 생각 ${reasoningLabel(reasoning)}` : '';
  const twin = dup({ id, label });
  return (
    <span className="mtag" title={`${providerLabel(provider, providerName)} · ${label}${label !== id ? ` (${id})` : ''}${think}`}>
      <ProviderIcon provider={provider} />
      <span className="ell">{label}</span>
      {twin && <span className="mid">{id}</span>}
    </span>
  );
}
