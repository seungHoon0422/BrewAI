import { useState } from 'react';
import { Button, Callout, EmptyState, Table, Toolbar, ToolbarSpacer, type Column } from '@brewai/ui';
import { Count } from '../../../shared/components/parts';
import { COMMON_COPY, LOAD_FAILED } from '../../../shared/copy';
import type { AdminServer } from '../api';
import { MCP_COLS, MCP_COPY as C } from '../copy';
import { useMcpServers, useNow } from '../hooks';
import { AddServerDialog } from './AddServerDialog';
import { AuthText, ServerName, StatusBadge } from './ServerBits';
import { TestCell } from './TestCell';

// MCP 서버 탭 = 관리자가 추가한 전체 공통 서버 (install 공유 + auto_include · ADR-0013).
// 표 = 이름 · 도메인 · 로그인 방식 · 도구 수 · 예상 토큰 · 연결한 사람 수 · 상태 · [연결 테스트]. 이름 = 자세히 페이지 ('#/catalog/mcp/<id>')
export default function McpTab() {
  const api = useMcpServers();
  const now = useNow();
  const [adding, setAdding] = useState(false);
  const rows = api.data ?? [];
  const [name, domain, auth, tools, tokens, people, status, test] = MCP_COLS;

  const columns: Column<AdminServer>[] = [
    { key: 'name', header: name, rowHeader: true, cell: (s) => <ServerName s={s} /> },
    { key: 'domain', header: domain, hideBelow: 'md', cell: (s) => <span className="mcp-domain">{s.domain}</span> },
    { key: 'auth', header: auth, hideBelow: 'md', cell: (s) => <AuthText s={s} /> },
    {
      key: 'tools', header: tools,
      cell: (s) => s.tool_count === null
        ? <span className="mcp-nil" title={C.afterLoginTitle}>{C.afterLogin}</span>
        : (
          <span className="mcp-num">
            <span className="ui-num">{s.tool_count}</span>
            {s.write_count ? <span className="mcp-sub">{C.writeCount(s.write_count)}</span> : null}
          </span>
        ),
    },
    {
      key: 'tokens', header: tokens, hideBelow: 'lg',
      cell: (s) => s.tool_tokens_est === null
        ? <span className="mcp-nil" title={C.afterLoginTitle}>—</span>
        : <span className="ui-num" title={C.tokensTitle}>{C.tokens(s.tool_tokens_est)}</span>,
    },
    { key: 'people', header: people, hideBelow: 'lg', cell: (s) => <span className="ui-num">{C.people(s.connected_count)}</span> },
    { key: 'status', header: status, cell: (s) => <StatusBadge status={s.status} /> },
    { key: 'test', header: test, className: 'mcp-testcol', cell: (s) => <TestCell s={s} test={api.testOf(s.id)} now={now} onTest={api.test} /> },
  ];

  const empty = api.state.kind === 'error'
    ? (
      <EmptyState variant="plain" icon="plug" title={<span role="alert">{api.state.error === 'server' ? C.loadFailed : LOAD_FAILED[api.state.error]}</span>}
        action={<Button onClick={api.reload}>{COMMON_COPY.retry}</Button>} />
    )
    : (
      <EmptyState variant="plain" icon="box" title={C.empty}
        action={<Button size="sm" variant="primary" icon="plus" onClick={() => setAdding(true)}>{C.add}</Button>}>
        {C.emptyHow}
      </EmptyState>
    );

  return (
    <div className="part-stack mcp">
      <Toolbar>
        <span className="mcp-intro">{C.intro}</span>
        <ToolbarSpacer />
        {api.state.kind === 'ok' && <Count>{C.count(rows.length)}</Count>}
        <Button size="sm" variant="primary" icon="plus" onClick={() => setAdding(true)}>{C.add}</Button>
      </Toolbar>
      <Table label={C.table} columns={columns} rows={rows} rowKey={(s) => s.id} loading={api.state.kind === 'loading'}
        rowState={(s) => (s.status === 'active' ? undefined : 'disabled')} className="mcp-table" empty={empty} />
      {rows.some((s) => s.tool_count === null) && <Callout icon="info" className="mcp-note">{C.afterLoginNote}</Callout>}
      <AddServerDialog open={adding} busy={api.adding} onAdd={api.add} onClose={() => setAdding(false)} />
    </div>
  );
}
