// 표 — 머리 정렬(누르면 오름 → 내림 → 없음) · 줄 고르기(체크) · 줄 누르기. 정렬 · 거르기는 부르는 쪽이 한다 (부품은 그리기만).
// 묶음 줄 · 끌어 옮기기처럼 특별한 표는 TableFrame + <table className="ui-table"> 을 직접 쓴다 (같은 모양).
import type { ReactNode } from 'react';
import { cx, flag } from './cx';
import { UI_COPY } from './copy';
import { Icon } from './icons';
import { Checkbox } from './inputs';
import { Skeleton } from './spinner';

export type SortDir = 'asc' | 'desc';
export type SortState = { key: string; dir: SortDir } | null;

export type Column<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  sortable?: boolean;
  align?: 'start' | 'center' | 'end'; // 기본 = 왼쪽 (머리 · 칸 · 숫자 모두). end = 줄 끝 동작 버튼 칸에만
  width?: string; // CSS 너비 (예: '76px' · '30%')
  hideBelow?: 'md' | 'lg'; // 좁은 창에서 숨김 (md < 760px · lg < 1100px)
  rowHeader?: boolean; // 이 칸이 줄 이름 (th scope=row · onRowClick 이 있으면 버튼)
  className?: string;
};

export type TableProps<T> = {
  label: string; // 표 이름 (aria-label)
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  selected?: ReadonlySet<string>; // 넘기면 맨 앞에 체크 칸
  onSelectedChange?: (next: Set<string>) => void;
  onRowClick?: (row: T) => void;
  activeKey?: string; // 지금 연 줄 (서랍에 보이는 것)
  rowState?: (row: T) => string | undefined; // data-state (예: missing · candidate → 기능 CSS 가 꾸민다)
  density?: 'compact' | 'comfortable';
  loading?: boolean; // 처음 채울 때 뼈대 줄 3개
  empty?: ReactNode; // 줄이 없을 때 (EmptyState variant="plain")
  stickyHeader?: boolean;
  className?: string;
};

const nextSort = (cur: SortState | undefined, key: string): SortState =>
  cur?.key !== key ? { key, dir: 'asc' } : cur.dir === 'asc' ? { key, dir: 'desc' } : null;

export function TableFrame({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('ui-table-frame ui-scroll', className)}>{children}</div>;
}

export function Table<T>({
  label, columns, rows, rowKey, sort, onSortChange, selected, onSelectedChange, onRowClick, activeKey, rowState,
  density = 'comfortable', loading, empty, stickyHeader, className,
}: TableProps<T>) {
  const selectable = selected !== undefined;
  const keys = rows.map(rowKey);
  const picked = keys.filter((k) => selected?.has(k)).length;
  const span = columns.length + (selectable ? 1 : 0);
  const toggle = (k: string) => {
    const next = new Set(selected);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    onSelectedChange?.(next);
  };
  const toggleAll = () => onSelectedChange?.(picked === keys.length ? new Set() : new Set([...(selected ?? []), ...keys]));

  return (
    <TableFrame className={className}>
      <table className="ui-table" aria-label={label} data-density={density} data-sticky={flag(stickyHeader)} aria-busy={loading || undefined}>
        <thead>
          <tr>
            {selectable && (
              <th scope="col" className="ui-table-sel">
                <Checkbox aria-label={UI_COPY.selectAll} checked={keys.length > 0 && picked === keys.length} indeterminate={picked > 0 && picked < keys.length}
                  onChange={toggleAll} disabled={keys.length === 0} />
              </th>
            )}
            {columns.map((c) => {
              const dir = sort?.key === c.key ? sort.dir : undefined;
              return (
                <th
                  key={c.key}
                  scope="col"
                  className={c.className}
                  style={c.width ? { width: c.width } : undefined}
                  data-align={c.align}
                  data-hide-below={c.hideBelow}
                  aria-sort={c.sortable ? (dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none') : undefined}
                >
                  {c.sortable && onSortChange ? (
                    <button type="button" className="ui-table-sort" data-dir={dir} onClick={() => onSortChange(nextSort(sort, c.key))}>
                      {c.header}
                      <Icon name={dir === 'desc' ? 'chevron-down' : 'chevron-up'} size="xs" />
                      {dir && <span className="ui-sr">, {dir === 'asc' ? UI_COPY.sortAsc : UI_COPY.sortDesc}</span>}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading && rows.length === 0 &&
            [0, 1, 2].map((i) => (
              <tr key={i} className="ui-table-skel">
                <td colSpan={span}><Skeleton width="40%" /></td>
              </tr>
            ))}
          {!loading && rows.length === 0 && empty && (
            <tr className="ui-table-empty">
              <td colSpan={span}>{empty}</td>
            </tr>
          )}
          {rows.map((row, i) => {
            const k = keys[i];
            return (
              <tr
                key={k}
                data-state={rowState?.(row)}
                data-selected={flag(selected?.has(k))}
                data-active={flag(activeKey === k)}
                data-clickable={flag(!!onRowClick)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {selectable && (
                  <td className="ui-table-sel" onClick={(e) => e.stopPropagation()}>
                    <Checkbox aria-label={UI_COPY.selectRow} checked={selected.has(k)} onChange={() => toggle(k)} />
                  </td>
                )}
                {columns.map((c) => {
                  const content = c.cell(row, i);
                  const Cell = c.rowHeader ? 'th' : 'td';
                  return (
                    <Cell key={c.key} scope={c.rowHeader ? 'row' : undefined} className={c.className} data-align={c.align} data-hide-below={c.hideBelow}>
                      {c.rowHeader && onRowClick ? (
                        <button type="button" className="ui-table-rowbtn" onClick={(e) => { e.stopPropagation(); onRowClick(row); }}>
                          {content}
                        </button>
                      ) : (
                        content
                      )}
                    </Cell>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableFrame>
  );
}
