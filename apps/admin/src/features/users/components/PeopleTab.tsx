import { Badge, Input, Table, Toolbar, ToolbarSpacer, type Column } from '@brewai/ui';
import { Count, ListEmpty, Muted, NameCell } from '../../../shared/components/parts';
import { ago } from '../../../shared/format';
import { useSession } from '../../auth/hooks';
import { orgMembershipText } from '../../orgs/copy';
import { toOrgRole } from '../../orgs/api';
import { roleLabel } from '../../scope/model';
import type { AdminUserRow } from '../api';
import { ROLE_TEXT, USERS_COPY as C } from '../copy';
import { useUsers, useUserView } from '../hooks';
import { StatusBadge } from './UserBadges';
import { UserSheet } from './UserSheet';

// 사용자 탭 = 닉네임 · 이메일 · 조직 · 마지막 접속 · 상태. 줄을 누르면 서랍 (로그인 방법 · 비활성화 · 권한 · 세션 · 재설정 코드)
export default function PeopleTab() {
  const api = useUsers();
  const rows = api.data ?? [];
  const view = useUserView(rows);
  const { session } = useSession();
  const meId = session.status === 'signed_in' ? session.user.id : '';

  const columns: Column<AdminUserRow>[] = [
    {
      key: 'user', header: C.colUser, rowHeader: true,
      cell: (u) => (
        <NameCell person name={u.display_name} sub={u.email}
          tags={<>
            {u.id === meId && <Badge size="sm" tone="accent">{C.me}</Badge>}
            {u.instance_role === 'admin' && <Badge size="sm">{ROLE_TEXT.admin}</Badge>}
          </>} />
      ),
    },
    {
      key: 'orgs', header: roleLabel('tenant'), hideBelow: 'lg',
      cell: (u) => (u.orgs.length ? u.orgs.map((o) => orgMembershipText(o.name, toOrgRole(o.role))).join(', ') : <Muted>{C.noOrg}</Muted>),
    },
    { key: 'seen', header: C.colLastSeen, hideBelow: 'md', cell: (u) => ago(u.last_login_at) ?? <Muted>{C.never}</Muted> },
    { key: 'status', header: C.colStatus, cell: (u) => <StatusBadge status={u.status} /> },
  ];

  return (
    <div className="part-stack">
      <Toolbar>
        <Input type="search" size="sm" icon="search" placeholder={C.search} aria-label={C.search} value={view.query}
          onChange={(e) => view.setQuery(e.target.value)} className="part-search" />
        <ToolbarSpacer />
        {api.state.kind === 'ok' && <Count>{C.count(view.shown.length)}</Count>}
      </Toolbar>
      <Table label={C.table} columns={columns} rows={view.shown} rowKey={(u) => u.id} loading={api.state.kind === 'loading'}
        onRowClick={(u) => view.setOpenId(u.id)} activeKey={view.open?.id} rowState={(u) => (u.status === 'disabled' ? 'disabled' : undefined)}
        empty={<ListEmpty state={api.state} filtered={!!view.query.trim()} icon="people" empty={C.empty} emptyHow={C.emptyHow} noMatch={C.noMatch} onRetry={api.reload} />} />
      <UserSheet user={view.open} self={view.open?.id === meId} busy={view.open !== null && api.busy === view.open.id}
        onChange={api.change} onRevoke={api.revoke} onResetCode={api.resetCode} onClose={() => view.setOpenId(null)} />
    </div>
  );
}
