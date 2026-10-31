import { useMemo, useState } from 'react';
import { Badge, Button, IconButton, Select, Table, type Column } from '@brewai/ui';
import { ConfirmDialog, ListEmpty, NameCell } from '../../../shared/components/parts';
import { ORG_ROLES, toOrgRole, type OrgMember, type OrgRole } from '../api';
import { ORG_ROLE_HINT, ORG_ROLE_TEXT, ORGS_COPY as C } from '../copy';
import { useOrgMembers, useUserCandidates } from '../hooks';

const ROLE_OPTIONS = ORG_ROLES.map((r) => ({ value: r, label: ORG_ROLE_TEXT[r] }));

// 조직 멤버 = 역할 바꾸기 · 빼기 · 넣기 (사용자 목록에서 고른다). 마지막 소유자는 서버가 막는다 (409 last_owner)
export function OrgMembers({ orgId, onChanged }: { orgId: string; onChanged: () => Promise<void> }) {
  const api = useOrgMembers(orgId, onChanged);
  const members = useMemo(() => api.data ?? [], [api.data]);
  const [pick, setPick] = useState('');
  const [role, setRole] = useState<OrgRole>('member');
  const [removing, setRemoving] = useState<OrgMember | null>(null);

  const candidates = useUserCandidates(members);

  const columns: Column<OrgMember>[] = [
    {
      key: 'who', header: C.colMember, rowHeader: true,
      cell: (m) => (
        <NameCell person name={m.display_name} sub={m.email}
          tags={m.status === 'disabled' ? <Badge size="sm">{C.disabled}</Badge> : undefined} />
      ),
    },
    {
      key: 'role', header: C.colRole,
      cell: (m) => (
        <Select size="sm" aria-label={C.roleOf(m.display_name)} title={ORG_ROLE_HINT[m.role]} options={ROLE_OPTIONS} value={m.role}
          disabled={api.busy !== null}
          onChange={(v) => {
            const next = toOrgRole(v);
            void api.setRole(m.user_id, next, C.done.role(m.display_name, ORG_ROLE_TEXT[next]));
          }} />
      ),
    },
    {
      key: 'remove', header: <span className="ui-sr">{C.removeCol}</span>, align: 'end',
      cell: (m) => <IconButton icon="trash" size="sm" label={C.remove(m.display_name)} disabled={api.busy !== null} onClick={() => setRemoving(m)} />,
    },
  ];

  const picked = candidates.find((c) => c.value === pick);
  return (
    <>
      <Table label={C.membersTable} columns={columns} rows={members} rowKey={(m) => m.user_id} density="compact" loading={api.state.kind === 'loading'}
        rowState={(m) => (m.status === 'disabled' ? 'disabled' : undefined)}
        empty={<ListEmpty state={api.state} filtered={false} icon="people" empty={C.membersEmpty} noMatch={C.membersEmpty} onRetry={api.reload} />} />

      <form className="part-row" aria-label={C.addLabel} onSubmit={(e) => {
        e.preventDefault();
        if (!picked) return;
        void api.setRole(pick, role, C.done.added(picked.name)).then((ok) => ok && setPick(''));
      }}>
        <Select size="sm" aria-label={C.addPick} placeholder={candidates.length ? C.addPick : C.addNone} options={candidates} value={pick}
          disabled={!candidates.length || api.busy !== null} onChange={setPick} className="part-grow" />
        <Select size="sm" aria-label={C.addRole} options={ROLE_OPTIONS} value={role} onChange={(v) => setRole(toOrgRole(v))} />
        <Button size="sm" type="submit" icon="plus" disabled={!picked || api.busy !== null}>{C.addBtn}</Button>
      </form>

      <ConfirmDialog open={removing !== null} title={removing ? C.removeTitle(removing.display_name) : ''} confirm={C.removeBtn}
        busy={removing !== null && api.busy === removing.user_id} onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (removing && (await api.remove(removing.user_id, C.done.removed(removing.display_name)))) setRemoving(null);
        }}>
        {C.removeBody}
      </ConfirmDialog>
    </>
  );
}
