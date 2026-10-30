import { useState } from 'react';
import { Badge, Button, Segmented, Table, Toolbar, ToolbarSpacer, type Column, type Tone } from '@brewai/ui';
import { ConfirmDialog, Count, ListEmpty, Muted, NameCell } from '../../../shared/components/parts';
import { COMMON_COPY } from '../../../shared/copy';
import { ago, left } from '../../../shared/format';
import { ORG_ROLE_TEXT } from '../../orgs/copy';
import { roleIcon, roleLabel } from '../../scope/model';
import type { Invite, InviteStatus } from '../api';
import { INVITES_COPY as C, STATUS_TEXT } from '../copy';
import { useInvites, type InviteFilter } from '../hooks';
import { InviteDialog } from './InviteDialog';

const STATUS_TONE: Record<InviteStatus, Tone> = { active: 'ok', used_up: 'neutral', expired: 'neutral', revoked: 'neutral' };
const FILTERS: { value: InviteFilter; label: string }[] = [
  { value: 'active', label: C.filterActive },
  { value: 'all', label: C.filterAll },
];

// 초대 탭 = 코드 목록 (조직 · 역할 · 바로 들어갈 스페이스 · 사용 · 만료 · 상태) · 만들기 (코드 1회 표시) · 취소
export default function InvitesTab() {
  const api = useInvites();
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<Invite | null>(null);

  const columns: Column<Invite>[] = [
    {
      key: 'org', header: roleLabel('tenant'), rowHeader: true,
      cell: (i) => <NameCell icon={roleIcon('tenant')} name={i.org_name} sub={i.email ? C.onlyEmail(i.email) : undefined} />,
    },
    { key: 'role', header: C.colRole, cell: (i) => <Badge size="sm" variant="outline">{ORG_ROLE_TEXT[i.org_role]}</Badge> },
    {
      key: 'spaces', header: C.colSpaces, hideBelow: 'lg',
      cell: (i) => (i.spaces.length ? i.spaces.map((s) => s.name).join(', ') : <Muted>{C.noSpaces}</Muted>),
    },
    { key: 'uses', header: C.colUses, align: 'end', cell: (i) => <span className="ui-num">{C.uses(i.uses, i.max_uses)}</span> },
    { key: 'expires', header: C.colExpires, hideBelow: 'md', cell: (i) => (i.status === 'active' ? left(i.expires_at) : <Muted>{ago(i.expires_at)}</Muted>) },
    { key: 'by', header: C.colBy, hideBelow: 'lg', cell: (i) => i.created_by_name ?? <Muted>{COMMON_COPY.none}</Muted> },
    { key: 'state', header: C.colState, cell: (i) => <Badge dot size="sm" tone={STATUS_TONE[i.status]}>{STATUS_TEXT[i.status]}</Badge> },
    {
      key: 'action', header: <span className="ui-sr">{C.colAction}</span>, align: 'end',
      cell: (i) => i.status === 'active' && (
        <Button size="sm" variant="ghost" aria-label={C.revokeLabel(i.org_name)} disabled={api.busy !== null} onClick={() => setRevoking(i)}>{C.revoke}</Button>
      ),
    },
  ];

  return (
    <div className="part-stack">
      <Toolbar>
        <Segmented size="sm" label={C.filter} options={FILTERS} value={api.filter} onChange={api.setFilter} />
        {api.state.kind === 'ok' && <Count>{C.count(api.shown.length)}</Count>}
        <ToolbarSpacer />
        <Button size="sm" variant="primary" icon="plus" onClick={() => setCreating(true)}>{C.create}</Button>
      </Toolbar>
      <Table label={C.table} columns={columns} rows={api.shown} rowKey={(i) => i.id} loading={api.state.kind === 'loading'}
        rowState={(i) => (i.status === 'active' ? undefined : 'inactive')}
        empty={<ListEmpty state={api.state} filtered={false} icon="mail" empty={api.filter === 'active' ? C.emptyActive : C.empty} emptyHow={C.emptyHow}
          noMatch={C.empty} onRetry={api.reload} />} />
      {creating && <InviteDialog onClose={() => setCreating(false)} onCreated={() => void api.refresh()} />}
      <ConfirmDialog open={revoking !== null} title={C.revokeTitle} confirm={C.revokeBtn} busy={revoking !== null && api.busy === revoking.id}
        onClose={() => setRevoking(null)}
        onConfirm={async () => {
          if (revoking && (await api.revoke(revoking))) setRevoking(null);
        }}>
        {C.revokeBody}
      </ConfirmDialog>
    </div>
  );
}
