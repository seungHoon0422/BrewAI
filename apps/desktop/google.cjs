// Google 로그인 — 시스템 브라우저 + 127.0.0.1 loopback 1회용 리스너 + PKCE S256 (ADR-0010 · slice 03 Google 표).
// 1) verifier(43자) · ds 를 만들고 127.0.0.1:0/cb 를 연다 (5분) 2) 브라우저로 {API}/api/auth/google/start 3) conductor 가 302 로
// http://127.0.0.1:{port}/cb?ds&code=bwh_… | error=<code> 를 돌려준다 4) ds 확인 → 'BrewAI로 돌아가세요' 페이지 → 결과.
// handoff code 교환(로그인 = POST /api/auth/token · 연결 = POST /api/me/google/link/complete) 은 auth.cjs 가 한다. 이 파일은 토큰을 모른다.
const crypto = require('node:crypto');
const http = require('node:http');
const { shell } = require('electron');

const WAIT_MS = 5 * 60_000;
const CODE_RE = /^[a-z_]{1,40}$/; // conductor 오류 코드 모양 (그 밖 = google_failed)

const b64url = (buf) => buf.toString('base64url');

function same(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// 브라우저에 남는 안내 페이지 — 외부 자원 없음 · 스크립트 없음
function page(title, body) {
  return '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
    + '<title>BrewAI</title><body style="font:16px system-ui,sans-serif;margin:18vh auto;max-width:30rem;padding:0 16px;color:#1d1d1f">'
    + `<h1 style="font-size:20px;font-weight:600">${title}</h1><p style="color:#6e6e73">${body}</p></body></html>`;
}

const PAGE_OK = page('BrewAI로 돌아가세요', '로그인을 마쳤어요. 이 탭은 닫아도 돼요.');
const PAGE_FAIL = page('BrewAI로 돌아가세요', '로그인을 마치지 못했어요. 앱에서 이유를 확인해 주세요.');

// 흐름 하나. done = {code} | {error} 로 끝난다 (취소 · 시간 초과도 error)
function startGoogle({ api, invite, link }) {
  const verifier = b64url(crypto.randomBytes(32)); // 43자 (RFC 7636 최소)
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const ds = b64url(crypto.randomBytes(24));
  let settle;
  const done = new Promise((resolve) => { settle = resolve; });
  let timer = null;
  let over = false;

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
    if (over || !same(url.searchParams.get('ds'), ds)) { // 다른 흐름 · 남이 보낸 주소
      res.writeHead(400, headers).end(PAGE_FAIL);
      return;
    }
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    const ok = code?.startsWith('bwh_');
    res.writeHead(ok ? 200 : 400, headers).end(ok ? PAGE_OK : PAGE_FAIL);
    if (ok) finish({ code });
    else finish({ error: error && CODE_RE.test(error) ? error : 'google_failed' });
  });

  function finish(result) {
    if (over) return;
    over = true;
    clearTimeout(timer);
    server.close();
    server.closeAllConnections?.();
    settle(result);
  }

  server.on('error', () => finish({ error: 'loopback_failed' }));
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    const q = new URLSearchParams({ client: 'desktop', port: String(port), cc: challenge, ds });
    if (invite) q.set('invite', invite);
    if (link) q.set('link', link);
    shell.openExternal(`${api}/api/auth/google/start?${q}`).catch(() => finish({ error: 'browser_failed' }));
  });
  timer = setTimeout(() => finish({ error: 'timeout' }), WAIT_MS);

  return { verifier, done, cancel: () => finish({ error: 'cancelled' }) };
}

module.exports = { startGoogle };
