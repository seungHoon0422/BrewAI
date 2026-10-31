import { useEffect, useId, useState } from 'react';
import { Button, Card, CardHeader, EmptyState, Field, Switch, Table, Textarea, Toolbar, ToolbarSpacer, type Column } from '@brewai/ui';
import { Count } from '../../../shared/components/parts';
import { COMMON_COPY, LOAD_FAILED } from '../../../shared/copy';
import type { UserServer } from '../api';
import { MCP_COPY, PAGE_COPY, USER_COLS, USER_COPY as C } from '../copy';
import { useMcpPolicy, useUserServers } from '../hooks';
import { splitList } from './AddServerDialog';
import { AuthText, ServerName } from './ServerBits';

// 사용자 추가 서버 탭 = 정책(사용자 추가 허용 · 주소 허용 목록) + 사용자가 데스크톱에서 추가한 서버 표.
// 정의는 주인 것 → 여기서는 보기 · 끄기만. 인증정보는 '연결한 사람 수' 개수만 (slice 05 · ADR-0013)
export default function UserServersTab() {
  const api = useUserServers();
  const rows = api.data ?? [];
  const [name, owner, domain, auth, tools, shares, people, use] = USER_COLS;

  const columns: Column<UserServer>[] = [
    { key: 'name', header: name, rowHeader: true, cell: (s) => <ServerName s={s} from="user-servers" /> },
    { key: 'owner', header: owner, cell: (s) => s.owner_name || <span className="mcp-nil">{C.ownerUnknown}</span> },
    { key: 'domain', header: domain, hideBelow: 'md', cell: (s) => <span className="mcp-domain">{s.domain}</span> },
    { key: 'auth', header: auth, hideBelow: 'lg', cell: (s) => <AuthText s={s} /> },
    {
      key: 'tools', header: tools, hideBelow: 'md',
      cell: (s) => (s.tool_count === null ? <span className="mcp-nil" title={MCP_COPY.afterLoginTitle}>{MCP_COPY.afterLogin}</span> : <span className="ui-num">{s.tool_count}</span>),
    },
    { key: 'shares', header: shares, hideBelow: 'lg', cell: (s) => <span className="ui-num">{s.share_count ? C.shareCount(s.share_count) : '—'}</span> },
    { key: 'people', header: people, hideBelow: 'lg', cell: (s) => <span className="ui-num">{MCP_COPY.people(s.connected_count)}</span> },
    {
      key: 'use', header: use,
      cell: (s) => (
        <Switch size="sm" checked={s.status === 'active'} aria-label={C.switchLabel(s.name)} disabled={api.busy === s.id}
          onCheckedChange={(on) => void api.setStatus(s, on ? 'active' : 'disabled', on ? PAGE_COPY.done.enabled(s.name) : PAGE_COPY.done.disabled(s.name))} />
      ),
    },
  ];

  const empty = api.state.kind === 'error'
    ? <EmptyState variant="plain" icon="plug" title={<span role="alert">{LOAD_FAILED[api.state.error]}</span>} action={<Button onClick={api.reload}>{COMMON_COPY.retry}</Button>} />
    : <EmptyState variant="plain" icon="people" title={C.empty}>{C.emptyHow}</EmptyState>;

  return (
    <div className="part-stack mcp">
      <PolicyCard />
      <Toolbar>
        <span className="mcp-intro">{C.intro}</span>
        <ToolbarSpacer />
        {api.state.kind === 'ok' && <Count>{C.count(rows.length)}</Count>}
      </Toolbar>
      <Table label={C.table} columns={columns} rows={rows} rowKey={(s) => s.id} loading={api.state.kind === 'loading'}
        rowState={(s) => (s.status === 'active' ? undefined : 'disabled')} className="mcp-table" empty={empty} />
    </div>
  );
}

// 정책 = 사용자 추가 허용 스위치(바로 저장) + 주소 허용 목록(쉼표 · 줄바꿈 → 저장)
function PolicyCard() {
  const p = useMcpPolicy();
  const [text, setText] = useState('');
  const titleId = useId();
  const formId = useId();
  const saved = p.data?.url_allowlist ?? [];
  useEffect(() => {
    setText(saved.join('\n'));
  }, [saved.join('\n')]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = splitList(text).join('\n') !== saved.join('\n');
  return (
    <Card as="section" padding="lg" className="mcp-card mcp-policy" aria-labelledby={titleId}>
      <CardHeader level={2} title={<span id={titleId}>{C.partPolicy}</span>} />
      <div className="mcp-card-body">
        <div className="mcp-policy-row">
          <Switch checked={p.data?.allow_user_servers ?? true} label={C.allow} disabled={!p.data || p.busy}
            onCheckedChange={(on) => void p.save({ allow_user_servers: on }, on ? C.allowOn : C.allowOff)} />
          <p className="part-hint">{C.allowHint}</p>
        </div>
        <form id={formId} className="mcp-allow" onSubmit={(e) => {
          e.preventDefault();
          if (dirty) void p.save({ url_allowlist: splitList(text) }, C.allowlistSaved);
        }}>
          <Field label={C.allowlist} hint={C.allowlistHint}>
            <Textarea value={text} rows={2} spellCheck={false} disabled={!p.data} onChange={(e) => setText(e.target.value)} />
          </Field>
          <div className="mcp-actions">
            <Button type="submit" size="sm" disabled={!dirty || p.busy}>{C.allowlistSave}</Button>
          </div>
        </form>
      </div>
    </Card>
  );
}
