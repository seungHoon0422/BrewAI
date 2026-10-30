// 초대 탭 상태 = 코드 목록 · 거르기 · 취소 / 만들기 서식 (코드 1회 표시). 서식은 조직 · 공유 스페이스 목록을 같이 읽는다
import { useMemo, useState } from 'react';
import { LOAD_FAILED } from '../../shared/copy';
import { errorText, useLoad, useTask } from '../../shared/load';
import { listOrgs } from '../orgs/api';
import { listAdminSpaces } from '../spaces/api';
import { createInvite, listInvites, revokeInvite, type Invite, type InviteIn, type InviteRole } from './api';
import { DEFAULT_DAYS, INVITE_ERROR, INVITES_COPY as C } from './copy';

export type InviteFilter = 'active' | 'all';

export function useInvites() {
  const load = useLoad(listInvites);
  const { busy, run } = useTask(load.refresh, INVITE_ERROR);
  const [filter, setFilter] = useState<InviteFilter>('active');
  const rows = useMemo(() => load.data ?? [], [load.data]);
  const shown = useMemo(() => (filter === 'all' ? rows : rows.filter((i) => i.status === 'active')), [rows, filter]);
  return {
    ...load,
    busy,
    filter,
    setFilter,
    shown,
    revoke: (i: Invite) => run(() => revokeInvite(i.id), C.done.revoked, i.id),
  };
}

// 만들기 서식 = 조직 · 공유 스페이스 목록 + 입력 + 보내기 → 코드 (한 번만). 서식은 열 때마다 새로 붙는다 (InvitesTab) → 상태도 처음부터
export function useInviteForm(onCreated: () => void) {
  const orgList = useLoad(listOrgs);
  const spaceList = useLoad(listAdminSpaces);
  const [orgId, setOrgId] = useState('');
  const [role, setRole] = useState<InviteRole>('member');
  const [email, setEmail] = useState('');
  const [spaceIds, setSpaceIds] = useState<ReadonlySet<string>>(new Set());
  const [uses, setUses] = useState('1');
  const [days, setDays] = useState(String(DEFAULT_DAYS));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ invite: Invite; code: string } | null>(null);

  const orgs = useMemo(() => orgList.data ?? [], [orgList.data]);
  const org = orgs.find((o) => o.id === orgId) ?? orgs[0] ?? null;
  // 그 조직의 보관 안 된 공유 스페이스만 (다른 조직 스페이스 = 서버 404)
  const spaces = useMemo(
    () => (spaceList.data?.shared ?? []).filter((s) => s.org_id === org?.id && !s.archived_at),
    [spaceList.data, org?.id],
  );
  const maxUses = Number(uses);
  const usesOk = Number.isInteger(maxUses) && maxUses >= 1 && maxUses <= 100;

  const pickOrg = (id: string) => {
    setOrgId(id);
    setSpaceIds(new Set());
  };
  const toggleSpace = (id: string) =>
    setSpaceIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = async () => {
    if (!org || !usesOk || busy) return;
    setBusy(true);
    setError(null);
    const body: InviteIn = { org_id: org.id, org_role: role, space_ids: [...spaceIds], max_uses: maxUses, days: Number(days) };
    if (email.trim()) body.email = email.trim();
    try {
      setResult(await createInvite(body));
      onCreated();
    } catch (e) {
      setError(errorText(e, INVITE_ERROR, LOAD_FAILED.conductor));
    } finally {
      setBusy(false);
    }
  };

  return {
    ready: orgList.state.kind !== 'loading',
    loadError: orgList.state.kind === 'error' ? LOAD_FAILED[orgList.state.error] : null,
    spacesReady: spaceList.state.kind !== 'loading',
    orgs, org, pickOrg, role, setRole, email, setEmail, spaces, spaceIds, toggleSpace, uses, setUses, usesOk, days, setDays,
    busy, error, result, submit,
  };
}
