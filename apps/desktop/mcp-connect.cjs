// MCP 앱 연결 — 시스템 브라우저 + 127.0.0.1 loopback 1회용 리스너 + PKCE S256 (ADR-0013 · ADR-0010 handoff 그대로 · google.cjs 와 같은 모양).
// 1) verifier(43자) · ds 를 만들고 127.0.0.1:0/cb 를 연다 (10분 = conductor 흐름 수명)
// 2) POST /api/me/mcp/servers/{id}/connect/start {port, ds, cc, scope?} → authorize_url 을 시스템 브라우저로
// 3) 제공자 로그인 · 허용 → conductor 콜백 → 302 http://127.0.0.1:{port}/cb?code=bwm_… | ?error=<code> (ds 는 안 붙는다 · conductor 가 complete 에서 본다)
// 4) POST …/connect/complete {code, ds, code_verifier} → 연결됨. MCP 토큰은 conductor 금고에만 있다 — main 도 renderer 도 모른다.
// renderer 로 가는 것 = {ok, code?, connection?, tool_count?} 뿐 (preload.cjs 의 window.brewai.mcp).
const crypto = require('node:crypto');
const http = require('node:http');
const { ipcMain, shell } = require('electron');

const WAIT_MS = 10 * 60_000;
const CODE_RE = /^[a-z_]{1,40}$/; // conductor 오류 코드 모양 (그 밖 = connect_failed)
const ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const LOOPBACK = new Set(['127.0.0.1', 'localhost']);

const b64url = (buf) => buf.toString('base64url');

// 브라우저에 남는 안내 페이지 — 외부 자원 없음 · 스크립트 없음
function page(title, body) {
  return '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
    + '<title>BrewAI</title><body style="font:16px system-ui,sans-serif;margin:18vh auto;max-width:30rem;padding:0 16px;color:#1d1d1f">'
    + `<h1 style="font-size:20px;font-weight:600">${title}</h1><p style="color:#6e6e73">${body}</p></body></html>`;
}
const PAGE_OK = page('BrewAI로 돌아가세요', '앱 연결을 마쳤어요. 이 탭은 닫아도 돼요.');
const PAGE_FAIL = page('BrewAI로 돌아가세요', '앱 연결을 마치지 못했어요. 앱에서 이유를 확인해 주세요.');

// 로그인 화면 주소 = https · 이 PC 의 http 는 개발 · E2E(가짜 제공자)에서만 (패키지 앱 = https 만)
function safeUrl(raw, { packaged = true } = {}) {
  try {
    const url = new URL(raw);
    if (url.username || url.password) return null;
    if (url.protocol === 'https:' || (!packaged && url.protocol === 'http:' && LOOPBACK.has(url.hostname))) return url.toString();
  } catch {}
  return null;
}

// loopback 리스너 하나. done = {code} | {error} 로 끝난다 (취소 · 시간 초과도 error)
function listen() {
  let settle;
  const done = new Promise((resolve) => { settle = resolve; });
  let over = false;
  let timer = null;
  let ready;
  const port = new Promise((resolve) => { ready = resolve; });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method !== 'GET' || url.pathname !== '/cb') {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not Found');
      return;
    }
    const headers = {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
      connection: 'close',
    };
    if (over) {
      res.writeHead(400, headers).end(PAGE_FAIL);
      return;
    }
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    const ok = typeof code === 'string' && code.startsWith('bwm_') && code.length <= 200;
    res.writeHead(ok ? 200 : 400, headers).end(ok ? PAGE_OK : PAGE_FAIL);
    if (ok) finish({ code });
    else finish({ error: error && CODE_RE.test(error) ? error : 'connect_failed' });
  });

  function finish(result) {
    if (over) return;
    over = true;
    clearTimeout(timer);
    server.close();
    server.closeAllConnections?.();
    ready(0);
    settle(result);
  }

  server.on('error', () => finish({ error: 'loopback_failed' }));
  server.listen(0, '127.0.0.1', () => ready(server.address().port));
  timer = setTimeout(() => finish({ error: 'timeout' }), WAIT_MS);
  return { port, done, finish, cancel: () => finish({ error: 'cancelled' }) };
}

// request = auth.cjs 의 Bearer 요청 (401 이면 한 번 새로 고침) · focus = 창을 앞으로 · fromApp = 우리 창에서 온 IPC 인가
function createMcp({ request, focus, fromApp, packaged = true }) {
  let flow = null; // 진행 중인 흐름 하나 (새로 시작하면 앞 것은 취소)

  const fail = (r) => ({
    ok: false,
    code: r.status === 0 ? 'offline' : typeof r.data?.detail === 'string' ? r.data.detail : 'server',
  });

  async function connect(input) {
    const id = typeof input?.serverId === 'string' ? input.serverId : '';
    if (!ID_RE.test(id)) return { ok: false, code: 'bad_request' };
    const scope = typeof input?.scope === 'string' && input.scope ? input.scope.slice(0, 1000) : undefined;
    flow?.cancel();
    const verifier = b64url(crypto.randomBytes(32)); // 43자 (RFC 7636 최소)
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const ds = b64url(crypto.randomBytes(24));
    const lb = listen();
    flow = lb;
    const port = await lb.port;
    if (!port) {
      if (flow === lb) flow = null;
      return { ok: false, code: (await lb.done).error ?? 'loopback_failed' };
    }
    const base = `/api/me/mcp/servers/${encodeURIComponent(id)}`;
    const started = await request('POST', `${base}/connect/start`, { port, ds, cc: challenge, ...(scope ? { scope } : {}) });
    const url = started.status === 200 ? safeUrl(started.data?.authorize_url, { packaged }) : null;
    if (!url) {
      lb.finish({ error: 'start_failed' });
      if (flow === lb) flow = null;
      return started.status === 200 ? { ok: false, code: 'bad_authorize_url' } : fail(started);
    }
    shell.openExternal(url).catch(() => lb.finish({ error: 'browser_failed' }));
    const result = await lb.done;
    if (flow === lb) flow = null;
    if (result.error) {
      if (result.error !== 'cancelled') focus();
      return { ok: false, code: result.error };
    }
    focus();
    const done = await request('POST', `${base}/connect/complete`, { code: result.code, ds, code_verifier: verifier });
    if (done.status !== 200) return fail(done);
    return { ok: true, connection: String(done.data?.connection ?? 'connected'), tool_count: Number(done.data?.tool_count) || 0 };
  }

  const handle = (channel, fn) => ipcMain.handle(channel, (event, arg) => {
    if (!fromApp(event)) throw new Error('blocked');
    return fn(arg);
  });
  function register() {
    handle('mcp:connect', connect);
    handle('mcp:cancel', () => {
      flow?.cancel();
      return true;
    });
  }
  return { register, cancel: () => flow?.cancel() };
}

module.exports = { createMcp };
