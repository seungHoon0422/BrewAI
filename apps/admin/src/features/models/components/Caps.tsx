import { Badge, Icon } from '@brewai/ui';
import type { AdminModel } from '../api';
import { TOOLS_OFF } from '../copy';
import { capsOf, toolsOffKind } from '../derive';

// 기능 = 아이콘 줄 (한 색 · 툴팁 = title · 화면 읽기 = aria-label). labeled = 자세히 페이지처럼 이름을 옆에 쓴다 (그땐 아이콘은 장식)
// E2E 고리: .mcap[data-cap] (text · image · tools · reasoning · embedding · other) · 도구 꺼짐 = 표에서만 딱지 .mtools-off (자세히 페이지는 알림)
export function Caps({ m, labeled }: { m: AdminModel; labeled?: boolean }) {
  const off = toolsOffKind(m);
  return (
    <span className="mcaps" data-labeled={labeled ? '' : undefined}>
      {capsOf(m).map((c) => (
        <span key={c.id} className="mcap" data-cap={c.id} title={c.long}>
          <Icon name={c.icon} size="sm" label={labeled ? undefined : c.label} />
          {labeled && <span>{c.label}</span>}
        </span>
      ))}
      {!labeled && off && (
        <Badge tone="warn" variant="outline" size="sm" className="mtools-off" data-why={off} title={TOOLS_OFF[off].tip}>{TOOLS_OFF.badge}</Badge>
      )}
    </span>
  );
}
