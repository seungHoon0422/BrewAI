// 도구 카드 (상태 줄 패널 안) — 이름 · 상태 · 입력 · 결과 두세 줄. 내용은 tools.ts.
import { Icon, Spinner } from '@brewai/ui';
import { seconds } from '../../../lib/format';
import { TOOL } from '../copy';
import type { ToolPart } from '../model';
import { TOOL_ICON, TOOL_STATE_ICON, toolRows } from '../tools';

export function ToolCard({ p }: { p: ToolPart }) {
  const icon = TOOL_STATE_ICON[p.status];
  return (
    <div className="tp-tool" data-state={p.status} data-tool={p.name} role="group"
      aria-label={p.name === 'use_skill' ? TOOL.skillGroup : TOOL.group(p.label)}>
      <div className="th">
        <span className="ttile" aria-hidden="true"><Icon name={TOOL_ICON[p.name] ?? 'wrench'} size="sm" /></span>
        <b title={p.name}>{p.label}</b>
        <span className="tst">
          {p.status === 'running' ? <Spinner size="xs" /> : icon && <Icon name={icon} size="sm" />}
          {TOOL.state[p.status]}
          {p.ms != null && p.status !== 'running' && <span className="tm"> · {seconds(p.ms)}</span>}
        </span>
      </div>
      <dl>
        {toolRows(p).map((r) => (
          <div key={r.k} className={r.err ? 'err' : undefined}>
            <dt>{r.k}</dt>
            <dd className={r.mono ? 'mono' : undefined} title={r.v}>{r.v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
