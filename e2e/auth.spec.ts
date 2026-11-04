import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { adminApi, launchDesktop, login, poolUser, type NewUser } from './auth';
import { ADMIN_USER, API } from './env';
import { expectHeading, relay, shot, type Relay } from './helpers';

// 로그인 (slice 03 · ADR-0010): 데스크톱은 셸보다 로그인 게이트가 먼저 · 토큰은 main 에만 · 401 → refresh 한 번 → 실패면 게이트(쓰던 글 유지).
// 계정 = 테스트 사용자(auth.ts POOL) — 첫 관리자 세션 · 마지막 스페이스를 건드리지 않는다.
const HOME_H1 = '무엇을 맡길까요?';

const gate = (win: Page) => ({
  title: win.getByRole('heading', { level: 1, name: 'BrewAI에 로그인' }),
  email: win.getByRole('textbox', { name: '이메일' }),
  password: win.getByRole('textbox', { name: '비밀번호' }),
  submit: win.getByRole('button', { name: '로그인', exact: true }),
  google: win.getByRole('button', { name: 'Google로 계속' }),
  server: win.locator('.auth-server'),
  error: win.locator('.auth-card').getByRole('alert'),
});
const rail = (win: Page) => win.getByRole('navigation', { name: '메뉴', exact: true });
const chip = (win: Page) => win.locator('.account-chip'); // 사이드바 아래 (이름 = 닉네임)
const box = (win: Page) => win.getByRole('textbox', { name: '요청 입력' });

async function signIn(win: Page, email: string, password: string) {
  const g = gate(win);
  await g.email.fill(email);
  await g.password.fill(password);
  await g.submit.click();
}

test('로그인 없이 부르면 모든 사용자 API 가 401 (Bearer 만 · 쿠키는 안 본다)', async () => {
  for (const p of ['/api/threads', '/api/runs', '/api/models', '/api/me', '/api/spaces', '/api/skills', '/api/tools', '/api/scopes']) {
    const res = await fetch(`${API}${p}`);
    expect(res.status, p).toBe(401);
    expect(res.headers.get('www-authenticate'), p).toBe('Bearer');
    expect(await res.json(), p).toEqual({ detail: 'auth_required' });
  }
  // 진짜 관리자 쿠키를 들고 와도 사용자 API 는 안 열린다 (표면이 다르다)
  const admin = await fetch(`${API}/api/admin/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: ADMIN_USER.email, password: ADMIN_USER.password }),
  });
  const cookie = admin.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('brewai_admin='))!;
  expect(cookie).toMatch(/^brewai_admin=bwc_/);
  expect((await fetch(`${API}/api/threads`, { headers: { cookie } })).status).toBe(401);
  // 틀린 Bearer 도 401
  const bad = await fetch(`${API}/api/threads`, { headers: { authorization: 'Bearer bwa_not-a-token' } });
  expect(bad.status).toBe(401);
  expect(await bad.json()).toEqual({ detail: 'invalid_token' });
  // 공개 = 상태만 (첫 관리자 있음 · 비밀번호 15자 · Google 켜짐)
  const state = await (await fetch(`${API}/api/auth/state`)).json();
  expect(state).toEqual({ needs_bootstrap: false, first_login: false, providers: { password: true, google: true }, password_min: 15 });
});

test.describe('로그인 게이트', () => {
  test.describe.configure({ mode: 'serial' });
  let user: NewUser;
  let app: ElectronApplication;
  let win: Page;
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    user = await poolUser('gate');
    ({ app, win } = await launchDesktop({ as: null }));
  });
  test.afterAll(async () => app?.close());

  test('로그인 전에는 셸이 없다 · 이메일 · 비밀번호 · Google · 서버 상태', async () => {
    const g = gate(win);
    await expect(g.title).toBeVisible();
    await expectHeading(win, 'BrewAI에 로그인');
    await expect(rail(win)).toHaveCount(0); // 레일 · 사이드바 · 대화 화면은 그려지지도 않는다
    await expect(box(win)).toHaveCount(0);
    await expect(g.email).toBeFocused();
    await expect(g.google).toBeVisible(); // 서버에 Google 키가 있을 때만 (GET /api/auth/state)
    await expect(g.server).toContainText(`서버 ${new URL(API).host}`);
    await expect(g.server).toContainText('연결됨');
    await expect(g.submit).toBeDisabled(); // 빈 칸이면 못 누른다
    await expect(win.getByRole('button', { name: '초대 코드가 있어요' })).toBeVisible();
    await expect(win.getByRole('button', { name: '비밀번호를 잊었어요' })).toBeVisible();
    await win.screenshot({ path: shot('desktop-auth-gate') });
  });

  test('틀린 비밀번호 = 한 줄 안내 (어느 쪽이 틀렸는지 말하지 않는다) · 비밀번호 칸은 비운다', async () => {
    await signIn(win, user.email, 'wrong password for sure');
    await expect(gate(win).error).toHaveText('이메일 또는 비밀번호가 맞지 않아요');
    await expect(gate(win).password).toHaveValue('');
    await expect(gate(win).email).toHaveValue(user.email);
    // 없는 계정도 같은 말 (열거 방지)
    await signIn(win, 'no-such-user@brewai.test', 'wrong password for sure');
    await expect(gate(win).error).toHaveText('이메일 또는 비밀번호가 맞지 않아요');
    await expect(rail(win)).toHaveCount(0);
  });

  test('맞는 비밀번호 → 셸 · 계정 칩 = 닉네임 · 이메일은 대소문자 무시', async () => {
    await signIn(win, user.email.toUpperCase(), user.password);
    await expectHeading(win, HOME_H1);
    await expect(rail(win)).toBeVisible();
    await expect(chip(win)).toContainText('게이트 사용자');
    await expect(win.locator('.space-switch')).toContainText('내 스페이스');
    await win.screenshot({ path: shot('desktop-auth-home') });
  });

  test('창을 새로 고쳐도 로그인 유지 (토큰은 main 에 · renderer 는 못 본다)', async () => {
    await win.reload();
    await expectHeading(win, HOME_H1);
    await expect(chip(win)).toContainText('게이트 사용자');
    // renderer 에 토큰이 없다: 상태 = {status, reason, user} 뿐 · 저장소도 비어 있다
    const seen = await win.evaluate(async () => {
      const s = await (window as any).brewai.auth.state();
      return { keys: Object.keys(s).sort(), storage: JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) };
    });
    expect(seen.keys).toEqual(['reason', 'status', 'user']);
    expect(seen.storage).not.toMatch(/bw[arh]_/);
  });

  test('계정 칩 › 로그아웃 → 게이트 (셸 없음)', async () => {
    await chip(win).click();
    await win.getByRole('menuitem', { name: '로그아웃' }).click();
    await expect(gate(win).title).toBeVisible();
    await expect(rail(win)).toHaveCount(0);
    await expect(gate(win).email).toHaveValue('');
  });
});

test.describe('세션 회전 · 재사용 감지', () => {
  test.describe.configure({ mode: 'serial' });
  let user: NewUser;
  let app: ElectronApplication;
  let win: Page;
  let first: string; // 로그인 때 받은 refresh (launch 때 한 번 쓰여 회전된다)
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    user = await poolUser('gate');
    first = (await login(user)).refresh_token;
    ({ app, win } = await launchDesktop({ refresh: first }));
    await expectHeading(win, HOME_H1);
  });
  test.afterAll(async () => app?.close());

  test('새로 받기(회전) 뒤 새로 고쳐도 로그인 유지', async () => {
    expect(await win.evaluate(() => (window as any).brewai.auth.refresh())).toBe(true); // main 이 회전 (새 refresh 를 먼저 저장)
    await win.reload();
    await expectHeading(win, HOME_H1);
    await expect(chip(win)).toContainText(user.display_name);
  });

  test('이미 쓴 refresh 가 다시 오면 세션 통째 폐기 → 앱은 게이트 덮개 · 쓰던 글은 그대로 → 다시 로그인하면 이어서', async () => {
    await box(win).fill('쓰던 글은 남아요');
    // 누군가 옛 refresh 를 다시 씀 (훔친 값) → 401 + 그 세션 전체 폐기
    const reuse = await fetch(`${API}/api/auth/token`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: first }),
    });
    expect(reuse.status).toBe(401);
    expect(await reuse.json()).toEqual({ detail: 'invalid_grant' });
    // 다음 요청 (모델 메뉴를 열면 목록을 다시 읽는다) → 401 → refresh 도 폐기됨 → 게이트 (덮개 · 아래 화면은 그대로)
    await win.locator('.composer .mpick-btn').click();
    const overlay = win.getByRole('dialog', { name: 'BrewAI에 로그인' });
    await expect(overlay).toBeVisible();
    await expect(overlay.getByRole('status').filter({ hasText: '다시 로그인해 주세요. 쓰던 글은 그대로 있어요' })).toBeVisible();
    await win.screenshot({ path: shot('desktop-auth-expired') });
    await signIn(win, user.email, user.password);
    await expect(overlay).toHaveCount(0);
    await win.keyboard.press('Escape'); // 열어 둔 모델 메뉴
    await expect(box(win)).toHaveValue('쓰던 글은 남아요');
  });
});

test.describe('서버가 꺼져 있으면', () => {
  test.describe.configure({ mode: 'serial' });
  let user: NewUser;
  let app: ElectronApplication;
  let win: Page;
  let link: Relay;
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    user = await poolUser('gate');
    link = await relay(API);
    await link.close(); // 앱이 뜰 때 서버 없음 (저장된 로그인은 있다)
    ({ app, win } = await launchDesktop({ as: user, apiUrl: link.url }));
  });
  test.afterAll(async () => {
    await app?.close();
    await link?.close();
  });

  test('게이트 + "연결 안 됨" + 다시 시도 → 서버가 돌아오면 저장된 로그인으로 들어간다', async () => {
    const g = gate(win);
    await expect(g.title).toBeVisible();
    await expect(g.server).toContainText(`서버 ${new URL(link.url).host}`);
    await expect(g.server).toContainText('연결 안 됨');
    await expect(g.google).toHaveCount(0); // 서버 정보를 모르면 Google 버튼도 없다
    await win.screenshot({ path: shot('desktop-auth-offline') });
    await link.open();
    await g.server.getByRole('button', { name: '다시 시도' }).click();
    await expectHeading(win, HOME_H1);
    await expect(chip(win)).toContainText(user.display_name);
  });
});

test.describe('비밀번호 재설정 (담당자가 준 코드)', () => {
  test.describe.configure({ mode: 'serial' });
  let user: NewUser;
  let app: ElectronApplication;
  let win: Page;
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    user = await poolUser('reset');
    ({ app, win } = await launchDesktop({ as: null }));
  });
  test.afterAll(async () => app?.close());

  test('코드 + 새 비밀번호 → 로그인 화면 안내 → 새 비밀번호로 로그인 · 옛 비밀번호는 안 된다', async () => {
    const admin = await adminApi();
    const { code } = await admin.post<{ code: string }>(`/api/admin/users/${user.id}/reset-code`);
    expect(code).toMatch(/^bwp_/);
    const next = 'a brand new passphrase 2026';

    await win.getByRole('button', { name: '비밀번호를 잊었어요' }).click();
    await expectHeading(win, '비밀번호 재설정');
    await win.getByRole('textbox', { name: '재설정 코드' }).fill(code);
    const pw = win.getByRole('textbox', { name: '새 비밀번호' });
    await pw.fill('too short');
    const submit = win.getByRole('button', { name: '비밀번호 바꾸기' });
    await expect(submit).toBeDisabled(); // 15자 미만
    await pw.fill(next);
    await submit.click();
    await expect(gate(win).title).toBeVisible();
    await expect(win.locator('.auth-card').getByRole('status').filter({ hasText: '비밀번호를 바꿨어요' })).toBeVisible();

    await signIn(win, user.email, user.password); // 옛 비밀번호
    await expect(gate(win).error).toHaveText('이메일 또는 비밀번호가 맞지 않아요');
    await signIn(win, user.email, next);
    await expectHeading(win, HOME_H1);
    // 코드는 한 번만
    const again = await fetch(`${API}/api/auth/reset`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, password: 'another passphrase 2026' }),
    });
    expect(again.status).toBe(404);
  });
});
