import type { ReactNode } from 'react';
import { EmptyState, Skeleton, TableFrame, type IconLike } from '@brewai/ui';

// 아직 줄이 없는 표: 머리글은 그대로 두고 (무엇이 들어올지) 비어 있는 이유 · 채울 시점 · 할 일을 한 칸에.
// loading = 뼈대 줄 (처음 채울 때). 머리글 · 표 이름은 E2E 가 읽는다 → 줄이 생겨도 같은 이름을 쓴다.
export function EmptyTable({ label, cols, icon = 'inbox', title, children, action, loading }: {
  label: string;
  cols: readonly string[];
  icon?: IconLike;
  title?: ReactNode;
  children?: ReactNode; // 설명 한 줄
  action?: ReactNode;
  loading?: boolean;
}) {
  return (
    <TableFrame>
      <table className="ui-table" aria-label={label} aria-busy={loading || undefined}>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            [0, 1, 2].map((i) => (
              <tr key={i} className="ui-table-skel">
                <td colSpan={cols.length}><Skeleton width="40%" /></td>
              </tr>
            ))
          ) : (
            <tr className="ui-table-empty">
              <td colSpan={cols.length}>
                <EmptyState variant="plain" icon={icon} title={title} action={action}>
                  {children}
                </EmptyState>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </TableFrame>
  );
}
