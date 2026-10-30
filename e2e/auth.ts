import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ADMIN_URL, ADMIN_USER, API, PASSWORD } from './env';

// 로그인한 세계 (ADR-0010). 서버 호출 = 진짜 로그인으로 받은 토큰 · 쿠키만 (테스트용 뒷문 없음).
//   사용자 API  = Bearer bwa_ (POST /api/auth/login)
//   관리자 API  = 쿠키 brewai_admin + X-CSRF-Token (POST /api/admin/auth/login)
//   데스크톱    = launch 마다 새로 로그인한 refresh 를 BREWAI_E2E_REFRESH 로 · 디스크엔 안 씀 (BREWAI_TOKEN_STORE=memory)
const APP = path.join(__dirname, '..', 'apps', 'desktop');

export type Account = { email: string; password: string };
export type Me = {
  id: string;
  email: string;
  display_name: string;
  instance_role: 'admin' | 'user';
  personal_space_id: string;
  orgs: { id: string; name: string; role: string }[];
};
export type Tokens = { access_token: string; refresh_token: string; session_id: string; user: Me };

export class ApiError extends Error {
  constructor(readonly status: number, readonly detail: unknown) {
    super(`${status} ${JSON.stringify(detail)}`);
  }
}

async function read<T>(res: Response): Promise<T> {
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, (body as { detail?: unknown } | null)?.detail ?? body);
  return body as T;
}

function post(pathname: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${API}${pathname}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

export async function login(who: Account = ADMIN_USER): Promise<Tokens> {
  return read<Tokens>(await post('/api/auth/login', { email: who.email, password: who.password }));
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
export type Client = {
  // 상태 코드까지 보고 싶을 때 (오류도 Response 그대로)
  raw: (method: Method, pathname: string, body?: unknown) => Promise<Response>;
  get: <T = any>(pathname: string) => Promise<T>;
  post: <T = any>(pathname: string, body?: unknown) => Promise<T>;
  patch: <T = any>(pathname: string, body: unknown) => Promise<T>;
  put: <T = any>(pathname: string, body: unknown) => Promise<T>;
  del: (pathname: string) => Promise<void>;
};

// renew = 401 이면 한 번 새로 받고 다시 (access 15분보다 긴 스펙)
function client(headers: () => Record<string, string>, renew?: () => Promise<void>): Client {
  const once = (method: Method, pathname: string, body?: unknown) =>
    fetch(`${API}${pathname}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const raw = async (method: Method, pathname: string, body?: unknown) => {
    const res = await once(method, pathname, body);
    if (res.status !== 401 || !renew) return res;
    await renew();
    return once(method, pathname, body);
  };
  return {
    raw,
    get: async (p) => read(await raw('GET', p)),
    post: async (p, b) => read(await raw('POST', p, b ?? {})),
    patch: async (p, b) => read(await raw('PATCH', p, b)),
    put: async (p, b) => read(await raw('PUT', p, b)),
    del: async (p) => void (await read(await raw('DELETE', p))),
  };
}

// 사용자 API (Bearer). me = 로그인 응답의 사용자
export async function userApi(who: Account = ADMIN_USER): Promise<Client & { me: Me }> {
  let tokens = await login(who);
  const renew = async () => {
    tokens = await read<Tokens>(await post('/api/auth/token', { grant_type: 'refresh_token', refresh_token: tokens.refresh_token }));
  };
  return { ...client(() => ({ authorization: `Bearer ${tokens.access_token}` }), renew), me: tokens.user };
}

// 관리자 API (쿠키 + CSRF). conductor 에 바로 — Origin 없음 (curl 과 같은 모양)
export async function adminApi(who: Account = ADMIN_USER): Promise<Client> {
  const res = await post('/api/admin/auth/login', { email: who.email, password: who.password });
  const { csrf_token } = await read<{ csrf_token: string }>(res);
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('brewai_admin='));
  if (!cookie) throw new Error('관리자 쿠키가 없어요');
  return client(() => ({ cookie, 'x-csrf-token': csrf_token }));
}

// 이 실행에서 겹치지 않는 이메일 (DB 는 실행마다 새로지만 같은 실행 안에서 스펙끼리 안 겹치게)
let seq = 0;
export const uniqueEmail = (tag: string, domain = 'brewai.test') => `${tag}-${Date.now().toString(36)}${(seq++).toString(36)}@${domain}`;

export type Invite = { invite: { id: string; status: string }; code: string };
export async function createInvite(admin: Client, body: { email?: string; org_role?: 'admin' | 'member'; space_ids?: string[]; max_uses?: number; org_id?: string } = {}) {
  return admin.post<Invite>('/api/admin/invites', body);
}

// 테스트 사용자 = 실행 시작 때 한 번 초대 코드로 가입해 둔다 (global-setup). 가입은 IP 당 10분에 10번 (api_auth signup) 이라
// 스펙마다 새로 만들지 않고, 바꾸는 일(비밀번호 · 닉네임 · 비활성화 · Google 연결)마다 따로 쓴다. 모두 기본 조직 '우리 팀' member
export const POOL = {
  gate: '게이트 사용자', // auth: 게이트 · 회전 · 꺼짐 (세션만 바뀐다)
  reset: '재설정', // auth: 비밀번호 재설정 (비밀번호가 바뀐다)
  gmail: '구글 연결', // auth-google: 같은 @gmail.com → Google 자동 연결
  glink: '연결할 사람', // auth-google: 설정 › 계정 › Google 연결 · 해제
  alice: '앨리스', // spaces · projects
  bob: '밥', // spaces (다른 멤버)
  nick: '처음 이름', // account: 닉네임 바꾸기
  disabled: '비활성 대상', // admin-users: 비활성화 · 재설정 코드
  member: '일반 멤버', // admin-auth: 관리자 아닌 사람 (바꾸지 않는다)
} as const;
export type PoolKey = keyof typeof POOL;
export const poolEmail = (k: PoolKey) => (k === 'gmail' ? 'brewai.e2e.gmail@gmail.com' : `e2e-${k}@brewai.test`);
export type NewUser = Account & { id: string; display_name: string };

async function signup(code: string, email: string, display_name?: string): Promise<Tokens> {
  return read<Tokens>(await post('/api/auth/signup', { code, email, password: PASSWORD, ...(display_name ? { display_name } : {}) }));
}

export async function createPool() {
  const admin = await adminApi();
  for (const [k, nickname] of Object.entries(POOL) as [PoolKey, string][]) {
    // 이메일을 정한 초대 = 이메일 주인 확인된 계정 (열린 초대 + 비밀번호면 같은 이메일 Google 이 오면 비밀번호가 끊긴다 · ADR-0011)
    const { code } = await createInvite(admin, { email: poolEmail(k) });
    await signup(code, poolEmail(k), nickname);
  }
}

// 테스트 사용자 하나 (로그인해서 id · 지금 닉네임을 읽는다)
export async function poolUser(k: PoolKey): Promise<NewUser> {
  const who = { email: poolEmail(k), password: PASSWORD };
  const { user } = await login(who);
  return { ...who, id: user.id, display_name: user.display_name };
}

// 데스크톱 앱 (빌드본). as = 로그인할 계정 (null = 로그인 화면부터). 이 launch 만 쓰는 refresh 를 새로 받는다
// (refresh 를 주면 그걸로 — 회전 · 재사용 감지를 보는 스펙)
export async function launchDesktop(
  opts: { as?: Account | null; refresh?: string; apiUrl?: string } = {},
): Promise<{ app: ElectronApplication; win: Page }> {
  const who = opts.as === undefined ? ADMIN_USER : opts.as;
  const refresh = opts.refresh ?? (who ? (await login(who)).refresh_token : '');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'brewai-e2e-'));
  const app = await electron.launch({
    args: [APP],
    env: {
      ...process.env,
      BREWAI_API_URL: opts.apiUrl ?? API,
      BREWAI_USER_DATA: userData,
      BREWAI_TOKEN_STORE: 'memory',
      BREWAI_E2E_REFRESH: refresh,
    },
  });
  const win = await app.firstWindow();
  return { app, win };
}

// 관리자 콘솔 로그인 화면으로 들어간다 (진짜 로그인 → 쿠키). 끝 = 관리 메뉴가 보인다
export async function adminSignIn(page: Page, who: Account = ADMIN_USER) {
  await page.goto(`${ADMIN_URL}/`);
  const form = page.getByRole('form', { name: '관리자 로그인' });
  await form.getByRole('textbox', { name: '이메일' }).fill(who.email);
  await form.getByRole('textbox', { name: '비밀번호' }).fill(who.password);
  await form.getByRole('button', { name: '로그인' }).click();
  await expect(page.getByRole('navigation', { name: '관리 메뉴' })).toBeVisible();
}

// 관리자 로그인 상태 파일 (setup 프로젝트가 만든다 · admin 프로젝트가 쓴다)
export const ADMIN_STATE = path.join(__dirname, 'test-results', '.auth', 'admin.json');
