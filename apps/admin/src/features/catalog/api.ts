// 카탈로그 = conductor /api/admin/skills (제품 스킬 · 읽기 전용) + /api/admin/mcp/* (MCP 서버 · ADR-0013 · 쿠키 + CSRF).
// 인증정보(토큰 · client secret)는 응답에 없다 — 연결한 사람 수 · has_secret 같은 개수 · 여부만 온다.
import { AdminApiError, call, callJson, expectList, expectObj, isObj, num, objs, str, strOrNull, strs } from '../../shared/http';

/* ── Skill ───────────────────────────────────────────── */
export type AdminSkill = {
  name: string; label: string; description: string; tools: string[]; version: string; source: string; builtin: boolean; used: number; lines: number;
};
export type SkillCatalog = { source: string; skills: AdminSkill[]; errors: { dir: string; code: string; message: string }[] };

export async function listAdminSkills(signal?: AbortSignal): Promise<SkillCatalog> {
  const data = await call('/api/admin/skills', { signal });
  if (!isObj(data) || !Array.isArray(data.skills)) throw new AdminApiError('server', 'bad_shape');
  return {
    source: str(data.source, 'runtime/skills'),
    skills: data.skills.filter(isObj).map((k) => ({
      name: str(k.name), label: str(k.label, str(k.name)), description: str(k.description), tools: strs(k.tools),
      version: str(k.version), source: str(k.source), builtin: k.builtin === true, used: num(k.used) ?? 0, lines: num(k.lines) ?? 0,
    })),
    errors: Array.isArray(data.errors)
      ? data.errors.filter(isObj).map((e) => ({ dir: str(e.dir), code: str(e.code), message: str(e.message) }))
      : [],
  };
}

/* ── MCP 서버 ─────────────────────────────────────────── */
export type McpAuth = 'oauth' | 'none';
export type McpStatus = 'active' | 'disabled' | 'error';
export type ToolMode = 'hidden' | 'auto' | 'approval';

// 사전 등록 client (관리자가 넣은 것) | DCR (conductor 가 제공자에 자동 등록). secret 값은 절대 안 온다
export type OAuthClient = {
  issuer: string; client_id: string; source: 'preregistered' | 'dcr'; auth_method: string; has_secret: boolean; scope: string | null; updated_at: string | null;
};

export type AdminServer = {
  id: string;
  handle: string;
  name: string;
  url: string; // query 값 · userinfo 는 *** (conductor ssrf.redact_url · 원래 주소는 호출에만)
  url_redacted: boolean; // 가린 칸이 있다 (?tavilyApiKey=*** 처럼)
  domain: string;
  description: string;
  aliases: string[];
  auth: McpAuth;
  origin: 'admin' | 'user';
  owner_user_id: string | null;
  issuer: string | null;
  issuer_domain: string | null;
  status: McpStatus;
  tool_count: number | null; // OAuth = 누군가 로그인해 도구 목록을 받기 전엔 null
  tool_tokens_est: number | null;
  write_count: number | null;
  tools_fetched_at: string | null;
  connected_count: number;
  last_error: string | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
  oauth_client: OAuthClient | null;
  prompt_line: string; // 에이전트가 대화마다 보는 목록 한 줄
  prompt_tokens: number;
};
export type UserServer = AdminServer & { owner_name: string; share_count: number };

// 추가할 때 conductor 가 찾아본 것 (로그인 방식 · 도구 수 · 예상 토큰). OAuth 는 로그인 전이라 도구 칸이 null
export type Preview = {
  url: string; domain: string; name: string; handle: string; auth: McpAuth; issuer: string | null; issuer_domain: string | null;
  tool_count: number | null; write_count: number | null; tokens_est: number | null; prompt_line: string; prompt_tokens: number;
};

export type McpTool = {
  name: string; public: string; title: string; description: string; write: boolean; tokens_est: number; mode: ToolMode; always_reveal: boolean; aliases: string[];
};
export type ToolList = { tools: McpTool[]; fetched_at: string | null };

export type TestResult = { ok: boolean; auth: McpAuth; tool_count: number | null; write_count: number | null; tokens_est: number | null; code: string | null; duration_ms: number | null };

export type McpPolicy = { allow_user_servers: boolean; url_allowlist: string[] };

const auth = (v: unknown): McpAuth => (v === 'none' ? 'none' : 'oauth');
const status = (v: unknown): McpStatus => (v === 'disabled' || v === 'error' ? v : 'active');
const mode = (v: unknown): ToolMode => (v === 'hidden' || v === 'approval' ? v : 'auto');

function toClient(v: unknown): OAuthClient | null {
  if (!isObj(v) || !str(v.client_id)) return null;
  return {
    issuer: str(v.issuer), client_id: str(v.client_id), source: v.source === 'preregistered' ? 'preregistered' : 'dcr',
    auth_method: str(v.auth_method, 'none'), has_secret: v.has_secret === true, scope: strOrNull(v.scope), updated_at: strOrNull(v.updated_at),
  };
}

function toServer(s: Record<string, unknown>): AdminServer {
  const url = str(s.url);
  return {
    id: str(s.id), handle: str(s.handle), name: str(s.name, str(s.handle)), url, url_redacted: s.url_redacted === true, domain: str(s.domain, url),
    description: str(s.description), aliases: strs(s.aliases), auth: auth(s.auth), origin: s.origin === 'user' ? 'user' : 'admin',
    owner_user_id: strOrNull(s.owner_user_id), issuer: strOrNull(s.issuer), issuer_domain: strOrNull(s.issuer_domain), status: status(s.status),
    tool_count: num(s.tool_count), tool_tokens_est: num(s.tool_tokens_est), write_count: num(s.write_count), tools_fetched_at: strOrNull(s.tools_fetched_at),
    connected_count: num(s.connected_count) ?? 0, last_error: strOrNull(s.last_error), last_checked_at: strOrNull(s.last_checked_at),
    created_at: str(s.created_at), updated_at: str(s.updated_at), oauth_client: toClient(s.oauth_client),
    prompt_line: str(s.prompt_line), prompt_tokens: num(s.prompt_tokens) ?? 0,
  };
}

function toPreview(p: unknown): Preview | null {
  if (!isObj(p)) return null;
  return {
    url: str(p.url), domain: str(p.domain), name: str(p.name), handle: str(p.handle), auth: auth(p.auth), issuer: strOrNull(p.issuer),
    issuer_domain: strOrNull(p.issuer_domain), tool_count: num(p.tool_count), write_count: num(p.write_count), tokens_est: num(p.tokens_est),
    prompt_line: str(p.prompt_line), prompt_tokens: num(p.prompt_tokens) ?? 0,
  };
}

function toTools(data: unknown): ToolList {
  const d = expectObj(data);
  return {
    tools: objs(d.tools).map((t) => ({
      name: str(t.name), public: str(t.public, str(t.name)), title: str(t.title), description: str(t.description), write: t.write === true,
      tokens_est: num(t.tokens_est) ?? 0, mode: mode(t.mode), always_reveal: t.always_reveal === true, aliases: strs(t.aliases),
    })),
    fetched_at: strOrNull(d.fetched_at),
  };
}

const serverPath = (id: string) => `/api/admin/mcp/servers/${encodeURIComponent(id)}`;

// 아이콘 = conductor 가 받아 둔 서버 사이트 그림 (200 그림 · 204 없음 · 관리자 쿠키). 그리기 = icons.ts
export const serverIconPath = (id: string) => `${serverPath(id)}/icon`;
export const presetIconPath = (id: string) => `/api/admin/mcp/presets/${encodeURIComponent(id)}/icon`;

// 추천 서버 (conductor connectors/presets.json · 벤더가 직접 운영하는 원격 MCP). 누르면 칸만 채운다 = 추가는 사람이 누른다
export type PresetAuth = 'none' | 'oauth' | 'api_key';
export type PresetCategory = 'dev' | 'docs' | 'search' | 'data' | 'work' | 'pay' | 'design';
export const PRESET_CATEGORIES: readonly PresetCategory[] = ['dev', 'docs', 'search', 'data', 'work', 'pay', 'design'];
export type McpPreset = {
  id: string; handle: string; name: string; vendor: string; url: string; auth: PresetAuth; category: PresetCategory; description: string;
  docs_url: string; verified_on: string; available: boolean; reason: string | null; note: string | null; added: boolean;
};

export async function listMcpPresets(signal?: AbortSignal): Promise<McpPreset[]> {
  const d = expectObj(await call('/api/admin/mcp/presets', { signal }));
  const auths: readonly PresetAuth[] = ['none', 'oauth', 'api_key'];
  return objs(d.presets).map((p): McpPreset => ({
    id: str(p.id), handle: str(p.handle), name: str(p.name), vendor: str(p.vendor), url: str(p.url),
    auth: auths.find((a) => a === p.auth) ?? 'oauth',
    category: PRESET_CATEGORIES.find((c) => c === p.category) ?? 'dev', description: str(p.description), docs_url: str(p.docs_url),
    verified_on: str(p.verified_on), available: p.available !== false, reason: strOrNull(p.reason), note: strOrNull(p.note), added: p.added === true,
  })).filter((p) => p.id && p.url);
}

// 전체 공통 서버 (관리자가 추가 = 모두에게 · 각자 자기 계정으로 로그인)
export async function listMcpServers(signal?: AbortSignal): Promise<AdminServer[]> {
  return expectList(await call('/api/admin/mcp/servers', { signal })).map(toServer);
}

// 관리자 서버 · 사용자 서버 둘 다 (자세히 페이지)
export async function getMcpServer(id: string, signal?: AbortSignal): Promise<AdminServer> {
  return toServer(expectObj(await call(serverPath(id), { signal })));
}

export type NewServer = { url: string; name?: string; description?: string; aliases?: string[]; handle?: string };
// conductor 가 주소 검사(https · 사설망 막기) → 로그인 방식 찾기 → 도구 목록 한 번 → 저장. 같은 주소 = 409 server_exists
export async function addMcpServer(body: NewServer): Promise<{ server: AdminServer; preview: Preview | null }> {
  const d = expectObj(await callJson('/api/admin/mcp/servers', 'POST', body));
  return { server: toServer(d), preview: toPreview(d.preview) };
}

export type ServerPatch = { name?: string; description?: string; aliases?: string[]; handle?: string; status?: 'active' | 'disabled' };
export async function patchMcpServer(id: string, patch: ServerPatch): Promise<AdminServer> {
  return toServer(expectObj(await callJson(serverPath(id), 'PATCH', patch)));
}

export async function deleteMcpServer(id: string): Promise<void> {
  await callJson(serverPath(id), 'DELETE');
}

// OAuth 서버 = 관리자 본인이 데스크톱에서 연결해 뒀으면 그 계정으로 도구 수까지 · 아니면 code = needs_login (서버는 살아 있음)
export async function testMcpServer(id: string): Promise<TestResult> {
  const d = expectObj(await callJson(`${serverPath(id)}/test`, 'POST'));
  return {
    ok: d.ok === true, auth: auth(d.auth), tool_count: num(d.tool_count), write_count: num(d.write_count), tokens_est: num(d.tokens_est),
    code: strOrNull(d.code), duration_ms: num(d.duration_ms),
  };
}

export async function listMcpTools(id: string, signal?: AbortSignal): Promise<ToolList> {
  return toTools(await call(`${serverPath(id)}/tools`, { signal }));
}

// approval = 저장만 (승인 카드 slice 07 전까진 바로 실행과 같다 · ADR-0013)
export type ToolPatch = { tool: string; mode?: ToolMode; always_reveal?: boolean; aliases?: string[] };
export async function patchMcpTool(id: string, patch: ToolPatch): Promise<ToolList> {
  return toTools(await callJson(`${serverPath(id)}/tools`, 'PATCH', patch));
}

// 사전 등록 OAuth client. secret 은 conductor 금고에만 (응답엔 has_secret)
export type ClientIn = { client_id: string; client_secret?: string; auth_method?: 'none' | 'client_secret_post' | 'client_secret_basic'; scope?: string };
export async function putOAuthClient(id: string, body: ClientIn): Promise<OAuthClient | null> {
  return toClient(await callJson(`${serverPath(id)}/oauth-client`, 'PUT', body));
}

// 사용자 추가 서버 (주인 · 공유 수 · 연결한 사람 수만)
export async function listUserServers(signal?: AbortSignal): Promise<UserServer[]> {
  return expectList(await call('/api/admin/mcp/user-servers', { signal })).map((s) => ({
    ...toServer(s), owner_name: str(s.owner_name), share_count: num(s.share_count) ?? 0,
  }));
}

export async function setUserServerStatus(id: string, next: 'active' | 'disabled'): Promise<AdminServer> {
  return toServer(expectObj(await callJson(`/api/admin/mcp/user-servers/${encodeURIComponent(id)}`, 'PATCH', { status: next })));
}

const toPolicy = (data: unknown): McpPolicy => {
  const d = expectObj(data);
  return { allow_user_servers: d.allow_user_servers !== false, url_allowlist: strs(d.url_allowlist) };
};
export async function getMcpPolicy(signal?: AbortSignal): Promise<McpPolicy> {
  return toPolicy(await call('/api/admin/mcp/policy', { signal }));
}
export async function patchMcpPolicy(patch: Partial<McpPolicy>): Promise<McpPolicy> {
  return toPolicy(await callJson('/api/admin/mcp/policy', 'PATCH', patch));
}
