import { Badge, EmptyState, Skeleton, Switch, Table, type Column } from '@brewai/ui';
import type { Load } from '../../../shared/load';
import type { McpTool, ToolList, ToolPatch } from '../api';
import { MCP_COPY, MODE_TEXT, PAGE_COPY as C, TOOL_COLS } from '../copy';
import { WriteBadge } from './ServerBits';

// 도구 표 = 도구(제목 · 실제 이름 · 쓰기) · 설명 · 예상 토큰 · 숨김 · 바로 실행 · 항상 같이 열기.
// 숨김 = mode hidden (use_app 이 못 꺼냄) · 바로 실행 끔 = mode approval (저장만 · 승인 카드 slice 07 전까진 바로 실행) · 항상 같이 열기 = always_reveal.
// readOnly = 사용자 추가 서버 (정의는 주인 것 · 관리자는 끄기만)
export function ToolTable({ load, busy, readOnly, onChange }: {
  load: Load<ToolList>;
  busy: string | null;
  readOnly: boolean;
  onChange: (patch: ToolPatch, done: string) => void;
}) {
  if (load.kind === 'loading') return <Skeleton lines={3} />;
  const tools = load.kind === 'ok' ? load.data.tools : [];
  const [tool, desc, tokens, hide, auto, reveal] = TOOL_COLS;
  const label = (t: McpTool) => t.title || t.name;
  const off = (t: McpTool) => readOnly || busy === `tool:${t.name}`;

  const columns: Column<McpTool>[] = [
    {
      key: 'tool', header: tool, rowHeader: true,
      cell: (t) => (
        <span className="mcp-tool">
          <span className="mcp-tool-line">
            <b>{label(t)}</b>
            {t.write && <WriteBadge />}
            {t.mode === 'approval' && <Badge size="sm" tone="neutral" title={C.approvalNote}>{C.approvalBadge}</Badge>}
          </span>
          <code className="mcp-handle" title={t.public}>{t.name}</code>
        </span>
      ),
    },
    { key: 'desc', header: desc, hideBelow: 'lg', className: 'mcp-tool-desc', cell: (t) => t.description || <span className="mcp-nil">—</span> },
    { key: 'tokens', header: tokens, hideBelow: 'md', cell: (t) => <span className="ui-num">{MCP_COPY.tokens(t.tokens_est)}</span> },
    {
      key: 'hide', header: hide,
      cell: (t) => (
        <Switch size="sm" checked={t.mode === 'hidden'} aria-label={C.hideLabel(label(t))} disabled={off(t)}
          onCheckedChange={(on) => onChange({ tool: t.name, mode: on ? 'hidden' : 'auto' }, C.done.tool(label(t), MODE_TEXT[on ? 'hidden' : 'auto']))} />
      ),
    },
    {
      key: 'auto', header: auto,
      cell: (t) => (
        <Switch size="sm" checked={t.mode === 'auto'} aria-label={C.autoLabel(label(t))} disabled={off(t) || t.mode === 'hidden'} title={C.approvalNote}
          onCheckedChange={(on) => onChange({ tool: t.name, mode: on ? 'auto' : 'approval' }, C.done.tool(label(t), MODE_TEXT[on ? 'auto' : 'approval']))} />
      ),
    },
    {
      key: 'reveal', header: reveal, hideBelow: 'md',
      cell: (t) => (
        <Switch size="sm" checked={t.always_reveal} aria-label={C.revealLabel(label(t))} disabled={off(t) || t.mode === 'hidden'}
          onCheckedChange={(on) => onChange({ tool: t.name, always_reveal: on }, C.done.tool(label(t), on ? C.done.revealOn : C.done.revealOff))} />
      ),
    },
  ];

  return (
    <Table label={C.toolTable} columns={columns} rows={tools} rowKey={(t) => t.name} density="compact" className="mcp-tools"
      rowState={(t) => (t.mode === 'hidden' ? 'disabled' : undefined)}
      empty={<EmptyState variant="plain" icon="wrench" title={C.toolsEmpty}>{C.toolsEmptyHow}</EmptyState>} />
  );
}
