// 연결된 앱 API — MCP 서버 목록 · 미리 확인 · 추가 · 상세 · 공유 · 가져오기 · 연결 끊기 · 시험 · 자동 로그인 설정 (conductor/api_mcp.py 머리말).
// 연결(로그인)은 여기 없다 — main 이 시스템 브라우저 + loopback 으로 한다 (lib/bridge.ts mcp · MCP 토큰은 conductor 에만).
import type { ScopePath } from '@brewai/ui';
import { ApiError, bool, isObj, json, list, num, send, str, strOrNull } from '../../lib/api';
import { toScopePath } from '../scope/api';

export type AutoAuth = 'unset' | 'on' | 'off';
export type AppSource = 'install' | 'own' | 'imported';
export type AppConnection = 'none' | 'connected' | 'expired' | 'needs_login';
export type AppStatus = 'active' | 'disabled' | 'error';
export type ShareKind = string; // 층 이름 (scope/model.ts TENANT · MEMBERSHIP) — 화면은 'org' · 'space' 를 직접 쓰지 않는다 (ADR-0012)

export type App = {
  id: string;
  handle: string;
  name: string;
  url: string;
  domain: string;
  issuer_domain: string | null; // OAuth 로그인 화면이 열릴 곳
  description: string;
  aliases: string[];
  auth: 'oauth' | 'none';
  origin: 'admin' | 'user';
  source: AppSource;
  status: AppStatus;
  connection: AppConnection;
  hidden: boolean;
  share_lost: boolean;
  blocked: string | null; // 정책에 막힌 내가 추가한 앱 (user_servers_disabled · url_not_allowed)
  usable: boolean;
  tool_count: number | null;
  tool_tokens_est: number | null;
  last_used_at: string | null;
  can_manage: boolean;
};

export type Via = { scope_kind: string; scope_id: string; path: ScopePath };
export type Importable = {
  id: string; name: string; url: string; domain: string; issuer_domain: string | null; description: string; auth: 'oauth' | 'none';
  tool_count: number | null; owner_name: string; via: Via[];
};

export type AppList = { mine: App[]; importable: Importable[]; auto_auth: AutoAuth; allow_user_servers: boolean; vault_ready: boolean };

export type Preview = {
  url: string; domain: string; name: string; handle: string; auth: 'oauth' | 'none'; issuer: string | null; issuer_domain: string | null;
  tool_count: number | null; write_count: number | null; tokens_est: number | null; prompt_line: string; prompt_tokens: number;
};

export type AppTool = { name: string; public: string; title: string; description: string; write: boolean; tokens_est: number | null };
export type Share = { scope_kind: string; scope_id: string; shared_by: string; created_at: string; path: ScopePath };
export type AppDetail = App & {
  prompt_line: string; prompt_tokens: number; listed: boolean; tools: AppTool[]; tools_fetched_at: string | null; shares: Share[] | null;
};

export type TestResult = { ok: boolean; connection: string | null; tool_count: number | null; write_count: number | null; tokens_est: number | null; code: string | null };

const pick = <T extends string>(v: unknown, all: readonly T[], fallback: T): T => (all.find((x) => x === v) ?? fallback);
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const auth = (v: unknown) => pick(v, ['oauth', 'none'] as const, 'none');

export function toApp(v: Record<string, unknown>): App {
  return {
    id: str(v.id), handle: str(v.handle), name: str(v.name, str(v.handle)), url: str(v.url), domain: str(v.domain),
    issuer_domain: strOrNull(v.issuer_domain), description: str(v.description),
    aliases: strings(v.aliases), auth: auth(v.auth), origin: v.origin === 'admin' ? 'admin' : 'user',
    source: pick(v.source, ['install', 'own', 'imported'] as const, 'install'),
    status: pick(v.status, ['active', 'disabled', 'error'] as const, 'active'),
    connection: pick(v.connection, ['none', 'connected', 'expired', 'needs_login'] as const, 'needs_login'),
    hidden: bool(v.hidden), share_lost: bool(v.share_lost), blocked: strOrNull(v.blocked), usable: bool(v.usable),
    tool_count: num(v.tool_count), tool_tokens_est: num(v.tool_tokens_est), last_used_at: strOrNull(v.last_used_at), can_manage: bool(v.can_manage),
  };
}

export const toVia = (v: Record<string, unknown>): Via => ({ scope_kind: str(v.scope_kind), scope_id: str(v.scope_id), path: toScopePath(v.path) });

function toImportable(v: Record<string, unknown>): Importable {
  return {
    id: str(v.id), name: str(v.name), url: str(v.url), domain: str(v.domain), issuer_domain: strOrNull(v.issuer_domain),
    description: str(v.description), auth: auth(v.auth),
    tool_count: num(v.tool_count), owner_name: str(v.owner_name), via: list(v.via).map(toVia),
  };
}

const autoAuth = (v: unknown): AutoAuth => pick(v, ['unset', 'on', 'off'] as const, 'unset');

export async function listApps(signal?: AbortSignal): Promise<AppList> {
  const d = await json('/api/me/mcp/servers', signal);
  if (!isObj(d)) throw new ApiError('server', 'bad_shape');
  return {
    mine: list(d.mine).map(toApp).filter((a) => a.id), importable: list(d.importable).map(toImportable).filter((a) => a.id),
    auto_auth: autoAuth(d.auto_auth), allow_user_servers: d.allow_user_servers !== false, vault_ready: d.vault_ready !== false,
  };
}

function toPreview(v: unknown): Preview {
  if (!isObj(v) || typeof v.url !== 'string') throw new ApiError('server', 'bad_shape');
  return {
    url: v.url, domain: str(v.domain), name: str(v.name), handle: str(v.handle), auth: auth(v.auth), issuer: strOrNull(v.issuer),
    issuer_domain: strOrNull(v.issuer_domain), tool_count: num(v.tool_count), write_count: num(v.write_count), tokens_est: num(v.tokens_est),
    prompt_line: str(v.prompt_line), prompt_tokens: num(v.prompt_tokens) ?? 0,
  };
}

export const previewApp = async (body: { url: string; name?: string; description?: string; handle?: string }) =>
  toPreview(await send('/api/me/mcp/servers/preview', 'POST', body));

export type AppInput = {
  url: string; name?: string; description?: string; aliases?: string[]; handle?: string; share?: { scope_kind: ShareKind; scope_id: string };
};

// 추천 서버 (conductor connectors/presets.json · 벤더가 직접 운영하는 원격 MCP). 누르면 칸만 채운다 = 추가는 사람이 누른다
export type PresetAuth = 'none' | 'oauth' | 'api_key';
export type PresetCategory = 'dev' | 'docs' | 'data' | 'work' | 'pay' | 'design';
export const PRESET_CATEGORIES: readonly PresetCategory[] = ['dev', 'docs', 'data', 'work', 'pay', 'design'];
export type Preset = {
  id: string; handle: string; name: string; vendor: string; url: string; auth: PresetAuth; category: PresetCategory; description: string;
  available: boolean; reason: string | null; note: string | null; added: boolean;
};

export async function listPresets(signal?: AbortSignal): Promise<Preset[]> {
  const d = await json('/api/me/mcp/presets', signal);
  if (!isObj(d)) throw new ApiError('server', 'bad_shape');
  return list(d.presets).map((p) => ({
    id: str(p.id), handle: str(p.handle), name: str(p.name), vendor: str(p.vendor), url: str(p.url),
    auth: pick(p.auth, ['none', 'oauth', 'api_key'] as const, 'oauth'), category: pick(p.category, PRESET_CATEGORIES, 'dev'),
    description: str(p.description), available: p.available !== false, reason: strOrNull(p.reason), note: strOrNull(p.note), added: bool(p.added),
  })).filter((p) => p.id && p.url);
}

export async function addApp(body: AppInput): Promise<App> {
  const d = await send('/api/me/mcp/servers', 'POST', body);
  if (!isObj(d)) throw new ApiError('server', 'bad_shape');
  return toApp(d);
}

const path = (id: string, rest = '') => `/api/me/mcp/servers/${encodeURIComponent(id)}${rest}`;

export async function getApp(id: string, signal?: AbortSignal): Promise<AppDetail> {
  const d = await json(path(id), signal);
  if (!isObj(d)) throw new ApiError('server', 'bad_shape');
  return {
    ...toApp(d), prompt_line: str(d.prompt_line), prompt_tokens: num(d.prompt_tokens) ?? 0, listed: d.listed !== false,
    tools: list(d.tools).map((t) => ({
      name: str(t.name), public: str(t.public), title: str(t.title) || str(t.name), description: str(t.description), write: bool(t.write),
      tokens_est: num(t.tokens_est),
    })),
    tools_fetched_at: strOrNull(d.tools_fetched_at),
    shares: Array.isArray(d.shares)
      ? list(d.shares).map((s) => ({ scope_kind: str(s.scope_kind), scope_id: str(s.scope_id), shared_by: str(s.shared_by), created_at: str(s.created_at), path: toScopePath(s.path) }))
      : null,
  };
}

export async function patchApp(id: string, body: { name?: string; description?: string; aliases?: string[]; handle?: string | null; hidden?: boolean }): Promise<App> {
  const d = await send(path(id), 'PATCH', body);
  if (!isObj(d)) throw new ApiError('server', 'bad_shape');
  return toApp(d);
}

export const removeApp = (id: string) => send(path(id), 'DELETE').then(() => undefined);
export const shareApp = (id: string, scope_kind: ShareKind, scope_id: string) => send(path(id, '/shares'), 'POST', { scope_kind, scope_id }).then(() => undefined);
export const unshareApp = (id: string, scope_kind: string, scope_id: string) =>
  send(path(id, `/shares?${new URLSearchParams({ scope_kind, scope_id })}`), 'DELETE').then(() => undefined);
export async function importApp(id: string): Promise<App> {
  const d = await send(path(id, '/import'), 'POST', {});
  if (!isObj(d)) throw new ApiError('server', 'bad_shape');
  return toApp(d);
}
export const disconnectApp = (id: string) => send(path(id, '/connection'), 'DELETE').then(() => undefined);

export async function testApp(id: string): Promise<TestResult> {
  const d = await send(path(id, '/test'), 'POST', {});
  if (!isObj(d)) throw new ApiError('server', 'bad_shape');
  return {
    ok: bool(d.ok), connection: strOrNull(d.connection), tool_count: num(d.tool_count), write_count: num(d.write_count), tokens_est: num(d.tokens_est),
    code: strOrNull(d.code),
  };
}

export async function getSettings(): Promise<{ auto_auth: AutoAuth; auto_auth_asked: boolean }> {
  const d = await json('/api/me/settings');
  return isObj(d) ? { auto_auth: autoAuth(d.auto_auth), auto_auth_asked: bool(d.auto_auth_asked) } : { auto_auth: 'unset', auto_auth_asked: false };
}
export async function setAutoAuth(value: AutoAuth): Promise<AutoAuth> {
  const d = await send('/api/me/settings', 'PATCH', { auto_auth: value });
  return isObj(d) ? autoAuth(d.auto_auth) : value;
}
