#!/usr/bin/env node
// 가짜 MCP 서버 2개 + 가짜 OAuth 서버 (Linear 흉내) — E2E·로컬 테스트 전용. 의존성 없음 (Node 24 내장 모듈만 · oidc.mjs 처럼).
//   node e2e/mock/mcp.mjs --port 4014        (기본 127.0.0.1:4014 · BASE = http://127.0.0.1:<port>)
// conductor 쪽: CONDUCTOR_MCP_ALLOW_LOOPBACK=1 + (BREWAI_E2E=1 또는 loopback CONDUCTOR_PUBLIC_URL) 일 때만 http://127.0.0.1 MCP 를 받는다
//   + CONDUCTOR_SECRET_KEY (인증정보 암호화). 같은 모양의 pytest 가짜 = services/conductor/tests/fake_mcp.py
// 서버
//   POST /mcp          OAuth 보호 'tracker' · 도구 30개 (읽기 18 · 쓰기 12, annotations.readOnlyHint) · tools/list 10개씩 페이지
//                      Streamable HTTP · JSON 응답 · 새 방식(server/discover 2026-07-28) + 옛 방식(initialize) 둘 다
//                      토큰 없음 · 만료 = 401 + WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/mcp", scope="issues:read"
//   POST /noauth/mcp   인증 없음 'notes' · 도구 4개 · 옛 방식(initialize)만 (FAKE_MCP_NOAUTH_MODERN=1 이면 새 방식도)
// OAuth (issuer = BASE · RFC 8414 · iss 광고 · PKCE S256 만 · resource 필수)
//   GET  /.well-known/oauth-protected-resource[/mcp]   RFC 9728 {resource: BASE/mcp, authorization_servers: [BASE]}
//   GET  /.well-known/oauth-authorization-server       메타데이터 (registration_endpoint = DCR)
//   POST /register     RFC 7591 DCR → client_id (공개 client · none)
//   GET  /authorize    허용 화면 (계정 = /__fake/account 의 이름 · 화면에서 바꿀 수 있음) · FAKE_MCP_AUTO_APPROVE=1 = 화면 없이 바로 302
//   POST /authorize    [허용] → 302 redirect_uri?code&state&iss · [거부] → ?error=access_denied&state&iss
//   POST /token        authorization_code (PKCE · redirect_uri · resource 확인 · code 60초 1회) · refresh_token (회전 = 옛 것 무효)
//   POST /revoke       RFC 7009
// 테스트 조작
//   POST /__fake/account {name}        다음 로그인 계정 (기본 FAKE_MCP_ACCOUNT 또는 'alice') → {account}
//   POST /__fake/expire                access token 전부 만료 (refresh 는 살아 있음 → conductor 가 조용히 refresh)
//   POST /__fake/revoke                access · refresh 전부 폐기 (→ 다시 로그인 필요)
//   POST /__fake/reset                 전부 처음으로 (등록 client 포함)
//   GET  /__fake/state                 {account, registrations, token_requests, refresh_requests, last_authorize,
//                                       calls: [{server, tool, account, token_sha}], tokens: {계정: 살아 있는 access 수}}
//   GET  /health
// 환경변수: FAKE_MCP_ACCESS_TTL(초 · 기본 3600) · FAKE_MCP_REQUIRE_WRITE_SCOPE=1 (쓰기 도구에 issues:write 없으면 403 insufficient_scope)
import crypto from 'node:crypto';
import http from 'node:http';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const PORT = Number(arg('port', process.env.FAKE_MCP_PORT ?? 4014));
const HOST = arg('host', process.env.FAKE_MCP_HOST ?? '127.0.0.1');
const BASE = (process.env.FAKE_MCP_BASE ?? `http://${HOST}:${PORT}`).replace(/\/$/, '');
const RESOURCE = `${BASE}/mcp`;
const ACCESS_TTL = Number(process.env.FAKE_MCP_ACCESS_TTL ?? 3600);
const AUTO_APPROVE = process.env.FAKE_MCP_AUTO_APPROVE === '1';
const REQUIRE_WRITE_SCOPE = process.env.FAKE_MCP_REQUIRE_WRITE_SCOPE === '1';
const NOAUTH_MODERN = process.env.FAKE_MCP_NOAUTH_MODERN === '1';
const DEFAULT_ACCOUNT = process.env.FAKE_MCP_ACCOUNT ?? 'alice';
const MODERN = '2026-07-28';
const LEGACY = '2025-11-25';
const PAGE = 10;
const CODE_TTL_MS = 60_000;
const MAX_BODY = 256 * 1024;
const DEFAULT_SCOPE = 'issues:read issues:write'; // 쓰기 도구 = 지금 바로 허용 (ADR-0013) → 기본으로 같이 준다

// ── 도구 ─────────────────────────────────────────────────────────────────────────
const str = (description) => ({ type: 'string', description });
const TRACKER_READ = [
  ['list_issues', 'List issues in a team. Filter by state or assignee.', { team: str('Team key'), state: str('backlog | todo | done') }],
  ['search_issues', 'Search issues by text across all teams.', { query: str('Text to search') }],
  ['get_issue', 'Get one issue by id, with description and labels.', { id: str('Issue id like ENG-12') }],
  ['list_comments', 'List comments of an issue.', { issue: str('Issue id') }],
  ['list_projects', 'List projects.', {}],
  ['get_project', 'Get a project by id.', { id: str('Project id') }],
  ['search_projects', 'Search projects by name.', { query: str('Text') }],
  ['list_teams', 'List teams in the workspace.', {}],
  ['get_team', 'Get a team.', { key: str('Team key') }],
  ['list_users', 'List workspace members.', {}],
  ['get_user', 'Get a user by id or email.', { id: str('User id or email') }],
  ['get_viewer', 'Who am I (the signed-in account).', {}],
  ['list_cycles', 'List cycles (sprints) of a team.', { team: str('Team key') }],
  ['list_labels', 'List issue labels.', {}],
  ['list_milestones', 'List project milestones.', { project: str('Project id') }],
  ['get_document', 'Get a document page.', { id: str('Document id') }],
  ['search_documents', 'Search documents by text.', { query: str('Text') }],
  ['list_documents', 'List documents of a project.', { project: str('Project id') }],
];
const TRACKER_WRITE = [
  ['create_issue', 'Create a new issue in a team.', { team: str('Team key'), title: str('Title'), description: str('Markdown body') }],
  ['update_issue', 'Update an issue (title, state, priority).', { id: str('Issue id'), state: str('New state') }],
  ['delete_issue', 'Delete an issue permanently.', { id: str('Issue id') }],
  ['assign_issue', 'Assign an issue to a user.', { id: str('Issue id'), user: str('User id') }],
  ['close_issue', 'Close an issue as done.', { id: str('Issue id') }],
  ['create_comment', 'Add a comment to an issue.', { issue: str('Issue id'), body: str('Comment') }],
  ['update_comment', 'Edit a comment.', { id: str('Comment id'), body: str('Comment') }],
  ['create_project', 'Create a project.', { name: str('Name') }],
  ['archive_project', 'Archive a project.', { id: str('Project id') }],
  ['create_document', 'Create a document page.', { title: str('Title'), content: str('Markdown') }],
  ['update_document', 'Edit a document page.', { id: str('Document id'), content: str('Markdown') }],
  ['add_label', 'Add a label to an issue.', { issue: str('Issue id'), label: str('Label') }],
];
const NOTES = [
  ['echo', 'Echo the text back.', { text: str('Text') }, true],
  ['list_notes', 'List saved notes.', {}, true],
  ['search_notes', 'Search notes by text.', { query: str('Text') }, true],
  ['add_note', 'Save a new note.', { text: str('Note text') }, false],
];
const toolDef = (name, description, properties, readOnly) => ({
  name,
  title: name.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' '),
  description,
  inputSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: `${name}Args`, properties },
  annotations: { readOnlyHint: readOnly, ...(name.startsWith('delete') ? { destructiveHint: true } : {}) },
});
const TOOLS = {
  tracker: [...TRACKER_READ.map((t) => toolDef(...t, true)), ...TRACKER_WRITE.map((t) => toolDef(...t, false))],
  notes: NOTES.map(([n, d, p, ro]) => toolDef(n, d, p, ro)),
};
const WRITE = new Set(TRACKER_WRITE.map(([n]) => n));

// ── 상태 ─────────────────────────────────────────────────────────────────────────
let account = DEFAULT_ACCOUNT;
let clients = new Map(); // client_id → {redirect_uris}
let codes = new Map(); // code → {client_id, redirect_uri, challenge, resource, scope, account, expires}
let access = new Map(); // token → {account, scope, expires}
let refresh = new Map(); // token → {account, scope, client_id}
let calls = [];
let notes = [];
let counters = { registrations: 0, token_requests: 0, refresh_requests: 0 };
let lastAuthorize = null;
const reset = () => {
  account = DEFAULT_ACCOUNT;
  clients = new Map(); codes = new Map(); access = new Map(); refresh = new Map();
  calls = []; notes = []; lastAuthorize = null;
  counters = { registrations: 0, token_requests: 0, refresh_requests: 0 };
};

const rand = (n = 24) => crypto.randomBytes(n).toString('base64url');
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex').slice(0, 12);
const s256 = (verifier) => crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const send = (res, status, body, headers = {}) => {
  const isText = typeof body === 'string';
  res.writeHead(status, {
    'content-type': isText ? 'text/html; charset=utf-8' : 'application/json',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(isText ? body : JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((ok, bad) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) bad(new Error('too large'));
      else chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    req.on('error', bad);
  });

// ── OAuth ────────────────────────────────────────────────────────────────────────
const prm = () => ({ resource: RESOURCE, authorization_servers: [BASE], scopes_supported: ['issues:read', 'issues:write'], bearer_methods_supported: ['header'] });
const asMeta = () => ({
  issuer: BASE,
  authorization_endpoint: `${BASE}/authorize`,
  token_endpoint: `${BASE}/token`,
  registration_endpoint: `${BASE}/register`,
  revocation_endpoint: `${BASE}/revoke`,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  token_endpoint_auth_methods_supported: ['none'],
  code_challenge_methods_supported: ['S256'],
  scopes_supported: ['issues:read', 'issues:write'],
  authorization_response_iss_parameter_supported: true,
});

async function register(req, res) {
  let body;
  try {
    body = JSON.parse((await readBody(req)) || '{}');
  } catch {
    return send(res, 400, { error: 'invalid_client_metadata' });
  }
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u) => typeof u === 'string') : [];
  if (!uris.length) return send(res, 400, { error: 'invalid_redirect_uri' });
  const client_id = `fake_${rand(9)}`;
  clients.set(client_id, { redirect_uris: uris });
  counters.registrations += 1;
  return send(res, 201, {
    client_id, client_id_issued_at: Math.floor(Date.now() / 1000), redirect_uris: uris, token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], client_name: body.client_name ?? null,
  });
}

// 브라우저에 보이는 오류 (redirect 하지 않는다 = client · redirect_uri 가 틀릴 때)
const errorPage = (res, title) => send(res, 400, `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><h1>${esc(title)}</h1>`);

function checkAuthorize(q) {
  const c = clients.get(q.client_id);
  if (!c) return 'invalid_client';
  if (!c.redirect_uris.includes(q.redirect_uri)) return 'redirect_uri_mismatch';
  return null;
}

function finish(res, q, decision, who) {
  const redirect = new URL(q.redirect_uri);
  const set = (k, v) => redirect.searchParams.set(k, v);
  if (q.state) set('state', q.state);
  set('iss', BASE); // RFC 9207
  if (decision !== 'allow') set('error', 'access_denied');
  else if (q.response_type !== 'code') set('error', 'unsupported_response_type');
  else if (q.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(q.code_challenge ?? '')) set('error', 'invalid_request');
  else if (q.resource !== RESOURCE) set('error', 'invalid_target');
  else {
    const code = `code_${rand(18)}`;
    codes.set(code, {
      client_id: q.client_id, redirect_uri: q.redirect_uri, challenge: q.code_challenge, resource: q.resource,
      scope: q.scope || DEFAULT_SCOPE, account: who, expires: Date.now() + CODE_TTL_MS,
    });
    set('code', code);
  }
  res.writeHead(302, { location: redirect.toString(), 'cache-control': 'no-store' });
  res.end();
}

function authorizePage(url, res) {
  const q = Object.fromEntries(url.searchParams);
  const bad = checkAuthorize(q);
  if (bad) return errorPage(res, bad);
  lastAuthorize = { client_id: q.client_id, redirect_uri: q.redirect_uri, scope: q.scope ?? null, resource: q.resource ?? null, code_challenge_method: q.code_challenge_method ?? null };
  if (AUTO_APPROVE) return finish(res, q, 'allow', account);
  const hidden = Object.entries(q).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
  return send(res, 200, `<!doctype html><meta charset="utf-8"><title>Fake Tracker 로그인</title>
<main style="font-family:system-ui;max-width:420px;margin:48px auto">
<h1>Fake Tracker</h1><p>BrewAI 가 이 계정으로 이슈를 읽고 쓰려고 해요. 권한: ${esc(q.scope || DEFAULT_SCOPE)}</p>
<form method="post" action="/authorize">${hidden}
<label>계정 <input name="account" value="${esc(account)}" data-testid="fake-account"></label>
<p><button name="decision" value="allow" data-testid="fake-allow">허용</button>
<button name="decision" value="deny" data-testid="fake-deny">거부</button></p></form></main>`);
}

async function authorizePost(req, res) {
  const form = Object.fromEntries(new URLSearchParams(await readBody(req)));
  const bad = checkAuthorize(form);
  if (bad) return errorPage(res, bad);
  const who = (form.account || account).trim().slice(0, 40) || account;
  const { decision, account: _a, ...q } = form;
  return finish(res, q, decision === 'allow' ? 'allow' : 'deny', who);
}

function issue(who, scope, client_id) {
  const at = `fat_${rand(24)}`;
  const rt = `frt_${rand(24)}`;
  access.set(at, { account: who, scope, expires: Date.now() + ACCESS_TTL * 1000 });
  refresh.set(rt, { account: who, scope, client_id });
  return { access_token: at, token_type: 'Bearer', expires_in: ACCESS_TTL, refresh_token: rt, scope };
}

async function token(req, res) {
  const form = new URLSearchParams(await readBody(req));
  counters.token_requests += 1;
  const client_id = form.get('client_id');
  if (!clients.has(client_id)) return send(res, 401, { error: 'invalid_client' });
  const grant = form.get('grant_type');
  if (grant === 'authorization_code') {
    const code = form.get('code') ?? '';
    const entry = codes.get(code);
    codes.delete(code); // 1회
    if (!entry || entry.expires < Date.now() || entry.client_id !== client_id) return send(res, 400, { error: 'invalid_grant' });
    if (entry.redirect_uri !== form.get('redirect_uri')) return send(res, 400, { error: 'invalid_grant', error_description: 'redirect_uri' });
    if (s256(form.get('code_verifier') ?? '') !== entry.challenge) return send(res, 400, { error: 'invalid_grant', error_description: 'pkce' });
    if (form.get('resource') !== entry.resource) return send(res, 400, { error: 'invalid_target' });
    return send(res, 200, issue(entry.account, entry.scope, client_id));
  }
  if (grant === 'refresh_token') {
    counters.refresh_requests += 1;
    const rt = form.get('refresh_token') ?? '';
    const entry = refresh.get(rt);
    refresh.delete(rt); // 회전 = 옛 것은 한 번만
    if (!entry || entry.client_id !== client_id) return send(res, 400, { error: 'invalid_grant' });
    if (form.get('resource') && form.get('resource') !== RESOURCE) return send(res, 400, { error: 'invalid_target' });
    return send(res, 200, issue(entry.account, entry.scope, client_id));
  }
  return send(res, 400, { error: 'unsupported_grant_type' });
}

async function revoke(req, res) {
  const form = new URLSearchParams(await readBody(req));
  const t = form.get('token') ?? '';
  refresh.delete(t);
  access.delete(t);
  return send(res, 200, {});
}

// ── MCP JSON-RPC ─────────────────────────────────────────────────────────────────
const unauthorized = (res) =>
  send(res, 401, { error: 'invalid_token' }, {
    'www-authenticate': `Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp", scope="issues:read"`,
  });

function fakeResult(server, name, args, who) {
  const n = (k) => String(args?.[k] ?? '');
  if (server === 'notes') {
    if (name === 'echo') return { text: n('text') };
    if (name === 'add_note') {
      notes.push(n('text'));
      return { saved: true, count: notes.length };
    }
    return { notes: notes.filter((x) => !args?.query || x.includes(args.query)) };
  }
  if (name === 'get_viewer') return { account: who, name: `${who} (fake)` };
  if (WRITE.has(name)) return { ok: true, tool: name, account: who, id: `ENG-${100 + calls.length}`, url: `${BASE}/issue/ENG-${100 + calls.length}` };
  if (name.startsWith('list_') || name.startsWith('search_')) {
    const q = n('query');
    return {
      account: who,
      items: Array.from({ length: 5 }, (_, i) => ({ id: `ENG-${i + 1}`, title: `${q || '샘플'} 이슈 ${i + 1}`, state: i % 2 ? 'todo' : 'done' })),
    };
  }
  return { account: who, id: n('id') || 'ENG-1', title: '샘플 이슈', state: 'todo' };
}

async function mcp(req, res, server) {
  const protectedServer = server === 'tracker';
  let who = null;
  let tokenSha = null;
  if (protectedServer) {
    const m = (req.headers.authorization ?? '').match(/^Bearer\s+(\S+)$/i);
    const entry = m ? access.get(m[1]) : null;
    if (!entry || entry.expires < Date.now()) return unauthorized(res);
    who = entry;
    tokenSha = sha(m[1]);
  }
  if (req.method === 'GET' || req.method === 'DELETE') return send(res, 405, { error: 'method_not_allowed' }, { allow: 'POST' });
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  let msg;
  try {
    msg = JSON.parse(await readBody(req));
  } catch {
    return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  }
  if (Array.isArray(msg)) return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Batch not supported' } });
  if (!('id' in msg)) {
    res.writeHead(202);
    return res.end(); // 알림 (notifications/initialized 등)
  }
  const modernAllowed = protectedServer || NOAUTH_MODERN;
  const modern = modernAllowed && (req.headers['mcp-protocol-version'] === MODERN || msg.method === 'server/discover');
  const ok = (result) => send(res, 200, { jsonrpc: '2.0', id: msg.id, result: modern ? { resultType: 'complete', ...result } : result });
  const fail = (code, message) => send(res, 200, { jsonrpc: '2.0', id: msg.id, error: { code, message } });
  const params = msg.params ?? {};
  const tools = TOOLS[server];
  switch (msg.method) {
    case 'server/discover':
      if (!modernAllowed) return fail(-32601, 'Method not found');
      return ok({
        supportedVersions: [MODERN], capabilities: { tools: { listChanged: false } }, ttlMs: 0, cacheScope: 'public',
        _meta: { 'io.modelcontextprotocol/serverInfo': { name: `fake-${server}`, version: '1.0.0' } },
      });
    case 'initialize':
      return ok({ protocolVersion: LEGACY, capabilities: { tools: { listChanged: false } }, serverInfo: { name: `fake-${server}`, version: '1.0.0' } });
    case 'ping':
      return ok({});
    case 'tools/list': {
      const start = Number(params.cursor ?? 0) || 0;
      const page = tools.slice(start, start + PAGE);
      const result = { tools: page, ...(start + PAGE < tools.length ? { nextCursor: String(start + PAGE) } : {}) };
      return ok(modern ? { ...result, ttlMs: 0, cacheScope: 'private' } : result);
    }
    case 'tools/call': {
      const name = params.name;
      if (!tools.some((t) => t.name === name)) return fail(-32602, `Unknown tool: ${name}`);
      if (protectedServer && REQUIRE_WRITE_SCOPE && WRITE.has(name) && !who.scope.split(/\s+/).includes('issues:write'))
        return send(res, 403, { error: 'insufficient_scope' }, { 'www-authenticate': 'Bearer error="insufficient_scope", scope="issues:read issues:write"' });
      const whoName = who?.account ?? 'anon';
      calls.push({ server, tool: name, account: whoName, token_sha: tokenSha, args: params.arguments ?? {} });
      const data = fakeResult(server, name, params.arguments ?? {}, whoName);
      return ok({ content: [{ type: 'text', text: JSON.stringify(data) }], isError: false });
    }
    default:
      return fail(-32601, 'Method not found');
  }
}

// ── 테스트 조작 ─────────────────────────────────────────────────────────────────
async function control(req, res, what) {
  if (what === 'account') {
    let body = {};
    try {
      body = JSON.parse((await readBody(req)) || '{}');
    } catch {
      return send(res, 400, { error: 'bad_json' });
    }
    if (typeof body.name === 'string' && body.name.trim()) account = body.name.trim().slice(0, 40);
    return send(res, 200, { account });
  }
  if (what === 'expire') {
    for (const v of access.values()) v.expires = 0;
    return send(res, 200, { expired: access.size });
  }
  if (what === 'revoke') {
    const n = access.size + refresh.size;
    access.clear();
    refresh.clear();
    return send(res, 200, { revoked: n });
  }
  if (what === 'reset') {
    reset();
    return send(res, 200, { reset: true });
  }
  return send(res, 404, { error: 'not_found' });
}

function state() {
  const live = {};
  for (const v of access.values()) if (v.expires > Date.now()) live[v.account] = (live[v.account] ?? 0) + 1;
  return { account, ...counters, last_authorize: lastAuthorize, calls, tokens: live, clients: clients.size };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', BASE);
  const p = url.pathname;
  try {
    if (req.method === 'GET' && p === '/health') return send(res, 200, { status: 'ok' });
    if (req.method === 'GET' && (p === '/.well-known/oauth-protected-resource/mcp' || p === '/.well-known/oauth-protected-resource')) return send(res, 200, prm());
    if (req.method === 'GET' && (p === '/.well-known/oauth-authorization-server' || p === '/.well-known/openid-configuration')) return send(res, 200, asMeta());
    if (req.method === 'POST' && p === '/register') return await register(req, res);
    if (req.method === 'GET' && p === '/authorize') return authorizePage(url, res);
    if (req.method === 'POST' && p === '/authorize') return await authorizePost(req, res);
    if (req.method === 'POST' && p === '/token') return await token(req, res);
    if (req.method === 'POST' && p === '/revoke') return await revoke(req, res);
    if (p === '/mcp') return await mcp(req, res, 'tracker');
    if (p === '/noauth/mcp') return await mcp(req, res, 'notes');
    if (req.method === 'POST' && p.startsWith('/__fake/')) return await control(req, res, p.slice('/__fake/'.length));
    if (req.method === 'GET' && p === '/__fake/state') return send(res, 200, state());
    return send(res, 404, { error: 'not_found' });
  } catch (e) {
    return send(res, 500, { error: 'internal', message: String(e?.message ?? e) });
  }
});
server.listen(PORT, HOST, () => console.log(`[fake-mcp] ${BASE}/mcp (OAuth · ${TOOLS.tracker.length} tools) · ${BASE}/noauth/mcp (${TOOLS.notes.length} tools)`));
const stop = () => server.close(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
