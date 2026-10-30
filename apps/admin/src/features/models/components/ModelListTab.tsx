import { Button, Callout, LinkButton } from '@brewai/ui';
import { hrefOf } from '../../../app/routes';
import { EmptyTable } from '../../../shared/components/EmptyTable';
import type { AdminModel } from '../api';
import { COPY, LOAD_ERROR } from '../copy';
import { COL_LABELS, providerName } from '../derive';
import type { ModelsApi, ModelView } from '../hooks';
import { ModelTable } from './ModelTable';
import { ModelToolbar } from './ModelToolbar';

export type ModelPanelProps = { api: ModelsApi; view: ModelView };

// 모델 목록 탭 = (후보 알림) → 도구 줄(검색 · 제공사 · 상태 · 여러 개 고르기) → 표 한 장 → 줄을 누르면 서랍
export function ModelListTab({ api, view }: ModelPanelProps) {
  const { state, rows } = api;
  const ready = state.kind === 'ok';

  // 끌어서 순서 바꾸기 (전체 보기에서만 · 같은 제공사 안에서만 · 키보드는 ↑↓ 버튼)
  const reorder = (src: AdminModel, target: AdminModel) => {
    if (src.id === target.id || target.status === 'missing' || target.provider !== src.provider) return;
    void api.change(src, { order: target.order }, COPY.done.moved(src.label, providerName(src), view.posOf.get(target.id) ?? ''));
  };

  return (
    <div className="models">
      {ready && view.counts.candidate > 0 && (
        <Callout tone="info" icon="plus" className="cand"
          action={<LinkButton size="sm" variant="ghost" href={hrefOf('models', 'add')}>{COPY.toCandidates}</LinkButton>}>
          {COPY.candidates(view.counts.candidate).map((t, i) => (i === 1 ? <b key={i}>{t}</b> : t))}
        </Callout>
      )}

      {ready && rows.length > 0 && (
        <ModelToolbar query={view.query} onQuery={view.setQuery} total={rows.length} counts={view.counts} providers={view.providers}
          provider={view.provider} onProvider={view.setProvider} stateFilter={view.stateFilter} onStateFilter={view.setStateFilter}
          picked={view.picked.length} busy={api.bulkBusy}
          onBulk={(expose) => void api.bulk(view.picked, expose, view.clearSel)}
          onProbePicked={() => void api.probeMany(view.picked, view.clearSel)} onClearSel={view.clearSel} />
      )}

      {state.kind === 'loading' && <EmptyTable label={COPY.table} cols={COL_LABELS.slice(1)} loading />}
      {state.kind === 'error' && (
        <EmptyTable label={COPY.table} cols={COL_LABELS.slice(1)} icon="plug" title={<span role="alert">{LOAD_ERROR[state.error]}</span>}
          action={<Button onClick={api.reload}>{COPY.retry}</Button>} />
      )}
      {ready && rows.length === 0 && (
        <EmptyTable label={COPY.table} cols={COL_LABELS.slice(1)} icon="plug" title={COPY.empty}
          action={<LinkButton size="sm" href={hrefOf('models', 'add')}>{COPY.howToAdd}</LinkButton>}>
          {COPY.emptyHow.map((t, i) => (i % 2 ? <code key={i}>{t}</code> : t))}
        </EmptyTable>
      )}
      {ready && rows.length > 0 && (
        <>
          <ModelTable view={view} isBusy={api.isBusy} now={api.now} onChange={api.change} onProbe={api.probe} onReorder={reorder} />
          <p className="mfoot">
            {COPY.foot}{' '}
            {COPY.footGateway.map((t, i) => (i % 2 ? <code key={i}>{t}</code> : t))}
          </p>
        </>
      )}
    </div>
  );
}
