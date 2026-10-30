// 사용자 탭 상태 = 서버 목록 + 바꾸기 (비활성화 · 권한 · 닉네임 · 세션 · 재설정 코드). 결과 한 줄은 알림(toast)으로
import { useMemo, useState } from 'react';
import { LOAD_FAILED } from '../../shared/copy';
import { errorText, useLoad, useTask } from '../../shared/load';
import { useToast } from '../../shared/toast';
import { issueResetCode, listUsers, patchUser, revokeSessions, type AdminUserRow, type ResetCode, type UserPatch } from './api';
import { USER_ERROR } from './copy';

export function useUsers() {
  const load = useLoad(listUsers);
  const { busy, run } = useTask(load.refresh, USER_ERROR);
  const toast = useToast();
  return {
    ...load,
    busy,
    change: (u: AdminUserRow, patch: UserPatch, done: (r: AdminUserRow) => string) => run(() => patchUser(u.id, patch), done, u.id),
    revoke: (u: AdminUserRow, done: (n: number) => string) => run(() => revokeSessions(u.id), done, u.id),
    // 코드는 알림이 아니라 서랍 안에 한 번 보인다
    resetCode: (u: AdminUserRow): Promise<ResetCode | null> =>
      issueResetCode(u.id).catch((e) => {
        toast({ tone: 'danger', title: errorText(e, USER_ERROR, LOAD_FAILED.conductor) });
        return null;
      }),
  };
}

// 검색 (닉네임 · 이메일) + 연 줄
export function useUserView(rows: readonly AdminUserRow[]) {
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((u) => u.display_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) : rows;
  }, [rows, query]);
  return { query, setQuery, shown, open: rows.find((u) => u.id === openId) ?? null, setOpenId };
}
