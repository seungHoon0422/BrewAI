// API 키 관리 (ADR-0017) = conductor /api/admin/keys*. 키 값은 관리자에게도 안 온다 (hint 뿐)
import { call, callJson, expectObj, isObj, num, objs, str, strOrNull, strs } from '../../shared/http';

export type Limits = { rpm: number | null; tokens_per_day: number | null; usd_per_month: number | null };
export type Policy = { enabled: boolean; default_days: number; max_days: number; limits: Limits };
export type KeyStatus = 'active' | 'expired' | 'revoked';
export type AdminKey = {
  id: string; name: string; hint: string; scopes: string[]; status: KeyStatus; created_at: string; expires_at: string;
  last_used_at: string | null; limits: Limits; custom: string[]; user: { id: string; name: string; email: string };
  month: { runs: number; tokens: number; cost_usd: number | null };
};
export type KeysData = { policy: Policy; keys: AdminKey[] };

const limitsOf = (v: unknown): Limits => {
  const o = isObj(v) ? v : {};
  return { rpm: num(o.rpm), tokens_per_day: num(o.tokens_per_day), usd_per_month: num(o.usd_per_month) };
};
export const policyOf = (v: unknown): Policy => {
  const o = isObj(v) ? v : {};
  return { enabled: o.enabled === true, default_days: num(o.default_days) ?? 90, max_days: num(o.max_days) ?? 365, limits: limitsOf(o.limits) };
};
function keyOf(o: Record<string, unknown>): AdminKey {
  const u = isObj(o.user) ? o.user : {};
  const m = isObj(o.month) ? o.month : {};
  const status = o.status === 'revoked' || o.status === 'expired' ? o.status : 'active';
  return {
    id: str(o.id), name: str(o.name), hint: str(o.hint), scopes: strs(o.scopes), status, created_at: str(o.created_at), expires_at: str(o.expires_at),
    last_used_at: strOrNull(o.last_used_at), limits: limitsOf(o.limits), custom: strs(o.custom_limits),
    user: { id: str(u.id), name: str(u.name), email: str(u.email) },
    month: { runs: num(m.runs) ?? 0, tokens: num(m.tokens) ?? 0, cost_usd: num(m.cost_usd) },
  };
}

export async function listAdminKeys(signal?: AbortSignal): Promise<KeysData> {
  const d = expectObj(await call('/api/admin/keys', { signal }));
  return { policy: policyOf(d.policy), keys: objs(d.keys).map(keyOf) };
}
export const patchPolicy = async (patch: Partial<Policy>) => policyOf(await callJson('/api/admin/keys/policy', 'PATCH', patch));
export const patchKeyLimits = async (id: string, limits: Limits | null) =>
  keyOf(expectObj(await callJson(`/api/admin/keys/${encodeURIComponent(id)}`, 'PATCH', { limits })));
export const revokeAdminKey = async (id: string) => keyOf(expectObj(await callJson(`/api/admin/keys/${encodeURIComponent(id)}`, 'DELETE')));
