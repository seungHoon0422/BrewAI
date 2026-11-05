// API 키 (설정 › API 키 · ADR-0017) = conductor /api/me/keys. 키 값은 만들 때 응답에 한 번만 온다 (그 뒤엔 hint 뿐)
import { apiBase, bool, isObj, json, list, num, send, str, strOrNull } from '../../lib/api';

export type Scope = 'models:read' | 'chat' | 'usage:read';
export type Limits = { rpm: number | null; tokens_per_day: number | null; usd_per_month: number | null };
export type Policy = { enabled: boolean; default_days: number; max_days: number; limits: Limits };
export type ApiKey = {
  id: string; name: string; hint: string; scopes: Scope[]; status: 'active' | 'expired' | 'revoked';
  created_at: string; expires_at: string; last_used_at: string | null; limits: Limits; custom: string[];
  month: { runs: number; tokens: number; cost_usd: number | null };
};
export type KeysState = { policy: Policy; scopes: Scope[]; keys: ApiKey[] };

const limitsOf = (v: unknown): Limits => {
  const o = isObj(v) ? v : {};
  return { rpm: num(o.rpm), tokens_per_day: num(o.tokens_per_day), usd_per_month: num(o.usd_per_month) };
};
const scopesOf = (v: unknown): Scope[] => (Array.isArray(v) ? v.filter((x): x is Scope => x === 'models:read' || x === 'chat' || x === 'usage:read') : []);

export function toKey(v: unknown): ApiKey {
  const o = isObj(v) ? v : {};
  const m = isObj(o.month) ? o.month : {};
  const status = o.status === 'revoked' || o.status === 'expired' ? o.status : 'active';
  return {
    id: str(o.id), name: str(o.name), hint: str(o.hint), scopes: scopesOf(o.scopes), status, created_at: str(o.created_at),
    expires_at: str(o.expires_at), last_used_at: strOrNull(o.last_used_at), limits: limitsOf(o.limits),
    custom: Array.isArray(o.custom_limits) ? o.custom_limits.filter((x): x is string => typeof x === 'string') : [],
    month: { runs: num(m.runs) ?? 0, tokens: num(m.tokens) ?? 0, cost_usd: num(m.cost_usd) },
  };
}

export async function listKeys(signal?: AbortSignal): Promise<KeysState> {
  const d = await json('/api/me/keys', signal);
  const o = isObj(d) ? d : {};
  const p = isObj(o.policy) ? o.policy : {};
  return {
    policy: { enabled: bool(p.enabled), default_days: num(p.default_days) ?? 90, max_days: num(p.max_days) ?? 365, limits: limitsOf(p.limits) },
    scopes: scopesOf(o.scopes),
    keys: list(o.keys).map(toKey),
  };
}

export async function createKey(input: { name: string; scopes: Scope[]; days: number }): Promise<{ key: string; item: ApiKey }> {
  const d = await send('/api/me/keys', 'POST', input);
  const o = isObj(d) ? d : {};
  return { key: str(o.key), item: toKey(o.item) };
}

export const revokeKey = async (id: string) => toKey(await send(`/api/me/keys/${encodeURIComponent(id)}`, 'DELETE'));

// 바깥 프로그램이 쓸 주소 = 이 앱이 부르는 conductor + /v1 (서버에 올리면 그 주소)
export async function v1Base(): Promise<string> {
  const b = await apiBase();
  return b ? new URL('/v1', b).toString() : '/v1';
}
