#!/usr/bin/env node
// 가짜 Google OIDC (accounts.google.com 흉내) — E2E·로컬 테스트 전용. 의존성 없음 (Node 24 내장 모듈만).
//   node e2e/mock/oidc.mjs --port 4012        (기본 127.0.0.1:4012 · issuer = http://127.0.0.1:<port>)
// conductor 쪽: GOOGLE_ISSUER=<issuer> · GOOGLE_CLIENT_ID · GOOGLE_CLIENT_SECRET (아래와 같게) · BREWAI_E2E=1 ·
//   CONDUCTOR_PUBLIC_URL 이 loopback 이어야 http issuer 를 받는다 (settings.google_enabled — E2E 의 유일한 예외)
// 환경변수:
//   FAKE_OIDC_ISSUER         issuer (기본 http://127.0.0.1:<port>)
//   FAKE_OIDC_CLIENT_ID      받을 client_id (기본 brewai-e2e.apps.googleusercontent.com)
//   FAKE_OIDC_CLIENT_SECRET  받을 client_secret (기본 e2e-google-secret)
//   FAKE_OIDC_EMAIL · FAKE_OIDC_SUB · FAKE_OIDC_NAME · FAKE_OIDC_HD · FAKE_OIDC_EMAIL_VERIFIED(기본 true)   자동 승인할 계정
// 구현 (Google 과 같은 모양):
//   GET  /.well-known/openid-configuration   issuer · authorization_endpoint · token_endpoint · jwks_uri …
//   GET  /o/oauth2/v2/auth                   화면 없이 자동 승인 → 302 redirect_uri?code&state (계정 deny = ?error=access_denied&state)
//                                            response_type=code · scope 에 openid · code_challenge_method=S256 · client_id 가 맞아야 (아니면 400 화면)
//   POST /token                              authorization_code + PKCE(S256) + client_secret 확인 → {access_token, id_token, …}
//                                            id_token = RS256 JWS (iss · azp · aud · sub · email · email_verified · nonce · name · hd? · iat · exp)
//                                            code 는 60초 · 1회 (두 번째 = 400 invalid_grant, Google 처럼)
//   GET  /oauth2/v3/certs                    서명 키 JWK (conductor 는 TLS 직접 수신이라 안 읽는다 · 모양만)
//   GET  /health
// 테스트 조작: POST /__fake/account {email?, sub?, name?, hd?: string|null, email_verified?, deny?, reset?}
//   → 다음 로그인부터 이 계정 (명시한 칸만 바뀜 · reset = 기본값). 응답 {account}
//   GET /__fake/state → {account, last_authorize: {client_id, redirect_uri, scope, nonce, code_challenge_method, prompt}}
import crypto from 'node:crypto';
import http from 'node:http';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const PORT = Number(arg('port', process.env.FAKE_OIDC_PORT ?? 4012));
const HOST = arg('host', process.env.FAKE_OIDC_HOST ?? '127.0.0.1');
const ISSUER = (process.env.FAKE_OIDC_ISSUER ?? `http://${HOST}:${PORT}`).replace(/\/$/, '');
const CLIENT_ID = process.env.FAKE_OIDC_CLIENT_ID ?? 'brewai-e2e.apps.googleusercontent.com';
const CLIENT_SECRET = process.env.FAKE_OIDC_CLIENT_SECRET ?? 'e2e-google-secret';
const CODE_TTL_MS = 60_000;
const MAX_BODY = 64 * 1024;

const DEFAULT_ACCOUNT = Object.freeze({
  email: process.env.FAKE_OIDC_EMAIL ?? 'google.user@gmail.com',
  sub: process.env.FAKE_OIDC_SUB ?? '108234567890123456789',
  name: process.env.FAKE_OIDC_NAME ?? '구글 사용자',
  hd: process.env.FAKE_OIDC_HD || null,
  email_verified: !/^(0|false|no)$/i.test(process.env.FAKE_OIDC_EMAIL_VERIFIED ?? 'true'),
  deny: false,
});
let account = { ...DEFAULT_ACCOUNT };
let lastAuthorize = null;
const codes = new Map(); // code → {client_id, redirect_uri, challenge, nonce, account, expires}

// 서명 키 (시작할 때마다 새로). Google 처럼 RS256 + kid
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = crypto.createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 40);
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const jws = (payload) => {
  const head = b64url(JSON.stringify({ alg: 'RS256', kid: KID, typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), privateKey);
  return `${head}.${body}.${b64url(sig)}`;
};
const s256 = (verifier) => crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

const send = (res, status, body, headers = {}) => {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(text);
};
const page = (res, status, title) => send(res, status, `<!doctype html><meta charset="utf-8"><title>${title}</title><h1>${title}</h1>`);
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

function discovery() {
  return {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/o/oauth2/v2/auth`,
    token_endpoint: `${ISSUER}/token`,
    userinfo_endpoint: `${ISSUER}/v1/userinfo`,
    jwks_uri: `${ISSUER}/oauth2/v3/certs`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    scopes_supported: ['openid', 'email', 'profile'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
    claims_supported: ['aud', 'email', 'email_verified', 'exp', 'family_name', 'given_name', 'hd', 'iat', 'iss', 'name', 'nonce', 'picture', 'sub'],
    code_challenge_methods_supported: ['plain', 'S256'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
  };
}

function authorize(url, res) {
  const q = Object.fromEntries(url.searchParams);
  // client_id · redirect_uri 가 틀리면 Google 도 redirect 하지 않고 오류 화면 (400 redirect_uri_mismatch 등)
  if (q.client_id !== CLIENT_ID) return page(res, 400, 'invalid_client');
  let redirect;
  try {
    redirect = new URL(q.redirect_uri ?? '');
  } catch {
    return page(res, 400, 'redirect_uri_mismatch');
  }
  if (!/^https?:$/.test(redirect.protocol)) return page(res, 400, 'redirect_uri_mismatch');
  lastAuthorize = {
    client_id: q.client_id, redirect_uri: q.redirect_uri, scope: q.scope ?? '', nonce: q.nonce ?? null,
    code_challenge_method: q.code_challenge_method ?? null, prompt: q.prompt ?? null,
  };
  const back = (params) => {
    for (const [k, v] of Object.entries(params)) redirect.searchParams.set(k, v);
    if (q.state) redirect.searchParams.set('state', q.state);
    res.writeHead(302, { location: redirect.toString(), 'cache-control': 'no-store' });
    res.end();
  };
  if (q.response_type !== 'code') return back({ error: 'unsupported_response_type' });
  if (!(q.scope ?? '').split(/\s+/).includes('openid')) return back({ error: 'invalid_scope' });
  if (q.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(q.code_challenge ?? '')) return back({ error: 'invalid_request' });
  if (account.deny) return back({ error: 'access_denied' });
  const code = `4/0A${crypto.randomBytes(24).toString('base64url')}`;
  codes.set(code, {
    client_id: q.client_id, redirect_uri: q.redirect_uri, challenge: q.code_challenge, nonce: q.nonce ?? null,
    account: { ...account }, expires: Date.now() + CODE_TTL_MS,
  });
  return back({ code, scope: 'email profile openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile', authuser: '0', prompt: 'consent' });
}

async function token(req, res) {
  const raw = await readBody(req);
  const form = new URLSearchParams(raw);
  // client 인증: client_secret_post 또는 Basic
  let id = form.get('client_id');
  let secret = form.get('client_secret');
  const basic = (req.headers.authorization ?? '').match(/^Basic\s+(.+)$/i);
  if (basic) [id, secret] = Buffer.from(basic[1], 'base64').toString('utf8').split(':').map(decodeURIComponent);
  if (id !== CLIENT_ID || !same(secret ?? '', CLIENT_SECRET)) return send(res, 401, { error: 'invalid_client', error_description: 'Unauthorized' });
  if (form.get('grant_type') !== 'authorization_code') return send(res, 400, { error: 'unsupported_grant_type' });
  const code = form.get('code') ?? '';
  const entry = codes.get(code);
  codes.delete(code); // 1회
  if (!entry || entry.expires < Date.now()) return send(res, 400, { error: 'invalid_grant', error_description: 'Bad Request' });
  if (entry.client_id !== id || entry.redirect_uri !== form.get('redirect_uri'))
    return send(res, 400, { error: 'redirect_uri_mismatch', error_description: 'Bad Request' });
  if (!same(s256(form.get('code_verifier') ?? ''), entry.challenge))
    return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid code verifier.' });
  const now = Math.floor(Date.now() / 1000);
  const a = entry.account;
  const [given, ...rest] = String(a.name ?? '').split(' ');
  const claims = {
    iss: ISSUER, azp: CLIENT_ID, aud: CLIENT_ID, sub: a.sub, ...(a.hd ? { hd: a.hd } : {}),
    email: a.email, email_verified: a.email_verified, at_hash: crypto.randomBytes(16).toString('base64url'),
    ...(entry.nonce ? { nonce: entry.nonce } : {}),
    name: a.name, given_name: given, family_name: rest.join(' ') || undefined, iat: now, exp: now + 3600,
  };
  return send(res, 200, {
    access_token: `ya29.${crypto.randomBytes(48).toString('base64url')}`,
    expires_in: 3599,
    scope: 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
    token_type: 'Bearer',
    id_token: jws(claims),
  });
}

async function control(req, res) {
  let body;
  try {
    body = JSON.parse((await readBody(req)) || '{}');
  } catch {
    return send(res, 400, { error: 'bad_json' });
  }
  if (body.reset) account = { ...DEFAULT_ACCOUNT };
  for (const k of ['email', 'sub', 'name', 'hd', 'email_verified', 'deny']) if (k in body) account[k] = body[k];
  return send(res, 200, { account });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', ISSUER);
  try {
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { status: 'ok' });
    if (req.method === 'GET' && url.pathname === '/.well-known/openid-configuration') return send(res, 200, discovery());
    if (req.method === 'GET' && url.pathname === '/o/oauth2/v2/auth') return authorize(url, res);
    if (req.method === 'POST' && url.pathname === '/token') return await token(req, res);
    if (req.method === 'GET' && url.pathname === '/oauth2/v3/certs')
      return send(res, 200, { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' }] });
    if (req.method === 'POST' && url.pathname === '/__fake/account') return await control(req, res);
    if (req.method === 'GET' && url.pathname === '/__fake/state') return send(res, 200, { account, last_authorize: lastAuthorize });
    return send(res, 404, { error: 'not_found' });
  } catch (e) {
    return send(res, 500, { error: 'internal', message: String(e?.message ?? e) });
  }
});
server.listen(PORT, HOST, () => console.log(`[fake-oidc] ${ISSUER} (client ${CLIENT_ID})`));
const stop = () => server.close(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
