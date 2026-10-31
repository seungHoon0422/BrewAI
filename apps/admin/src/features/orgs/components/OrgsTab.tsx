import { useState } from 'react';
import { Badge, Button, Table, Toolbar, ToolbarSpacer, type Column } from '@brewai/ui';
import { Count, ListEmpty, NameCell } from '../../../shared/components/parts';
import { dateText } from '../../../shared/format';
import { roleIcon, roleLabel } from '../../scope/model';
import type { AdminOrg } from '../api';
import { JOIN_TEXT, ORGS_COPY as C } from '../copy';
import { useOrgs } from '../hooks';
import { CreateOrgDialog } from './CreateOrgDialog';
import { OrgSheet } from './OrgSheet';

// 조직 탭 = 이름 · 가입 방식 · 멤버 · 공유 스페이스 수. 줄을 누르면 서랍 (이름 · 가입 방식 · 멤버 역할)
export default function OrgsTab() {
  const api = useOrgs();
  const rows = api.data ?? [];
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const open = rows.find((o) => o.id === openId) ?? null;
  const kind = roleLabel('tenant');

  const columns: Column<AdminOrg>[] = [
    { key: 'name', header: C.colName, rowHeader: true, cell: (o) => <NameCell icon={roleIcon('tenant')} name={o.name} sub={o.slug} /> },
    {
      key: 'join', header: C.colJoin,
      cell: (o) => (
        <span className="part-tags">
          <Badge size="sm" tone={o.join_policy === 'domain_auto' ? 'info' : 'neutral'}>{JOIN_TEXT[o.join_policy]}</Badge>
          {o.join_policy === 'domain_auto' && o.google_hd && <code>{o.google_hd}</code>}
        </span>
      ),
    },
    { key: 'members', header: C.colMembers, cell: (o) => <span className="ui-num">{o.member_count}</span> },
    { key: 'spaces', header: C.colSpaces, hideBelow: 'md', cell: (o) => <span className="ui-num">{o.space_count}</span> },
    { key: 'created', header: C.colCreated, hideBelow: 'lg', cell: (o) => dateText(o.created_at) },
  ];

  return (
    <div className="part-stack">
      <Toolbar>
        {api.state.kind === 'ok' && <Count>{C.count(rows.length)}</Count>}
        <ToolbarSpacer />
        <Button size="sm" variant="primary" icon="plus" onClick={() => setCreating(true)}>{C.createTitle(kind)}</Button>
      </Toolbar>
      <Table label={C.table} columns={columns} rows={rows} rowKey={(o) => o.id} loading={api.state.kind === 'loading'}
        onRowClick={(o) => setOpenId(o.id)} activeKey={open?.id}
        empty={<ListEmpty state={api.state} filtered={false} icon={roleIcon('tenant') ?? 'building'} empty={C.empty} emptyHow={C.emptyHow} noMatch={C.empty} onRetry={api.reload} />} />
      <OrgSheet org={open} busy={api.busy} onChange={api.change} onMembersChanged={api.refresh} onClose={() => setOpenId(null)} />
      <CreateOrgDialog open={creating} busy={api.busy} title={C.createTitle(kind)} onClose={() => setCreating(false)}
        onCreate={async (name, slug) => {
          if (await api.create(name, slug, (o) => C.done.created(o.name))) setCreating(false);
        }} />
    </div>
  );
}
