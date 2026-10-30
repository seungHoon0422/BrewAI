import { Icon } from '@brewai/ui';
import type { AdminModel } from '../api';
import { capsOf } from '../derive';

// 기능 = 아이콘 줄 (한 색 · 툴팁 = title · 화면 읽기 = aria-label). labeled = 자세히 페이지처럼 이름을 옆에 쓴다 (그땐 아이콘은 장식)
// E2E 고리: .mcap[data-cap] (text · image · tools · reasoning · embedding · other)
export function Caps({ m, labeled }: { m: AdminModel; labeled?: boolean }) {
  return (
    <span className="mcaps" data-labeled={labeled ? '' : undefined}>
      {capsOf(m).map((c) => (
        <span key={c.id} className="mcap" data-cap={c.id} title={c.long}>
          <Icon name={c.icon} size="sm" label={labeled ? undefined : c.label} />
          {labeled && <span>{c.label}</span>}
        </span>
      ))}
    </span>
  );
}
