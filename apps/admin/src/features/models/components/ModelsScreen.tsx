import { Button, Callout } from '@brewai/ui';
import { EmptyTable } from '../../../shared/components/EmptyTable';
import type { AdminModel } from '../api';
import { COPY, LOAD_ERROR } from '../copy';
import { COL_LABELS, countsOf, providerName } from '../derive';
import { useModels, useModelView } from '../hooks';
import '../models.css';
import { ModelSheet } from './ModelSheet';
import { ModelTable } from './ModelTable';
import { ModelToolbar } from './ModelToolbar';
import { SummaryCards } from './SummaryCards';
import { SyncBar } from './SyncBar';

// 모델 등록은 LiteLLM 에서만 (Admin UI · config.yaml). 여기서 정하는 것 = 노출 · 표시 이름 · 순서 · 기본 모델 (ADR-0006).
// 가격 · 컨텍스트 · 회사(provider)는 게이트웨이 값이라 입력칸 없이 보여 주기만 한다 (e2e admin.spec 이 입력칸이 없는지 본다).
// 화면 = 요약 카드(누르면 그 상태만) → 도구 줄(검색 · 회사 · 상태 · 여러 개 고르기) → 회사별로 묶은 목록 → 줄을 누르면 오른쪽 서랍(자세히 · 고치기).
export default function ModelsScreen() {
  const api = useModels();
  const view = useModelView(api.rows);
  const { state, rows } = api;
  const ready = state.kind === 'ok';
  const counts = countsOf(rows);
  const open = view.open;

  // 끌어서 순서 바꾸기 (전체 보기에서만 · 같은 회사 안에서만 · 키보드는 ↑↓ 버튼)
  const reorder = (src: AdminModel, target: AdminModel) => {
    if (src.id === target.id || target.status === 'missing' || target.provider !== src.provider) return;
    void api.change(src, { order: target.order }, COPY.done.moved(src.label, providerName(src), view.posOf.get(target.id) ?? ''));
  };

  return (
    <div className="models">
      <Callout icon="lock" className="note">{COPY.boundary}</Callout>

      <div className="mhead">
        <SummaryCards counts={counts} ready={ready} filter={view.stateFilter} onPick={view.pickCard} />
        <SyncBar gateway={api.gateway} now={api.now} syncing={api.syncing} loading={state.kind === 'loading'}
          canProbeAll={ready && counts.exposed > 0} probing={api.bulkBusy}
          onSync={() => void api.sync()} onProbeAll={() => void api.probeMany(rows.filter((r) => r.status === 'present' && r.exposed))} />
      </div>

      {api.flash && (
        <Callout live tone={api.flash.kind === 'error' ? 'danger' : 'ok'} className="flash" onDismiss={api.dismissFlash} dismissLabel={COPY.dismiss}>
          {api.flash.text}
        </Callout>
      )}

      {ready && counts.candidate > 0 && (
        <Callout tone="info" icon="plus" className="cand"
          action={<Button size="sm" variant="ghost" onClick={() => view.setStateFilter('candidate')}>{COPY.onlyCandidates}</Button>}>
          {COPY.candidates(counts.candidate).map((t, i) => (i === 1 ? <b key={i}>{t}</b> : t))}
        </Callout>
      )}

      {ready && rows.length > 0 && (
        <ModelToolbar query={view.query} onQuery={view.setQuery} total={rows.length} providers={view.providers}
          provider={view.provider} onProvider={view.setProvider} stateFilter={view.stateFilter} onStateFilter={view.setStateFilter}
          picked={view.picked.length} busy={api.bulkBusy}
          onBulk={(expose) => void api.bulk(view.picked, expose, view.clearSel)}
          onProbePicked={() => void api.probeMany(view.picked, view.clearSel)} onClearSel={view.clearSel} />
      )}

      {state.kind === 'loading' && <EmptyTable label={COPY.table} cols={COL_LABELS} loading />}
      {state.kind === 'error' && (
        <EmptyTable label={COPY.table} cols={COL_LABELS} icon="plug" title={<span role="alert">{LOAD_ERROR[state.error]}</span>}
          action={<Button onClick={api.reload}>{COPY.retry}</Button>} />
      )}
      {ready && rows.length === 0 && (
        <EmptyTable label={COPY.table} cols={COL_LABELS} icon="plug" title={COPY.empty}>
          {COPY.emptyHow.map((t, i) => (i % 2 ? <code key={i}>{t}</code> : t))}
        </EmptyTable>
      )}
      {ready && rows.length > 0 && (
        <>
          <ModelTable rows={rows} view={view} isBusy={api.isBusy} now={api.now} onChange={api.change} onProbe={api.probe} onReorder={reorder} />
          <p className="mfoot">
            {COPY.foot}{' '}
            {COPY.footGateway.map((t, i) => (i % 2 ? <code key={i}>{t}</code> : t))}
          </p>
        </>
      )}

      <ModelSheet m={open} rows={rows} dup={open ? view.dupOf(open) : null} busy={open ? api.isBusy(open.id) : false}
        gateway={api.gateway} now={api.now} onChange={api.change} onProbe={api.probe} onClose={() => view.setOpenId(null)} />
    </div>
  );
}
