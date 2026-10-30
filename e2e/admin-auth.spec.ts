import { test, expect, type Page } from '@playwright/test';
import { adminSignIn, login, poolUser } from './auth';
import { ADMIN_URL, ADMIN_USER, API, OIDC } from './env';
import { shot } from './helpers';

// 관리자 콘솔 로그인 (ADR-0010): 미로그인 = 전체 화면 로그인 · 쿠키(HttpOnly · SameSite=Strict) + CSRF · 인스턴스 관리자만.
// 이 스펙은 로그인 전 상태에서 시작한다 (setup 프로젝트의 쿠키를 쓰지 않음)
test.use({ storageState: { cookies: [], origins: [] } });

const form = (page: Page) => page.getByRole('form', { name: '관리자 로그인' });
const nav = (page: Page) => page.getByRole('navigation', { name: '관리 메뉴' });
async function fill(page: Page, email: string, password: string) {
  await form(page).getByRole('textbox', { name: '이메일' }).fill(email);
  await form(page).getByRole('textbox', { name: '비밀번호' }).fill(password);
  await form(page).getByRole('button', { name: '로그인' }).click();
}
const fakeGoogle = async (account: object) =>
  expect((await fetch(`${OIDC}/__fake/account`, { method: 'POST', body: JSON.stringify(account) })).ok).toBe(true);

test('로그인 전 = 전체 화면 로그인 (메뉴 · 화면 없음 · 어느 주소로 와도)', async ({ page }) => {
  for (const hash of ['', '#/models', '#/users/orgs']) {
    await page.goto(`/${hash}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('BrewAI 관리자');
    await expect(form(page)).toBeVisible();
    await expect(nav(page)).toHaveCount(0);
  }
  await expect(page.getByRole('link', { name: 'Google 계정으로 로그인' })).toBeVisible(); // 서버에 Google 키가 있을 때만
  await expect(page.getByText('관리자 권한이 있는 계정만 들어올 수 있어요')).toBeVisible();
  await page.screenshot({ path: shot('admin-login') });
});

test('틀린 비밀번호 · 관리자 아닌 사람 = 들어오지 못한다 (안내 한 줄)', async ({ page }) => {
  await page.goto('/');
  await fill(page, ADMIN_USER.email, 'definitely the wrong password');
  await expect(page.getByRole('alert')).toHaveText('이메일 또는 비밀번호가 맞지 않아요.');
  const member = await poolUser('member');
  await fill(page, member.email, member.password);
  await expect(page.getByRole('alert')).toContainText('관리자 권한이 없는 계정이에요');
  await expect(nav(page)).toHaveCount(0);
  expect((await page.context().cookies()).map((c) => c.name)).not.toContain('brewai_admin');
});

test('로그인 → 쿠키(HttpOnly · Strict) · 새로 고쳐도 유지 · 계정 메뉴 › 로그아웃 → 그 쿠키는 더 못 쓴다', async ({ page }) => {
  await adminSignIn(page);
  const cookie = (await page.context().cookies()).find((c) => c.name === 'brewai_admin')!;
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });
  expect(cookie.value).toMatch(/^bwc_/);
  await page.reload();
  await expect(nav(page)).toBeVisible();
  await expect(page.locator('.who')).toContainText(ADMIN_USER.name); // 머리 오른쪽 = 닉네임
  await page.screenshot({ path: shot('admin-signed-in') });

  await page.locator('.who').click();
  await page.getByRole('menuitem', { name: '로그아웃' }).click();
  await expect(form(page)).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '로그아웃했어요.' })).toBeVisible();
  const reuse = await fetch(`${API}/api/admin/models`, { headers: { cookie: `brewai_admin=${cookie.value}` } });
  expect(reuse.status).toBe(401);
});

test('관리자 API = 쿠키만 · 바꾸는 요청은 CSRF · 남의 출처는 거절 · Bearer 는 401 (표면 섞임)', async ({ page }) => {
  expect((await fetch(`${API}/api/admin/users`)).status).toBe(401);
  // 사용자 토큰으로 관리자 API = 401 wrong_surface (관리자라도)
  const { access_token } = await login();
  const bearer = await fetch(`${API}/api/admin/users`, { headers: { authorization: `Bearer ${access_token}` } });
  expect(bearer.status).toBe(401);
  expect(await bearer.json()).toEqual({ detail: 'wrong_surface' });

  await adminSignIn(page);
  const cookie = (await page.context().cookies()).find((c) => c.name === 'brewai_admin')!;
  const headers = { cookie: `brewai_admin=${cookie.value}`, 'content-type': 'application/json' };
  const sync = (extra: Record<string, string>) => fetch(`${API}/api/admin/models/sync`, { method: 'POST', headers: { ...headers, ...extra } });
  expect((await sync({})).status).toBe(403); // CSRF 없음
  const { csrf_token } = (await (await fetch(`${API}/api/admin/auth/me`, { headers })).json()) as { csrf_token: string };
  expect((await sync({ 'x-csrf-token': csrf_token, origin: 'https://evil.example' })).status).toBe(403);
  expect((await sync({ 'x-csrf-token': csrf_token, 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  expect((await sync({ 'x-csrf-token': csrf_token })).ok).toBe(true);
  // 콘솔 화면(같은 출처 proxy)이 보내는 요청은 통과
  await page.goto('/#/models');
  await page.getByRole('button', { name: '동기화', exact: true }).click();
  await expect(page.getByText(/^동기화했어요/)).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('Google 로 관리자 로그인: 회사 도메인(hd) 계정 = 같은 이메일 관리자에 연결 → 콘솔 · 관리자 아닌 사람 = 안내', async ({ page }) => {
  try {
    await fakeGoogle({ reset: true, email: ADMIN_USER.email, sub: `admin-${Date.now()}`, hd: ADMIN_USER.email.split('@')[1] });
    await page.goto('/');
    await page.getByRole('link', { name: 'Google 계정으로 로그인' }).click();
    await expect(nav(page)).toBeVisible();
    expect(new URL(page.url()).origin).toBe(ADMIN_URL); // 콜백도 콘솔 출처 (proxy) → 1st-party 쿠키
    expect((await page.context().cookies()).map((c) => c.name)).toContain('brewai_admin');

    await page.context().clearCookies();
    const member = await poolUser('member');
    await fakeGoogle({ reset: true, email: member.email, sub: `member-${Date.now()}`, hd: member.email.split('@')[1] });
    await page.goto('/');
    await page.getByRole('link', { name: 'Google 계정으로 로그인' }).click();
    await expect(form(page)).toBeVisible();
    await expect(page.getByRole('status').or(page.getByRole('alert')).filter({ hasText: '관리자 권한이 없는 계정이에요' })).toBeVisible();
    expect(page.url()).not.toContain('auth_error'); // 읽고 주소에서 지운다
  } finally {
    await fakeGoogle({ reset: true });
  }
});
