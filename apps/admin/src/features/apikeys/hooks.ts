// API 키 탭 상태 = 목록 하나 (정책 + 키) · 바꾸기 (정책 · 키 한도 · 폐기) 는 useTask (알림 + 새로 읽기)
import { useLoad, useTask } from '../../shared/load';
import { listAdminKeys, patchKeyLimits, patchPolicy, revokeAdminKey, type AdminKey, type Limits, type Policy } from './api';
import { KEYS_COPY as C, KEYS_ERRORS } from './copy';

export function useAdminKeys() {
  const { state, data, reload, refresh } = useLoad(listAdminKeys);
  const { busy, run } = useTask(refresh, KEYS_ERRORS);
  return {
    state, data, reload, busy,
    savePolicy: (patch: Partial<Policy>) => run(() => patchPolicy(patch), C.saved, 'policy'),
    setLimits: (k: AdminKey, limits: Limits | null) => run(() => patchKeyLimits(k.id, limits), C.limitsSaved(k.name), k.id),
    revoke: (k: AdminKey) => run(() => revokeAdminKey(k.id), C.revoked(k.name), k.id),
  };
}
export type AdminKeysApi = ReturnType<typeof useAdminKeys>;
