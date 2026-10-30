import { Button, EmptyState, Icon, ProviderIcon, TableFrame } from '@brewai/ui';
import type { AdminModel } from '../api';
import { COL_LABEL, COPY } from '../copy';
import { COL_IDS, neighbors, type ColId } from '../derive';
import type { Change, ModelView, Probe } from '../hooks';
import { ModelRow } from './ModelRow';

// 회사별로 묶은 목록 (묶음 줄 · 끌어 옮기기 때문에 Table 대신 TableFrame + ui-table 을 직접). 정보 칸 = 좁은 창(<1100)에선 숨김
const COL_CLASS: Partial<Record<ColId, string>> = { select: 'sel', info: 'ginfo' };

export function ModelTable({ rows, view, isBusy, now, onChange, onProbe, onReorder }: {
  rows: AdminModel[];
  view: ModelView;
  isBusy: (id: string) => boolean;
  now: number;
  onChange: Change;
  onProbe: Probe;
  onReorder: (src: AdminModel, target: AdminModel) => void;
}) {
  const { groups, collapsed, dragSrc } = view;
  return (
    <TableFrame className="mtable">
      <table className="ui-table" aria-label={COPY.table}>
        <thead>
          <tr>
            {COL_IDS.map((c) => (
              <th key={c} scope="col" className={COL_CLASS[c]} data-hide-below={c === 'info' ? 'lg' : undefined}>
                {c === 'select' ? <span className="ui-sr">{COPY.selectCol}</span> : COL_LABEL[c]}
              </th>
            ))}
          </tr>
        </thead>
        {view.visible.length === 0 && (
          <tbody>
            <tr className="ui-table-empty">
              <td colSpan={COL_IDS.length}>
                <EmptyState variant="plain" icon="search" title={COPY.noMatch}
                  action={<Button size="sm" variant="ghost" onClick={view.clearFilters}>{COPY.clearFilters}</Button>} />
              </td>
            </tr>
          </tbody>
        )}
        {groups.map((g) => {
          const all = rows.filter((r) => r.provider === g.id);
          const open = !collapsed.has(g.id);
          return (
            <tbody key={g.id} data-group={g.id}>
              <tr className="grp">
                <th colSpan={COL_IDS.length} scope="rowgroup">
                  <button type="button" aria-expanded={open} onClick={() => view.toggleGroup(g.id)}>
                    <Icon name="chevron-right" size="sm" className="chev" />
                    <span className="prov"><ProviderIcon provider={g.id} />{g.label}</span>
                    <span className="gmeta">{COPY.groupMeta(all.length, all.filter((r) => r.state === 'exposed').length)}</span>
                  </button>
                </th>
              </tr>
              {open && g.rows.map((m) => {
                const { prev, next } = neighbors(g.rows, m);
                return (
                  <ModelRow key={m.id} m={m} pos={view.posOf.get(m.id)} prev={prev} next={next} busy={isBusy(m.id)} onChange={onChange} onProbe={onProbe} now={now}
                    dup={view.dupOf(m)} checked={view.selected.has(m.id)} onCheck={() => view.toggleSel(m.id)} onOpen={() => view.setOpenId(m.id)}
                    canDrag={view.unfiltered} canDrop={!dragSrc || dragSrc.provider === m.provider}
                    dragging={view.dragId === m.id} onDragStart={() => view.setDragId(m.id)} onDragEnd={() => view.setDragId(null)}
                    onDrop={() => {
                      view.setDragId(null);
                      if (dragSrc) onReorder(dragSrc, m);
                    }} />
                );
              })}
            </tbody>
          );
        })}
      </table>
    </TableFrame>
  );
}
