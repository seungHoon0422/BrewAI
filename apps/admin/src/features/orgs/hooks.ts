// 조직 탭 상태 = 조직 목록 · 만들기 · 바꾸기 / 연 조직의 멤버 (역할 · 넣기 · 빼기). 결과 한 줄은 알림으로
import { useCallback, useMemo } from 'react';
import { useLoad, useTask } from '../../shared/load';
import { listUsers } from '../users/api';
import { createOrg, listOrgMembers, listOrgs, patchOrg, removeOrgMember, setOrgMember, type AdminOrg, type OrgMember, type OrgPatch, type OrgRole } from './api';
import { ORGS_COPY, ORG_ERROR } from './copy';

export function useOrgs() {
  const load = useLoad(listOrgs);
  const { busy, run } = useTask(load.refresh, ORG_ERROR);
  return {
    ...load,
    busy: busy !== null,
    create: (name: string, slug: string | undefined, done: (o: AdminOrg) => string) => run(() => createOrg(name, slug), done),
    change: (org: AdminOrg, patch: OrgPatch, done: string) => run(() => patchOrg(org.id, patch), done, org.id),
  };
}

// onChanged = 멤버 수가 바뀌었을 때 조직 목록도 새로 (표의 멤버 칸)
export function useOrgMembers(orgId: string | null, onChanged: () => Promise<void>) {
  const load = useLoad((signal) => (orgId ? listOrgMembers(orgId, signal) : Promise.resolve([])), orgId ?? '');
  const { refresh } = load;
  const after = useCallback(async () => {
    await Promise.all([refresh(), onChanged()]);
  }, [refresh, onChanged]);
  const { busy, run } = useTask(after, ORG_ERROR);
  return {
    ...load,
    busy,
    setRole: (userId: string, role: OrgRole, done: string) => (orgId ? run(() => setOrgMember(orgId, userId, role), done, userId) : Promise.resolve(false)),
    remove: (userId: string, done: string) => (orgId ? run(() => removeOrgMember(orgId, userId), done, userId) : Promise.resolve(false)),
  };
}

// 넣을 수 있는 사람 = 활성 사용자 중 아직 이 조직 멤버가 아닌 사람 (고르기 칸 옵션)
export function useUserCandidates(members: readonly OrgMember[]) {
  const users = useLoad(listUsers);
  return useMemo(() => {
    const inOrg = new Set(members.map((m) => m.user_id));
    return (users.data ?? [])
      .filter((u) => !inOrg.has(u.id) && u.status === 'active')
      .map((u) => ({ value: u.id, label: ORGS_COPY.candidate(u.display_name, u.email), name: u.display_name }));
  }, [members, users.data]);
}
