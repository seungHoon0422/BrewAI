// 진행 상황 — 지금 하는 일(이 창의 진행 중인 실행 · 단계가 실시간으로) + 최근 실행 (GET /api/runs).
// 팀(총괄 → 담당 → 도구) 그래프는 서브에이전트가 생기는 P4 에서. 지금은 실행 하나 = 단계 줄 (생각 → 도구 → 답 쓰기).
import { Button, Callout, Icon, LinkButton, Meta, Spinner, StatusDot, providerLabel } from '@brewai/ui';
import { href } from '../../../app/menu';
import { openChat } from '../../../app/navigate';
import { ago, seconds } from '../../../lib/format';
import { useNow } from '../../../lib/hooks';
import { FAILURE_TEXT, stepPhrase } from '../../chat/copy';
import type { Step } from '../../chat/api';
import { tracePhrase } from '../../chat/trace';
import { ModelName } from '../../models/components/ModelName';
import { reasoningTag } from '../../models/copy';
import { useSkillLabels, useToolLabels } from '../../skills/hooks';
import { Count, Empty, Page, Section } from '../../shell/components/Page';
import type { RunRow } from '../api';
import { ACTIVITY, RUN_STATUS, STEP_DOT, runErrorText } from '../copy';
import { useLiveRuns, useRecentRuns, type LiveRun } from '../hooks';


export function ActivityScreen() {
  const live = useLiveRuns();
  const { runs, reload } = useRecentRuns(live.length);
  const liveIds = new Set(live.map((l) => l.answer.runId));
  const recent = runs.rows.filter((r) => !liveIds.has(r.id));

  return (
    <Page id="activity" sub={ACTIVITY.sub}>
      <Section title={ACTIVITY.live} extra={live.length > 0 && <Count n={live.length} />}>
        {live.length === 0 ? (
          <Empty
            icon="team"
            title={ACTIVITY.liveEmpty}
            text={ACTIVITY.liveEmptyText}
            action={<LinkButton variant="primary" href={href('chat')}>{ACTIVITY.liveEmptyAction}</LinkButton>}
          />
        ) : (
          <ul className="rows live">
            {live.map((l) => <LiveRunRow key={l.answer.runId} l={l} />)}
          </ul>
        )}
      </Section>

      <Section title={ACTIVITY.recent} extra={runs.status === 'ready' && recent.length > 0 && <Count n={recent.length} />}>
        {runs.status === 'loading' && runs.rows.length === 0 && (
          <p className="rows-state"><Spinner size="xs" />{ACTIVITY.loading}</p>
        )}
        {runs.status === 'error' && (
          <Callout tone="danger" live action={<Button size="sm" onClick={reload}>{ACTIVITY.retry}</Button>}>
            {ACTIVITY.loadFailed(FAILURE_TEXT[runs.error ?? 'server'])}
          </Callout>
        )}
        {runs.status === 'ready' && recent.length === 0 && <p className="rows-state">{ACTIVITY.recentEmpty}</p>}
        {recent.length > 0 && (
          <ul className="rows runs" aria-label={ACTIVITY.recent}>
            {recent.map((r) => <RunItem key={r.id} r={r} />)}
          </ul>
        )}
      </Section>
    </Page>
  );
}

function LiveRunRow({ l }: { l: LiveRun }) {
  const tools = useToolLabels();
  const skills = useSkillLabels();
  const now = useNow(true);
  const a = l.answer;
  return (
    <li className="row run-live" data-run={a.runId}>
      <StatusDot state="run" />
      <div className="row-main">
        <button className="row-link" type="button" onClick={() => openChat(l.threadId)} title={ACTIVITY.openChat}>
          <b className="ui-ell">{l.title}</b>
        </button>
        <Meta className="row-sub" items={[
          <span className="doing">{tracePhrase(a, now, tools, skills).text}</span>,
          <span aria-hidden="true">{seconds(now - a.startedAt)}</span>,
        ]} />
        <Steps steps={a.steps} live now={now - a.startedAt} tools={tools} skills={skills} />
      </div>
      {a.model && <ModelTag model={a.model} reasoning={a.reasoning} />}
    </li>
  );
}

function RunItem({ r }: { r: RunRow }) {
  const st = RUN_STATUS[r.status];
  const sub = [
    r.status === 'error' || r.status === 'cancelled' ? runErrorText(r.error_code) : st.label,
    seconds(r.duration_ms),
    ago(r.started_at),
  ];
  return (
    <li className="row" data-run={r.id} data-status={r.status}>
      <StatusDot state={st.dot} />
      <div className="row-main">
        <button className="row-link" type="button" onClick={() => openChat(r.thread_id)} title={ACTIVITY.openChat}>
          <b className="ui-ell">{r.thread_title}</b>
        </button>
        <span className="row-sub"><span className="ui-sr">{st.label}, </span><Meta items={sub} /></span>
        <Steps steps={r.steps} />
      </div>
      <ModelTag model={{ id: r.model, label: r.model_label, provider: r.provider, provider_label: r.provider_label }} reasoning={r.reasoning} />
    </li>
  );
}

function Steps({ steps, live, now = 0, tools = {}, skills = {} }: {
  steps: Step[]; live?: boolean; now?: number; tools?: Record<string, string>; skills?: Record<string, string>;
}) {
  if (!steps.length) return null;
  return (
    <ol className="chain" aria-label={ACTIVITY.steps}>
      {steps.map((s, i) => (
        <li key={`${s.name}-${i}`} data-state={STEP_DOT[s.status]}>
          {i > 0 && <span className="arr" aria-hidden="true"><Icon name="chevron-right" size="xs" /></span>}
          <StatusDot state={STEP_DOT[s.status]} size="sm" />
          <span>{live && s.status === 'running' ? stepPhrase(s.name, now - s.started_ms, tools, skills) : s.label}</span>
          <span className="tm ui-num">{s.status === 'running' ? seconds(now - s.started_ms) : seconds(s.duration_ms)}</span>
        </li>
      ))}
    </ol>
  );
}

// 답한 모델 꼬리표 (같은 이름의 다른 모델이 있으면 id 도 — 모델 메뉴 · 답 아래 줄과 같은 규칙)
function ModelTag({ model, reasoning }: { model: { id: string; label: string; provider: string; provider_label: string }; reasoning: string }) {
  const think = reasoningTag(reasoning);
  const name = `${model.label}${model.label !== model.id ? ` (${model.id})` : ''}`;
  return (
    <span className="mtag" title={[providerLabel(model.provider, model.provider_label), name, think].filter(Boolean).join(', ')}>
      <ModelName model={model} />
    </span>
  );
}
