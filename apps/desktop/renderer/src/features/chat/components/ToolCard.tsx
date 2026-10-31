// 도구 블록 (상태 줄 패널 안) = 카드: 아이콘 타일 · 이름 · '도구' 꼬리표 · 상태(+걸린 시간) / 입력 · 결과 두세 줄. 내용은 tools.ts.
// 생각 블록(조용한 글)과 한눈에 다르게 — 테두리 있는 면 · 굵은 이름 · 상태 글.
// MCP 앱 도구 = 플러그 아이콘 · '<앱>: <도구>' 이름 · 쓰기 도구는 '쓰기' 배지 (지금은 표시만 · 승인은 slice 07) · 연결 대기 = 자물쇠.
import { Badge, Icon, Spinner } from '@brewai/ui';
import { seconds } from '../../../lib/format';
import { TOOL, TRACE } from '../copy';
import type { ToolPart } from '../model';
import { TOOL_STATE_ICON, toolIcon, toolRows } from '../tools';

// took = 보여 줄 시간 글 (병렬 묶음 = 실행 시간 · 없으면 부르기 시작 ~ 결과)
export function ToolCard({ p, took }: { p: ToolPart; took?: string }) {
  const icon = TOOL_STATE_ICON[p.status];
  const tm = took ?? (p.ms != null ? seconds(p.ms) : '');
  return (
    <div className="tp-tool" data-kind="tool" data-state={p.status} data-tool={p.name} data-app={p.app?.handle} data-write={p.app?.write || undefined}
      role="group" aria-label={p.name === 'use_skill' ? TOOL.skillGroup : p.app ? TOOL.appGroup(p.label) : TOOL.group(p.label)}>
      <div className="th">
        <span className="ttile" aria-hidden="true"><Icon name={toolIcon(p)} size="sm" /></span>
        <b title={p.name}>{p.label}</b>
        {p.app?.write && <Badge size="sm" tone="warn" className="twrite" title={TOOL.writeTitle}>{TOOL.write}</Badge>}
        <span className="tkind" aria-hidden="true">{TRACE.tool}</span>
        <span className="tst">
          {p.status === 'running' ? <Spinner size="xs" /> : icon && <Icon name={icon} size="sm" />}
          <span>{TOOL.state[p.status]}</span>
          {p.status !== 'running' && tm && <span className="tm ui-num">{tm}</span>}
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
