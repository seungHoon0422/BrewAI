import { Button, EmptyState, TableFrame } from '@brewai/ui';
import type { AdminModel } from '../api';
import { modelHref } from '../route';
import { COL_LABEL, COL_TITLE, COPY } from '../copy';
import { COL_IDS } from '../derive';
import type { Change, ModelView, Probe, TestState } from '../hooks';
import { ModelRow } from './ModelRow';

// 모델 표 한 장 (제공사 = 칸 · 줄 = 전체 순서 하나 = 사용자 앱 모델 메뉴 순서). 끌어 옮기기 때문에 Table 대신 TableFrame + ui-table 을 직접.
// 머리 · 칸 모두 왼쪽 맞춤 (숫자도). 좁은 창에서 숨는 칸 = models.css 의 [data-col] (덜 중요한 것부터: 기능 → 비용 → 컨텍스트 → 제공사). 줄을 누르면 자세히 페이지

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
              <th key={c} scope="col" className={c === 'select' ? 'sel' : undefined} data-col={c} title={COL_TITLE[c]}>
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
          {visible.map((m) => (
            <ModelRow key={m.id} m={m} busy={isBusy(m.id)} test={testOf(m.id)} onChange={onChange} onProbe={onProbe} now={now}
              dup={view.dupOf(m)} checked={view.selected.has(m.id)} onCheck={() => view.toggleSel(m.id)} onOpen={() => window.location.assign(modelHref(m.id))}
              canDrag={view.unfiltered} canDrop={!dragSrc || dragSrc.id !== m.id} dropBelow={!!dragSrc && dragSrc.order < m.order}
              dragging={view.dragId === m.id} onDragStart={() => view.setDragId(m.id)} onDragEnd={() => view.setDragId(null)}
              onDrop={() => {
                view.setDragId(null);
                if (dragSrc) onReorder(dragSrc, m);
              }} />
          ))}
        </tbody>
      </table>
    </TableFrame>
  );
}
