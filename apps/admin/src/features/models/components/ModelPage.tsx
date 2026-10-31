import { useId, useRef, useState, type ReactNode } from 'react';
import {
  Button, Callout, Card, CardHeader, EmptyState, IconButton, KeyValue, LinkButton, PageHeader, ProviderIcon, Skeleton, Switch, providerLabel,
} from '@brewai/ui';
import type { AdminModel, GatewayInfo } from '../api';
import { COPY, LOAD_ERROR, SOURCE } from '../copy';
import { ago, canExpose, canProbe, failed, fixFor, latency, neighbors, perM, providerName, tokens, type Dup } from '../derive';
import type { ModelsApi, TestState } from '../hooks';
import { tabHref } from '../route';
import { Caps } from './Caps';
import { Health, HealthText, healthLine } from './Health';
import type { ModelPanelProps } from './ModelListTab';
import { DefaultBadge, DupBadge, NameEditor, SourceBadge, StateBadge } from './NameCell';

// 모델 자세히 페이지 ('#/models/<gateway_id>' — 링크로 바로 · 뒤로 · 앞으로). 위 줄(← 모델 목록 · 세션)은 틀(App.tsx)이 그린다.
// 머리 = 제공사 아이콘 · 보이는 이름(h1) / 실제 모델 이름(고정폭 · 옅게) · 딱지 · 오른쪽에 [노출] [기본 모델로 정하기] [연결 테스트].
// 몸 = 두 칸 (≥1100 · 좁으면 한 칸): 왼쪽 = 사용자 앱(여기서 정하는 것) · 연결 / 오른쪽 = 게이트웨이 값(읽기 전용 · LiteLLM 에서 바꾼다).
// 입력칸 = 표시 이름 바꿀 때 하나뿐 (가격 · 제공사 · 컨텍스트 입력칸 없음 — e2e admin.spec)
export function ModelPage({ id, api, view }: ModelPanelProps & { id: string }) {
  const h1 = useRef<HTMLHeadingElement>(null);
  const m = api.rows.find((r) => r.id === id) ?? null;
  const idLine = <code className="mid" title={COPY.gatewayId}>{id}</code>;

  if (api.state.kind === 'loading') {
    return (
      <div className="mpage">
        <PageHeader divider className="mhead" titleRef={h1} title={id} description={COPY.loading} />
        <Skeleton lines={4} />
      </div>
    );
  }
  if (api.state.kind === 'error') {
    return (
      <div className="mpage">
        <PageHeader divider className="mhead" titleRef={h1} title={id} />
        <Callout tone="danger" icon="plug" action={<Button size="sm" onClick={api.reload}>{COPY.retry}</Button>}>
          <span role="alert">{LOAD_ERROR[api.state.error]}</span>
        </Callout>
      </div>
    );
  }
  if (!m) {
    return (
      <div className="mpage">
        <PageHeader divider className="mhead" titleRef={h1} title={COPY.page.notFound} description={idLine} />
        <EmptyState icon="search" title={COPY.page.notFoundWhy}
          action={<LinkButton size="sm" icon="chevron-left" href={tabHref('list')}>{COPY.page.toList}</LinkButton>}>
          {COPY.page.notFoundHow}
        </EmptyState>
      </div>
    );
  }

  const busy = api.isBusy(m.id);
  const test = api.testOf(m.id);
  return (
    <div className="mpage" data-model={m.id}>
      <PageHeader divider className="mhead" titleRef={h1}
        icon={<ProviderIcon provider={m.provider} size="lg" label={providerName(m)} />}
        title={m.label}
        meta={<HeadTags m={m} dup={view.dupOf(m)} />}
        description={idLine}
        actions={<HeadActions m={m} busy={busy} test={test} api={api} />} />

      {api.flash && (
        <Callout live tone={api.flash.kind === 'error' ? 'danger' : 'ok'} className="flash" onDismiss={api.dismissFlash} dismissLabel={COPY.dismiss}>
          {api.flash.text}
        </Callout>
      )}

      <div className="mgrid">
        <div className="mcol">
          <AppCard m={m} rows={api.rows} dup={view.dupOf(m)} busy={busy} api={api} />
          <HealthCard m={m} test={test} now={api.now} gateway={api.gateway} />
        </div>
        <div className="mcol">
          <GatewayCard m={m} now={api.now} gateway={api.gateway} />
        </div>
      </div>
    </div>
  );
}

function HeadTags({ m, dup }: { m: AdminModel; dup: Dup }) {
  return (
    <span className="mtags">
      <StateBadge state={m.state} />
      {m.is_default && <DefaultBadge />}
      <DupBadge dup={dup} />
      {m.source && <SourceBadge source={m.source} title={SOURCE[m.source].long} />}
    </span>
  );
}

// 머리 오른쪽: 여기서 자주 하는 일 셋. 노출 · 기본은 표와 같은 규칙 (대화 모델 · 게이트웨이에 있는 것만 노출 · 노출한 것만 기본)
function HeadActions({ m, busy, test, api }: { m: AdminModel; busy: boolean; test: TestState | undefined; api: ModelsApi }) {
  const exposeWhy = !m.is_chat ? COPY.notChat : m.status === 'missing' ? COPY.missing : COPY.page.exposeTitle;
  return (
    <div className="mhead-act">
      <Switch checked={m.exposed} label={COPY.page.expose} title={exposeWhy} className="mhead-sw"
        disabled={busy || (!canExpose(m) && !m.exposed)} onCheckedChange={(on) => void api.change(m, { exposed: on })} />
      <Button size="sm" icon={m.is_default ? 'check' : undefined} disabled={busy || !m.exposed || m.is_default}
        title={m.exposed ? COPY.defaultTitle : COPY.defaultNeedsExposed}
        onClick={() => void api.change(m, { is_default: true }, COPY.done.defaultChanged(m.label))}>
        {m.is_default ? COPY.isDefault : COPY.makeDefault}
      </Button>
      {canProbe(m) && (
        <>
          <span className="mhead-sep" aria-hidden="true" />
          <Health m={m} test={test} onProbe={api.probe} now={api.now} head />
        </>
      )}
    </div>
  );
}

// 카드 하나 = section (이름 = 카드 제목 · E2E 가 이름으로 찾는다)
function Part({ title, hint, actions, children, className }: { title: string; hint?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <Card as="section" padding="lg" className={className ? `mcard ${className}` : 'mcard'} aria-labelledby={id}>
      <CardHeader level={2} title={<span id={id}>{title}</span>} description={hint} actions={actions} />
      <div className="mcard-body">{children}</div>
    </Card>
  );
}

// 사용자 앱 = 여기서 정하는 것: 표시 이름(바꾸기 · 되돌리기) · 노출 · 기본 · 순서(전체 순서에서 한 칸 위 · 아래)
function AppCard({ m, rows, dup, busy, api }: { m: AdminModel; rows: AdminModel[]; dup: Dup; busy: boolean; api: ModelsApi }) {
  const [editing, setEditing] = useState(false);
  const { at, total, prev, next } = neighbors(rows, m);
  const app = COPY.app;
  const exposeText = m.exposed ? COPY.shown : !m.is_chat ? COPY.notChat : m.status === 'missing' ? COPY.missing
    : m.state === 'candidate' ? COPY.candidateHidden : COPY.hidden;
  const defaultText = m.is_default ? COPY.isDefaultLong : m.exposed ? COPY.notDefault : COPY.defaultNeedsExposed;
  return (
    <Part title={COPY.partApp} hint={COPY.appHint} className="mapp">
      <div className="dset">
        <span className="dlab">{app.name}</span>
        {editing ? (
          <NameEditor m={m} busy={busy} onChange={api.change} label={COPY.nameFieldInPage} onDone={() => setEditing(false)} />
        ) : (
          <div className="drow">
            <b className="dname">{m.label}</b>
            <span className="dbtns">
              <Button size="sm" icon="pen" disabled={busy} onClick={() => setEditing(true)}>{COPY.renameBtn}</Button>
              {m.display_name && (
                <Button size="sm" variant="ghost" disabled={busy}
                  onClick={() => void api.change(m, { display_name: null }, COPY.done.nameReverted(m.default_label))}>
                  {COPY.backToDefault(m.default_label)}
                </Button>
              )}
            </span>
          </div>
        )}

        <span className="dlab">{app.expose}</span>
        <div className="drow" data-on={m.exposed ? '' : undefined}>{exposeText}</div>

        <span className="dlab">{app.default}</span>
        <div className="drow">{defaultText}</div>

        {m.status === 'present' && (
          <>
            <span className="dlab">{app.order}</span>
            <div className="drow dord">
              <span title={COPY.orderIn}><b className="ui-num">{at + 1}</b> / {total}</span>
              <IconButton size="sm" icon="arrow-up" label={COPY.moveUp} disabled={busy || !prev} onClick={() => prev && api.change(m, { order: prev.order })} />
              <IconButton size="sm" icon="arrow-down" label={COPY.moveDown} disabled={busy || !next} onClick={() => next && api.change(m, { order: next.order })} />
            </div>
          </>
        )}
      </div>
      {dup === 'user' && <Callout tone="warn" className="dwarn">{COPY.dupUserLong}</Callout>}
      {dup === 'hidden' && <Callout className="dwarn soft">{COPY.dupHiddenLong}</Callout>}
    </Part>
  );
}

// 연결 = 마지막 결과 · 응답 시간 · 마지막 정상 / 오류 때 + 고치는 곳 (+ LiteLLM 에서 고치기). 테스트 버튼은 머리에 (결과는 여기도 같이 바뀐다)
function HealthCard({ m, test, now, gateway }: { m: AdminModel; test: TestState | undefined; now: number; gateway: GatewayInfo | null }) {
  const h = COPY.health;
  const line = healthLine(m, test, now);
  const err = failed(m) && m.last_error_code ? fixFor(m, m.last_error_code) : null;
  const fixUrl = err?.litellm ? gateway?.ui_url || undefined : undefined;
  // 응답 시간 = 방금 테스트한 그 결과가 아직 마지막 결과일 때만 (그 뒤 대화 오류 · 동기화로 바뀌었으면 옛 숫자를 보이지 않는다)
  const ms = test?.phase === 'done' && (test.at === m.last_ok_at || test.at === m.last_error_at) ? test.ms : null;
  const lastError = m.last_error_at
    ? `${ago(m.last_error_at, now)}${m.last_error_code ? `, ${fixFor(m, m.last_error_code).short}` : ''}`
    : h.none;
  return (
    <Part title={COPY.partHealth} hint={COPY.healthHint} className="mhealth">
      {!canProbe(m) ? (
        <p className="dnote">{m.is_chat ? COPY.noProbeMissing : COPY.noProbeChat}</p>
      ) : (
        <>
          <KeyValue variant="plain" className="dkv" items={[
            { key: 'last', label: h.last, value: <HealthText line={line} live={false} /> },
            { key: 'latency', label: h.latency, value: ms !== null ? <span className="ui-num">{latency(ms)}</span> : <span className="dmuted">{h.notTested}</span> },
            { key: 'ok', label: h.lastOk, value: ago(m.last_ok_at, now) ?? h.none },
            { key: 'error', label: h.lastError, value: lastError },
          ]} />
          {err && (
            <Callout tone="warn" icon="alert" title={COPY.fixTitle} className="dfix"
              action={fixUrl ? (
                <LinkButton size="sm" icon="external" href={fixUrl} target="_blank" rel="noopener noreferrer" title={COPY.addTitle(fixUrl)}>{COPY.fixInLitellm}</LinkButton>
              ) : undefined}>
              <span className="hhint">{err.hint}</span>
            </Callout>
          )}
        </>
      )}
    </Part>
  );
}

// 게이트웨이 값 = 읽기 전용 스냅샷 (LiteLLM /model_group/info · /v1/model/info). 바꾸는 곳 = LiteLLM
function GatewayCard({ m, now, gateway }: { m: AdminModel; now: number; gateway: GatewayInfo | null }) {
  const kv = COPY.kv;
  const cost = (c: number | null) => (perM(c) ? kv.perM(perM(c)!) : '—');
  return (
    <Part title={COPY.partGateway} hint={COPY.readOnly} className="mgw"
      actions={gateway?.ui_url ? (
        <LinkButton size="sm" variant="ghost" icon="external" href={gateway.ui_url} target="_blank" rel="noopener noreferrer" title={COPY.addTitle(gateway.ui_url)}>
          {COPY.page.openInLitellm}
        </LinkButton>
      ) : undefined}>
      <KeyValue variant="plain" className="dkv" items={[
        {
          key: 'provider', label: kv.provider,
          value: (
            <span className="dprov">
              <ProviderIcon provider={m.provider} size="sm" />
              {[providerName(m), ...m.provider_ids.slice(1).map((p) => providerLabel(p))].join(', ')}
              {m.family ? <span className="dhint">{COPY.familyOf(m.family)}</span> : null}
            </span>
          ),
        },
        { key: 'context', label: kv.context, value: tokens(m.max_input_tokens) ? kv.tokens(tokens(m.max_input_tokens)!) : '—' },
        { key: 'maxOut', label: kv.maxOut, value: tokens(m.max_output_tokens) ? kv.tokens(tokens(m.max_output_tokens)!) : '—' },
        { key: 'input', label: kv.input, value: cost(m.input_cost_per_token) },
        { key: 'output', label: kv.output, value: cost(m.output_cost_per_token) },
        { key: 'features', label: kv.features, value: <Caps m={m} labeled /> },
        { key: 'source', label: kv.source, value: m.source ? SOURCE[m.source].long : kv.unknownSource },
        { key: 'first', label: kv.firstSeen, value: ago(m.first_seen, now) ?? '—' },
        { key: 'last', label: kv.lastSeen, value: ago(m.last_seen, now) ?? '—' },
      ]} />
    </Part>
  );
}
