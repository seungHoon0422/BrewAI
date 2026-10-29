import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons';

// 지켜야 할 경계 한 줄 (모델 등록 금지, 설치 규칙 등)
export function Note({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <div className="note">
      <Icon name={icon} />
      <p>{children}</p>
    </div>
  );
}

// 아직 데이터가 없는 표: 머리글만 두고, 비어 있는 이유와 채울 시점을 한 줄로
export function EmptyTable({
  label,
  cols,
  icon = 'inbox',
  children,
}: {
  label: string;
  cols: readonly string[];
  icon?: IconName;
  children: ReactNode;
}) {
  return (
    <div className="table">
      <table aria-label={label}>
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
          <tr>
            <td colSpan={cols.length}>
              <div className="empty">
                <Icon name={icon} />
                <p>{children}</p>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
