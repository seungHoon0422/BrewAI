import { Icon } from '@brewai/ui';
import { kindIcon, kindLabel, type ScopePath } from '../model';
import '../scope.css';

// 표 칸 · 서랍 안의 짧은 위치 줄 (링크 아님). 층 수를 모른다 — 받은 path 를 그대로 잇는다. 화면 머리 위치 줄은 ScopeBreadcrumb
export function ScopePathText({ path }: { path: ScopePath }) {
  return (
    <span className="scope-path">
      {path.map((c, i) => {
        const icon = kindIcon(c.kind);
        return (
          <span key={`${c.kind}:${c.id}`} className="scope-crumb" title={`${kindLabel(c.kind) ?? c.kind}: ${c.name}`}>
            {i > 0 && <Icon name="chevron-right" size="xs" className="scope-sep" />}
            {icon && <Icon name={icon} size="xs" />}
            <span className="ui-ell">{c.name}</span>
          </span>
        );
      })}
    </span>
  );
}
