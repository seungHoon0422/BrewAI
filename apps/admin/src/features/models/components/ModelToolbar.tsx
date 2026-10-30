import { Button, Input, Segmented, Select, Toolbar, ToolbarSpacer } from '@brewai/ui';
import { COPY, STATE_FILTERS, type StateFilter } from '../copy';
import type { Counts, ProviderSummary } from '../derive';

// 상태별 개수 (분할 버튼 글 옆 숫자). 숨김 = 사라짐 포함 · 전체 = 모든 줄
const countOf = (f: StateFilter, c: Counts, total: number) =>
  f === 'all' ? total : f === 'hidden' ? c.hidden + c.missing : c[f];

// 붙는 도구 줄: 검색 · 제공사(고르기 상자) · 상태 (고르는 동안엔 제공사 · 상태 자리에 일괄 버튼)
export function ModelToolbar({
  query, onQuery, total, counts, providers, provider, onProvider, stateFilter, onStateFilter, picked, busy, onBulk, onProbePicked, onClearSel,
}: {
  query: string;
  onQuery: (q: string) => void;
  total: number;
  counts: Counts;
  providers: ProviderSummary[];
  provider: string;
  onProvider: (id: string) => void;
  stateFilter: StateFilter;
  onStateFilter: (f: StateFilter) => void;
  picked: number;
  busy: boolean;
  onBulk: (expose: boolean) => void;
  onProbePicked: () => void;
  onClearSel: () => void;
}) {
  const providerOptions = [
    { value: 'all', label: COPY.allProviders(total) },
    ...providers.map((p) => ({ value: p.id, label: COPY.providerOption(p.label, p.total, p.exposed) })),
  ];
  const stateOptions = STATE_FILTERS.map((f) => ({
    value: f.value,
    label: <>{f.label}{' '}<span className={f.value === 'problem' && counts.problem > 0 ? 'mseg-n bad' : 'mseg-n'}>{countOf(f.value, counts, total)}</span></>,
  }));
  return (
    <Toolbar sticky className="mbar">
      <Input type="search" icon="search" className="msearch" aria-label={COPY.search} placeholder={COPY.searchHint} value={query} spellCheck={false}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.preventDefault(); onQuery(''); } }} />
      {picked > 0 ? (
        <div className="mbulk" role="toolbar" aria-label={COPY.bulk}>
          <b>{COPY.picked(picked)}</b>
          <Button size="sm" disabled={busy} onClick={() => onBulk(true)}>{COPY.expose}</Button>
          <Button size="sm" disabled={busy} onClick={() => onBulk(false)}>{COPY.hide}</Button>
          <Button size="sm" disabled={busy} onClick={onProbePicked}>{COPY.probe}</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onClearSel}>{COPY.clearSel}</Button>
        </div>
      ) : (
        <div className="mfilters" role="group" aria-label={COPY.filters}>
          <Select className="mprov-pick" aria-label={COPY.providerFilter} options={providerOptions} value={provider}
            onChange={(e) => onProvider(e.target.value)} />
          <ToolbarSpacer />
          <Segmented size="sm" label={COPY.stateGroup} options={stateOptions} value={stateFilter} onChange={onStateFilter} className="mseg" />
        </div>
      )}
    </Toolbar>
  );
}
