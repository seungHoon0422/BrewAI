// 로그인 세션 (ADR-0010) — 토큰은 main 에만 있다.
//   access bwa_  = 이 프로세스 메모리 (15분)
//   refresh bwr_ = safeStorage 로 암호화한 userData/session.bin (쓸 때마다 회전 → 새 값을 먼저 저장하고 access 를 쓴다)
// renderer 는 토큰을 못 본다: preload.cjs 의 좁은 API (상태 · 로그인 · 가입 · 새로 고침 · 로그아웃 · Google) 로만 부르고,
// conductor 요청엔 main 이 webRequest 로 Authorization 을 붙인다 (API 출처 · 우리 창의 요청에만).
// renderer 로 가는 것 = {status, reason, user} 뿐 (user = GET /api/me 모양 · 토큰 없음).
const { app, BrowserWindow, ipcMain, net, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { startGoogle } = require('./google.cjs');

const EARLY_MS = 30_000; // access 만료 30초 전이면 요청 전에 먼저 바꾼다
// renderer 가 부르는 공개 경로(상태 · 초대 미리보기 · 재설정)와 관리자 경로엔 헤더를 붙이지 않는다 (관리자 = 쿠키만 · 섞이면 401)
const NO_BEARER = /^\/api\/(auth|admin)\//;

function createAuth({ api, packaged, fromApp, focus }) {
  // E2E: launch 마다 로그인한 refresh 를 넘기고 디스크엔 쓰지 않는다 (배포본은 무시 · slice 03 함정)
  const memoryOnly = !packaged && process.env.BREWAI_TOKEN_STORE === 'memory';
  let seed = !packaged ? process.env.BREWAI_E2E_REFRESH || null : null; // 한 번만 (로그아웃 뒤 다시 쓰지 않는다)
  const file = () => path.join(app.getPath('userData'), 'session.bin');

  let access = null; // {token, expiresAt}
  let refresh = null;
  let user = null;
  let status = 'checking'; // checking | signed_in | signed_out
  let reason = null; // offline (서버 꺼짐) | expired (다시 로그인) | null
  let refreshing = null; // single-flight
  let google = null; // 진행 중인 Google 흐름

  const snapshot = () => ({ status, reason, user });
  function emit() {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('auth:changed', snapshot());
  }
  function set(next, why = null) {
    status = next;
    reason = why;
    emit();
  }

  // ── refresh 저장 (Linux basic_text = 평문과 같아서 저장하지 않는다 → 앱을 다시 열면 로그인) ──
  async function canStore() {
    if (memoryOnly) return false;
    if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') return false;
    return safeStorage.isAsyncEncryptionAvailable().catch(() => false);
  }
  async function save(token) {
    if (!(await canStore())) return forget();
    const data = await safeStorage.encryptStringAsync(token);
    const tmp = `${file()}.tmp`;
    await fs.promises.writeFile(tmp, data, { mode: 0o600 });
    await fs.promises.rename(tmp, file());
  }
  async function forget() {
    await fs.promises.rm(file(), { force: true }).catch(() => {});
  }
  async function load() {
    if (seed) {
      const once = seed;
      seed = null;
      return once;
    }
    if (!(await canStore())) return null;
    const data = await fs.promises.readFile(file()).catch(() => null);
    if (!data) return null;
    try {
      const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(data);
      if (shouldReEncrypt) await save(result);
      return result.startsWith('bwr_') ? result : null;
    } catch {
      await forget(); // 다른 PC · 키체인이 바뀜 → 다시 로그인
      return null;
    }
  }

  // ── conductor 부르기 (main 의 net.fetch 도 lockDown 의 출처 검사를 거친다) ──
  async function call(method, pathname, body, bearer) {
    const headers = { 'content-type': 'application/json', accept: 'application/json' };
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    let res;
    try {
      res = await net.fetch(new URL(pathname, api).toString(), {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error',
      });
    } catch {
      return { status: 0, data: null };
    }
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    return { status: res.status, data, retryAfter: Number(res.headers.get('retry-after')) || null };
  }
  const post = (pathname, body, bearer) => call('POST', pathname, body, bearer);
  const fail = (r) => ({
    ok: false,
    code: r.status === 0 ? 'offline' : typeof r.data?.detail === 'string' ? r.data.detail : 'server',
    retryAfter: r.data?.retry_after ?? r.retryAfter ?? null,
  });

  // Tokens 를 받는다: 회전된 refresh 를 먼저 저장 → access 사용
  async function adopt(t) {
    if (typeof t?.access_token !== 'string' || typeof t?.refresh_token !== 'string') return false;
    refresh = t.refresh_token;
    await save(refresh).catch((e) => console.warn('[brewai] 로그인 상태를 저장하지 못했어요:', e?.message));
    access = { token: t.access_token, expiresAt: Date.now() + (Number(t.expires_in) || 900) * 1000 };
    user = t.user ?? null;
    set('signed_in');
    return true;
  }

  async function clear(why) {
    access = null;
    refresh = null;
    user = null;
    await forget();
    set('signed_out', why);
  }

  // 401 → 한 번만 바꾼다 (동시에 여러 요청이 401 이어도 POST 는 하나). true = 새 access 있음
  function refreshOnce() {
    refreshing ??= (async () => {
      if (!refresh) return false;
      const r = await post('/api/auth/token', { grant_type: 'refresh_token', refresh_token: refresh });
      if (r.status === 200 && (await adopt(r.data))) return true;
      if (r.status === 401) {
        await clear('expired'); // 만료 · 폐기 · 이미 쓴 값 → 게이트 (renderer 는 쓰던 글을 둔다)
        return false;
      }
      if (status !== 'signed_in') set('signed_out', 'offline'); // 꺼짐 · 429 · 5xx = refresh 는 그대로 두고 다시 시도
      return false;
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function start() {
    refresh ??= await load();
    if (!refresh) return set('signed_out');
    await refreshOnce();
  }

  // ── renderer 요청에 헤더 붙이기 (session.webRequest.onBeforeSendHeaders) ──
  async function authorize(details) {
    const headers = details.requestHeaders;
    if (details.webContentsId === undefined || details.method === 'OPTIONS') return headers; // main 의 요청 · CORS 사전 요청
    let url;
    try {
      url = new URL(details.url);
    } catch {
      return headers;
    }
    if (url.origin !== api || !url.pathname.startsWith('/api/') || NO_BEARER.test(url.pathname)) return headers;
    if (access && access.expiresAt - Date.now() < EARLY_MS && refresh) await refreshOnce();
    if (access) headers.Authorization = `Bearer ${access.token}`;
    return headers;
  }

  // ── 동작 (preload 가 부른다 · 결과에 토큰 없음) ──
  async function login(input) {
    const email = typeof input?.email === 'string' ? input.email.slice(0, 320) : '';
    const password = typeof input?.password === 'string' ? input.password.slice(0, 1024) : '';
    const r = await post('/api/auth/login', { email, password });
    if (r.status === 200 && (await adopt(r.data))) return { ok: true };
    return fail(r);
  }

  async function signup(input) {
    const body = {
      code: String(input?.code ?? '').slice(0, 40),
      email: String(input?.email ?? '').slice(0, 320),
      password: String(input?.password ?? '').slice(0, 1024),
    };
    if (typeof input?.display_name === 'string' && input.display_name.trim()) body.display_name = input.display_name.slice(0, 200);
    const r = await post('/api/auth/signup', body);
    if (r.status === 201 && (await adopt(r.data))) return { ok: true };
    return fail(r);
  }

  async function logout() {
    google?.cancel();
    if (access) await post('/api/auth/logout', undefined, access.token);
    await clear(null);
    return { ok: true };
  }

  // Google 로그인 · 가입(invite) · 연결(link = 설정 › 계정 · 로그인한 사람만)
  async function signInWithGoogle(input) {
    google?.cancel();
    let link;
    if (input?.link) {
      if (!access && !(await refreshOnce())) return { ok: false, code: 'auth_required' };
      let r = await post('/api/me/google/link', undefined, access.token);
      if (r.status === 401 && (await refreshOnce())) r = await post('/api/me/google/link', undefined, access.token);
      if (r.status !== 200 || typeof r.data?.link !== 'string') return fail(r);
      link = r.data.link;
    }
    const invite = typeof input?.invite === 'string' ? input.invite.slice(0, 40) : undefined;
    const flow = startGoogle({ api, invite, link });
    google = flow;
    const result = await flow.done;
    if (google === flow) google = null;
    focus();
    if (result.error) return { ok: false, code: result.error };
    if (link) {
      // 연결 = 이 PC 가 받은 code + verifier 를 로그인한 본인이 낸다 (남이 보낸 시작 주소로는 연결되지 않는다)
      const body = { code: result.code, code_verifier: flow.verifier };
      let r = await post('/api/me/google/link/complete', body, access?.token);
      if (r.status === 401 && (await refreshOnce())) r = await post('/api/me/google/link/complete', body, access.token);
      return r.status === 200 ? { ok: true, linked: true } : fail(r);
    }
    const r = await post('/api/auth/token', { grant_type: 'handoff', code: result.code, code_verifier: flow.verifier });
    if (r.status === 200 && (await adopt(r.data))) return { ok: true };
    return fail(r);
  }

  // main 의 다른 모듈(mcp-connect.cjs)이 쓰는 Bearer 요청 — 401 이면 한 번 새로 고치고 다시. 토큰은 이 파일 밖으로 안 나간다
  async function request(method, pathname, body) {
    if (!access && !(await refreshOnce())) return { status: 401, data: { detail: 'auth_required' } };
    let r = await call(method, pathname, body, access.token);
    if (r.status === 401 && (await refreshOnce())) r = await call(method, pathname, body, access.token);
    return r;
  }

  // 창을 새로 고치면 renderer 는 이 사본으로 다시 시작한다. 닉네임 · 마지막 스페이스는 renderer 가 서버에서 바꾸므로
  // 사본이 낡았을 수 있다 → 상태를 물을 때 한 번 다시 읽는다 (실패하면 있던 사본 그대로)
  async function freshUser() {
    if (status !== 'signed_in' || !access) return;
    const r = await call('GET', '/api/me', undefined, access.token);
    if (r.status === 200 && r.data?.id === user?.id) user = r.data;
  }

  // ── IPC (우리 창에서 온 것만) ──
  const handle = (channel, fn) => ipcMain.handle(channel, (event, arg) => {
    if (!fromApp(event)) throw new Error('blocked');
    return fn(arg);
  });
  function register() {
    handle('auth:state', async () => {
      await freshUser();
      return snapshot();
    });
    handle('auth:retry', async () => {
      if (status !== 'signed_in') await start();
      return snapshot();
    });
    handle('auth:login', login);
    handle('auth:signup', signup);
    handle('auth:refresh', () => refreshOnce());
    handle('auth:logout', logout);
    handle('auth:google', signInWithGoogle);
    handle('auth:google-cancel', () => {
      google?.cancel();
      return true;
    });
  }

  return { start, register, authorize, request };
}

module.exports = { createAuth };
