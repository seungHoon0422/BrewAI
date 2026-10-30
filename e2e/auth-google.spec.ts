import { test, expect, chromium, type Browser, type ElectronApplication, type Page } from '@playwright/test';
import { adminApi, createInvite, launchDesktop, poolUser, uniqueEmail, userApi, type NewUser } from './auth';
import { API, OIDC, OIDC_CLIENT_ID } from './env';
import { expectHeading, shot } from './helpers';

// Google 로그인 (ADR-0010 · slice 03): 시스템 브라우저 → conductor → (가짜) Google → conductor 콜백 → 127.0.0.1 loopback handoff + PKCE.
// 시스템 브라우저 대신 Playwright 브라우저: main 의 shell.openExternal 을 바꿔 연 주소를 받고, 그 주소를 진짜 브라우저 탭으로 연다
// (쿠키 바인딩 · 302 사슬 · loopback 페이지를 그대로 지난다). 가짜 Google 계정 = e2e/mock/oidc.mjs /__fake/account
const HOME_H1 = '무엇을 맡길까요?';
const channel = process.platform === 'darwin' ? 'chrome' : process.platform === 'win32' ? 'msedge' : undefined;

type FakeAccount = { email?: string; sub?: string; name?: string; hd?: string | null; email_verified?: boolean; reset?: boolean };
const fakeGoogle = async (account: FakeAccount) =>
  expect((await fetch(`${OIDC}/__fake/account`, { method: 'POST', body: JSON.stringify(account) })).ok).toBe(true);
const lastAuthorize = async () =>
  ((await (await fetch(`${OIDC}/__fake/state`)).json()) as { last_authorize: Record<string, string | null> }).last_authorize;
let subSeq = 0;
const newSub = () => `1099${Date.now()}${subSeq++}`;

// 시스템 브라우저를 여는 대신 주소를 모은다 (main 프로세스)
async function captureBrowser(app: ElectronApplication) {
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as any).__opened = opened;
    shell.openExternal = async (url: string) => {
      opened.push(url);
    };
  });
}
async function nextOpened(app: ElectronApplication, before: number): Promise<string> {
  let url = '';
  await expect.poll(async () => (url = await app.evaluate((_e, n) => (globalThis as any).__opened[n] ?? '', before))).not.toBe('');
  return url;
}
const openedCount = (app: ElectronApplication) => app.evaluate(() => (globalThis as any).__opened.length as number);

// 앱의 Google 버튼 → 연 주소를 브라우저 탭에서 → 마지막 페이지(loopback)
async function googleRoundTrip(app: ElectronApplication, browser: Browser, click: () => Promise<void>) {
  const before = await openedCount(app);
  await click();
  const url = await nextOpened(app, before);
  const tab = await browser.newPage();
  await tab.goto(url);
  return { url: new URL(url), tab };
}

test.describe.configure({ mode: 'serial' });
let browser: Browser;
test.beforeAll(async () => {
  browser = await chromium.launch({ channel });
});
test.afterAll(async () => {
  await fakeGoogle({ reset: true });
  await browser?.close();
});

test.describe('로그인 화면 [Google로 계속]', () => {
  test.describe.configure({ mode: 'serial' });
  let user: NewUser;
  let app: ElectronApplication;
  let win: Page;
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    user = await poolUser('gmail'); // 비밀번호로 가입한 @gmail.com 사람 → Google 이 권위인 이메일이라 처음 Google 로그인 때 자동 연결
    ({ app, win } = await launchDesktop({ as: null }));
    await captureBrowser(app);
  });
  test.afterAll(async () => app?.close());

  test('이메일 인증 안 된 Google 계정은 거절 (계정을 만들지도 연결하지도 않는다)', async () => {
    await fakeGoogle({ reset: true, email: user.email, sub: newSub(), email_verified: false });
    const { tab } = await googleRoundTrip(app, browser, () => win.getByRole('button', { name: 'Google로 계속' }).click());
    await expect(tab.getByRole('heading', { level: 1 })).toHaveText('BrewAI로 돌아가세요');
    await expect(tab.locator('p')).toHaveText('로그인을 마치지 못했어요. 앱에서 이유를 확인해 주세요.');
    expect(new URL(tab.url()).searchParams.get('error')).toBe('email_unverified');
    await tab.close();
    await expect(win.locator('.auth-card').getByRole('alert')).toHaveText('Google 에서 이메일 확인을 마친 계정만 쓸 수 있어요');
    await expect(win.getByRole('navigation', { name: '메뉴' })).toHaveCount(0);
    const me = await userApi(user);
    expect((await me.get<{ google: unknown }>('/api/me')).google).toBeNull();
  });

  test('초대받지 않은 Google 계정 = 안내 (계정 안 만듦)', async () => {
    await fakeGoogle({ reset: true, email: uniqueEmail('stranger', 'gmail.com'), sub: newSub() });
    const { tab } = await googleRoundTrip(app, browser, () => win.getByRole('button', { name: 'Google로 계속' }).click());
    expect(new URL(tab.url()).searchParams.get('error')).toBe('not_invited');
    await tab.close();
    await expect(win.locator('.auth-card').getByRole('alert')).toHaveText('이 Google 계정은 아직 초대받지 않았어요');
  });

  test('같은 @gmail.com 계정 → 자동 연결 → 로그인 (토큰은 브라우저 주소에 없다 · 1회용 handoff + PKCE)', async () => {
    const sub = newSub();
    await fakeGoogle({ reset: true, email: user.email, sub, name: 'Google 표시 이름' });
    const { url, tab } = await googleRoundTrip(app, browser, async () => {
      await win.getByRole('button', { name: 'Google로 계속' }).click();
      await expect(win.getByRole('heading', { level: 1, name: '브라우저에서 Google 로그인을 마쳐 주세요' })).toBeVisible();
      await win.screenshot({ path: shot('desktop-auth-google-wait') });
    });
    // 앱이 연 주소 = conductor 시작점 (데스크톱 · loopback 포트 · S256 challenge · ds)
    expect(url.origin + url.pathname).toBe(`${API}/api/auth/google/start`);
    expect(url.searchParams.get('client')).toBe('desktop');
    expect(Number(url.searchParams.get('port'))).toBeGreaterThan(1023);
    expect(url.searchParams.get('cc')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get('ds')).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    // 브라우저가 닿은 곳 = 이 PC 의 loopback 리스너 (code 는 bwh_ 1회용 · access/refresh 아님)
    const back = new URL(tab.url());
    expect(back.origin).toBe(`http://127.0.0.1:${url.searchParams.get('port')}`);
    expect(back.pathname).toBe('/cb');
    expect(back.searchParams.get('code')).toMatch(/^bwh_/);
    expect(back.searchParams.get('ds')).toBe(url.searchParams.get('ds'));
    await expect(tab.getByRole('heading', { level: 1 })).toHaveText('BrewAI로 돌아가세요');
    await expect(tab.locator('p')).toHaveText('로그인을 마쳤어요. 이 탭은 닫아도 돼요.');
    await tab.close();
    // conductor 가 Google 에 보낸 요청 (서버 쪽 PKCE · 계정 고르기)
    const auth = await lastAuthorize();
    expect(auth).toMatchObject({ client_id: OIDC_CLIENT_ID, scope: 'openid email profile', code_challenge_method: 'S256', prompt: 'select_account' });
    expect(auth.redirect_uri).toBe(`${API}/api/auth/google/callback`);

    await expectHeading(win, HOME_H1);
    await expect(win.locator('.account-chip')).toContainText(user.display_name); // 닉네임은 그대로 (Google 이름으로 덮지 않는다)
    const me = await userApi(user);
    expect((await me.get<{ google: { email: string } | null }>('/api/me')).google).toMatchObject({ email: user.email });
    // handoff code 는 한 번만
    const again = await fetch(`${API}/api/auth/token`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'handoff', code: back.searchParams.get('code'), code_verifier: 'x'.repeat(43) }),
    });
    expect(again.status).toBe(401);
    await win.screenshot({ path: shot('desktop-auth-google-home') });
  });
});

test.describe('초대 코드 + [Google로 가입]', () => {
  test.describe.configure({ mode: 'serial' });
  let app: ElectronApplication;
  let win: Page;
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    ({ app, win } = await launchDesktop({ as: null }));
    await captureBrowser(app);
  });
  test.afterAll(async () => app?.close());

  test('코드 확인 → Google 로 가입 → 조직 멤버 · 닉네임 = Google 이름', async () => {
    const { code } = await createInvite(await adminApi());
    const email = uniqueEmail('gsignup', 'gmail.com');
    await fakeGoogle({ reset: true, email, sub: newSub(), name: '구글 가입자' });
    await win.getByRole('button', { name: '초대 코드가 있어요' }).click();
    await win.getByRole('textbox', { name: '초대 코드' }).fill(code);
    await win.getByRole('button', { name: '확인', exact: true }).click();
    const { url, tab } = await googleRoundTrip(app, browser, () => win.getByRole('button', { name: 'Google로 가입' }).click());
    expect(url.searchParams.get('invite')).toBe(code);
    await expect(tab.getByRole('heading', { level: 1 })).toHaveText('BrewAI로 돌아가세요');
    await tab.close();
    await expectHeading(win, HOME_H1);
    await expect(win.locator('.account-chip')).toContainText('구글 가입자');
    // 초대는 다 썼다 (1명용)
    const preview = await fetch(`${API}/api/auth/invite/preview`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }),
    });
    expect(preview.status).toBe(404);
  });
});

test.describe('설정 › 계정 › Google [연결] · [해제]', () => {
  test.describe.configure({ mode: 'serial' });
  let user: NewUser;
  let app: ElectronApplication;
  let win: Page;
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    user = await poolUser('glink'); // 회사 이메일 (Google 이 권위 아님) → 로그인한 채 연결만 된다
    ({ app, win } = await launchDesktop({ as: user }));
    await captureBrowser(app);
    await expectHeading(win, HOME_H1);
  });
  test.afterAll(async () => app?.close());

  const googleRow = () => win.locator('#account li').filter({ hasText: 'Google' });

  test('연결 → 브라우저에서 Google → 앱에 "연결했어요" · 이메일이 달라도 지금 로그인한 사람에게', async () => {
    const gmail = uniqueEmail('linked', 'gmail.com');
    await fakeGoogle({ reset: true, email: gmail, sub: newSub() });
    await win.getByRole('navigation', { name: '메뉴' }).getByRole('link', { name: '설정' }).click();
    await expect(googleRow()).toContainText('연결 안 됨');
    const { url, tab } = await googleRoundTrip(app, browser, () => googleRow().getByRole('button', { name: '연결' }).click());
    expect(url.searchParams.get('link')).toMatch(/^bwl_/); // 연결 표 (5분 · 1회) — 누구에게 붙일지는 서버가 안다
    expect(new URL(tab.url()).searchParams.get('code')).toMatch(/^bwh_/); // 연결도 1회용 code — 앱이 로그인한 채 complete 로 붙인다
    expect(new URL(tab.url()).searchParams.get('linked')).toBeNull();
    await tab.close();
    await expect(win.locator('#account').getByRole('status').filter({ hasText: 'Google 을 연결했어요' })).toBeVisible();
    await expect(googleRow()).toContainText(gmail);
    const me = await (await userApi(user)).get<{ google: { email: string } | null; email: string }>('/api/me');
    expect(me.google?.email).toBe(gmail);
    expect(me.email).toBe(user.email); // 로그인 ID 는 그대로
    await win.screenshot({ path: shot('desktop-account-google') });
  });

  test('해제 → 확인 → "연결을 해제했어요" (비밀번호가 있으니 해제할 수 있다)', async () => {
    await googleRow().getByRole('button', { name: '해제' }).click();
    const dialog = win.getByRole('dialog', { name: 'Google 연결을 해제할까요?' });
    await dialog.getByRole('button', { name: '해제' }).click();
    await expect(win.locator('#account').getByRole('status').filter({ hasText: 'Google 연결을 해제했어요' })).toBeVisible();
    await expect(googleRow()).toContainText('연결 안 됨');
    expect((await (await userApi(user)).get<{ google: unknown }>('/api/me')).google).toBeNull();
  });
});
