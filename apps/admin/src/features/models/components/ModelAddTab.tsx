import { Badge, Button, Callout, EmptyState, ProviderIcon, Skeleton } from '@brewai/ui';
import type { AdminModel } from '../api';
import { COL_LABEL, COPY, LOAD_ERROR } from '../copy';
import { candidatesOf, perM, providerName, tokens } from '../derive';
import { Caps } from './Caps';
import { Health } from './Health';
import type { ModelPanelProps } from './ModelListTab';
import { AddInLitellm, LastSync, SyncButton } from './SyncBar';

// 모델 추가 탭 = 등록은 LiteLLM 에서만 (ADR-0006). 여기는 ① LiteLLM 에서 등록 ② 동기화 ③ 후보 확인 → 노출 순서 안내 + 후보 목록.
// 입력칸 없음 (제공사 · 가격 · 컨텍스트는 게이트웨이 값 — e2e admin.spec 이 본다)
export function ModelAddTab({ api, view }: ModelPanelProps) {
  const { state } = api;
  const cands = candidatesOf(api.rows);
  const a = COPY.add;
  return (
    <div className="models madd">
      <Callout icon="lock" className="note">{COPY.boundary}</Callout>

      <section className="msec" aria-labelledby="madd-steps">
        <h2 id="madd-steps" className="msec-title">{a.steps}</h2>
        <ol className="msteps">
          <li className="mstep">
            <span className="mstep-n ui-num" aria-hidden="true">1</span>
            <div className="mstep-body">
              <b>{a.s1.title}</b>
              <p>{a.s1.body.map((t, i) => (i % 2 ? <code key={i}>{t}</code> : t))}</p>
            </div>
            <div className="mstep-act"><AddInLitellm gateway={api.gateway} /></div>
          </li>
          <li className="mstep">
            <span className="mstep-n ui-num" aria-hidden="true">2</span>
            <div className="mstep-body">
              <b>{a.s2.title}</b>
              <p>{a.s2.body}</p>
            </div>
            <div className="mstep-act">
              <LastSync gateway={api.gateway} now={api.now} />
              <SyncButton syncing={api.syncing} loading={state.kind === 'loading'} onSync={() => void api.sync()} />
            </div>
          </li>
          <li className="mstep">
            <span className="mstep-n ui-num" aria-hidden="true">3</span>
            <div className="mstep-body">
              <b>{a.s3.title}</b>
              <p>{a.s3.body}</p>
            </div>
          </li>
        </ol>
      </section>

      <section className="msec" aria-labelledby="madd-cands">
        <h2 id="madd-cands" className="msec-title">
          {a.candTitle}
          {state.kind === 'ok' && <Badge size="sm" tone={cands.length ? 'info' : 'neutral'} className="ui-num">{cands.length}</Badge>}
        </h2>
        {state.kind === 'loading' && <Skeleton lines={2} />}
        {state.kind === 'error' && (
          <Callout tone="danger" icon="plug" action={<Button size="sm" onClick={api.reload}>{COPY.retry}</Button>}>
            <span role="alert">{LOAD_ERROR[state.error]}</span>
          </Callout>
        )}
        {state.kind === 'ok' && cands.length === 0 && (
          <EmptyState icon="inbox" title={a.candEmpty}>{a.candEmptyHow}</EmptyState>
        )}
        {cands.length > 0 && (
          <ul className="mcands" aria-label={a.candTitle}>
            {cands.map((m) => (
              <Candidate key={m.id} m={m} busy={api.isBusy(m.id)} now={api.now} onOpen={() => view.setOpenId(m.id)}
                onProbe={api.probe}
                onExpose={() => void api.change(m, { exposed: true }, a.exposed(m.label))}
                onKeep={() => void api.change(m, { exposed: false }, a.kept(m.label))} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// 후보 한 줄: 제공사 · 이름(두 줄) · 기능 · 컨텍스트 · 비용 · 연결 · [숨김으로 두기] [노출하기]
function Candidate({ m, busy, now, onOpen, onProbe, onExpose, onKeep }: {
  m: AdminModel; busy: boolean; now: number; onOpen: () => void; onProbe: (m: AdminModel) => Promise<void>; onExpose: () => void; onKeep: () => void;
}) {
  const a = COPY.add;
  const ctx = tokens(m.max_input_tokens);
  const cost = [perM(m.input_cost_per_token), perM(m.output_cost_per_token)];
  return (
    <li className="mcand" data-model={m.id} aria-busy={busy}>
      <span className="mcand-prov" title={providerName(m)}><ProviderIcon provider={m.provider} size="lg" label={providerName(m)} /></span>
      <div className="ncell mcand-name">
        <button className="nbtn" type="button" onClick={onOpen} title={COPY.detailsTitle} aria-label={COPY.details(m.label)}>
          <b className="ui-ell">{m.label}</b>
        </button>
        <span className="sub"><code className="mid ui-ell" title={COPY.gatewayId}>{m.id}</code></span>
      </div>
      <div className="mcand-meta">
        <Caps m={m} />
        {ctx && <span className="ui-num" title={COL_LABEL.context}>{ctx}</span>}
        {(cost[0] || cost[1]) && (
          <span className="ui-num" title={COPY.costPair}>{cost[0] ?? '—'} / {cost[1] ?? '—'}</span>
        )}
      </div>
      <Health m={m} busy={busy} onProbe={onProbe} now={now} />
      <div className="mcand-act">
        <Button size="sm" variant="ghost" disabled={busy} aria-label={a.keepHiddenLabel(m.label)} title={a.keepHiddenTitle} onClick={onKeep}>{a.keepHidden}</Button>
        <Button size="sm" variant="primary" disabled={busy} aria-label={a.exposeLabel(m.label)} onClick={onExpose}>{a.expose}</Button>
      </div>
    </li>
  );
}
