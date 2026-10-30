import { Button, Chip, Input, ProviderIcon, Segmented, StatusDot, Toolbar, ToolbarSpacer } from '@brewai/ui';
import { COPY, STATE_FILTERS, type StateFilter } from '../copy';
import type { ProviderSummary } from '../derive';

// 붙는 도구 줄: 검색 · 회사 칩 · 상태 (고르는 동안엔 회사 · 상태 자리에 일괄 버튼)
export function ModelToolbar({
  query, onQuery, total, providers, provider, onProvider, stateFilter, onStateFilter, picked, busy, onBulk, onProbePicked, onClearSel,
}: {
  query: string;
  onQuery: (q: string) => void;
  total: number;
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
        <>
          <div className="mchips" role="toolbar" aria-label={COPY.byProvider}>
            {/* 글 = '전체 3' · 'OpenAI2노출 1' (E2E) — 이름 · 개수 사이 공백은 칩 간격이 그린다 */}
            <Chip selected={provider === 'all'} count={total} aria-label={COPY.allChip(total)} onClick={() => onProvider('all')}>
              {COPY.all}{' '}
            </Chip>
            {providers.map((p) => (
              <Chip key={p.id} selected={provider === p.id} data-provider={p.id} icon={<ProviderIcon provider={p.id} size="sm" />}
                count={<>{p.total}<span className="mchip-on"><StatusDot state="ok" size="sm" />{COPY.exposedCount(p.exposed)}</span></>}
                aria-label={COPY.providerChip(p.label, p.total, p.exposed)} title={COPY.providerTitle(p.label, p.total, p.exposed)}
                onClick={() => onProvider(p.id)}>
                {p.label}
              </Chip>
            ))}
          </div>
          <ToolbarSpacer />
          <Segmented size="sm" label={COPY.stateGroup} options={STATE_FILTERS} value={stateFilter} onChange={onStateFilter} className="mseg" />
        </>
      )}
    </Toolbar>
  );
}
