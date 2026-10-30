import { Button, EmptyState, TableFrame } from '@brewai/ui';
import type { AdminModel } from '../api';
import { modelHref } from '../route';
import { COL_LABEL, COL_TITLE, COPY } from '../copy';
import { COL_IDS, neighbors } from '../derive';
import type { Change, ModelView, Probe, TestState } from '../hooks';
import { ModelRow } from './ModelRow';

// 모델 표 한 장 (제공사 = 칸 · 줄 = 제공사끼리 모은 순서). 끌어 옮기기 때문에 Table 대신 TableFrame + ui-table 을 직접.
// 좁은 창에서 숨는 칸 = models.css 의 [data-col] (덜 중요한 것부터: 기능 → 비용 → 컨텍스트 → 제공사). 줄을 누르면 자세히 페이지
const NUM_COLS = new Set(['context', 'input', 'output']);

export function ModelTable({ view, isBusy, testOf, now, onChange, onProbe, onReorder }: {
  view: ModelView;
  isBusy: (id: string) => boolean;
  testOf: (id: string) => TestState | undefined;
  now: number;
  onChange: Change;
  onProbe: Probe;
  onReorder: (src: AdminModel, target: AdminModel) => void;
}) {
  const { visible, dragSrc } = view;
  return (
    <TableFrame className="mtable">
      <table className="ui-table" aria-label={COPY.table}>
        <thead>
          <tr>
            {COL_IDS.map((c) => (
              <th key={c} scope="col" className={c === 'select' ? 'sel' : undefined} data-col={c} title={COL_TITLE[c]}
                data-align={NUM_COLS.has(c) ? 'end' : undefined}>
                {c === 'select' ? <span className="ui-sr">{COPY.selectCol}</span> : COL_LABEL[c]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 && (
            <tr className="ui-table-empty">
              <td colSpan={COL_IDS.length}>
                <EmptyState variant="plain" icon="search" title={COPY.noMatch}
                  action={<Button size="sm" variant="ghost" onClick={view.clearFilters}>{COPY.clearFilters}</Button>} />
              </td>
            </tr>
          )}
          {visible.map((m, i) => {
            // ↑↓ = 같은 제공사 안 앞 · 뒤 (거른 줄 사이에서 — 전체 보기에선 표에 보이는 바로 위 · 아래)
            const { prev, next } = neighbors(visible, m);
            return (
              <ModelRow key={m.id} m={m} groupStart={i === 0 || visible[i - 1].provider !== m.provider} pos={view.posOf.get(m.id)} prev={prev} next={next} busy={isBusy(m.id)} test={testOf(m.id)} onChange={onChange} onProbe={onProbe} now={now}
                dup={view.dupOf(m)} checked={view.selected.has(m.id)} onCheck={() => view.toggleSel(m.id)} onOpen={() => window.location.assign(modelHref(m.id))}
                canDrag={view.unfiltered} canDrop={!dragSrc || dragSrc.provider === m.provider}
                dragging={view.dragId === m.id} onDragStart={() => view.setDragId(m.id)} onDragEnd={() => view.setDragId(null)}
                onDrop={() => {
                  view.setDragId(null);
                  if (dragSrc) onReorder(dragSrc, m);
                }} />
            );
          })}
        </tbody>
      </table>
    </TableFrame>
  );
}
