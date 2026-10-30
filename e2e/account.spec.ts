import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { adminApi, launchDesktop, login, poolUser, userApi, type NewUser } from './auth';
import { API } from './env';
import { expectHeading, shot } from './helpers';

// 계정 (ADR-0010): 로그인 ID = 이메일 (바꿀 수 없음) · 사람이 보이는 곳 = 닉네임 (1~40자 · 중복 허용 · 설정 › 계정에서 변경).
// 사람 = '처음 이름' (auth.ts POOL nick) — 닉네임 · 비밀번호를 바꾸는 스펙은 이 사람만
const HOME_H1 = '무엇을 맡길까요?';
const NEXT = '바뀐 이름';

test.describe.configure({ mode: 'serial' });
let user: NewUser;
let app: ElectronApplication;
let win: Page;
const account = () => win.locator('#account');
const row = (title: string) => account().locator('li').filter({ has: win.getByText(title, { exact: true }) });

test.beforeAll(async () => {
  test.setTimeout(120_000);
  user = await poolUser('nick');
  ({ app, win } = await launchDesktop({ as: user }));
  await expectHeading(win, HOME_H1);
});
test.afterAll(async () => app?.close());

test('계정 칩 = 닉네임 · 메뉴: 이메일 · 설정 › 계정 · 로그아웃', async () => {
  const chip = win.locator('.account-chip');
  await expect(chip).toContainText(user.display_name);
  await expect(chip).toHaveAttribute('title', user.email);
  await chip.click();
  const menu = win.getByRole('menu', { name: '계정' });
  await expect(menu).toContainText(user.email);
  await expect(menu.getByRole('menuitem')).toHaveText(['설정 › 계정', '로그아웃']);
  await menu.getByRole('menuitem', { name: '설정 › 계정' }).click();
  await expectHeading(win, '설정');
  await expect(row('닉네임')).toContainText(user.display_name);
  await expect(row('이메일')).toContainText(user.email);
  await expect(row('이메일').getByRole('button')).toHaveCount(0); // 로그인 ID 는 바꿀 수 없다
  await expect(row('비밀번호')).toContainText('설정됨');
  await win.screenshot({ path: shot('desktop-account') });
});

test('닉네임 바꾸기: 그대로 · 빈 이름은 저장 못 함 · 공백은 하나로 → 바꾸면 칩 · 설정 · 다른 사람이 보는 곳에 바로', async () => {
  await row('닉네임').getByRole('button', { name: '변경' }).click();
  const dialog = win.getByRole('dialog', { name: '닉네임 바꾸기' });
  const input = dialog.getByRole('textbox', { name: '닉네임' });
  const save = dialog.getByRole('button', { name: '저장' });
  await expect(input).toHaveValue(user.display_name);
  await expect(save).toBeDisabled(); // 그대로면 저장할 것이 없다
  await input.fill('   ');
  await expect(save).toBeDisabled();
  await input.fill(`  ${NEXT.replace(' ', '   ')}  `); // 앞뒤 · 겹친 공백은 하나로
  await save.click();
  await expect(dialog).toHaveCount(0);
  await expect(account().getByRole('status')).toHaveText('저장했어요');
  await expect(row('닉네임')).toContainText(NEXT);
  await expect(win.locator('.account-chip')).toContainText(NEXT);
  await win.screenshot({ path: shot('desktop-account-nickname') });

  // 서버: 내 정보 · 조직 사람 찾기 · 관리자 사용자 목록 = 새 닉네임
  const me = await userApi(user);
  expect((await me.get<{ display_name: string }>('/api/me')).display_name).toBe(NEXT);
  const other = await userApi(await poolUser('member'));
  const found = await other.get<{ user_id: string; display_name: string }[]>(`/api/org/members?q=${encodeURIComponent(NEXT)}`);
  expect(found.find((p) => p.user_id === user.id)?.display_name).toBe(NEXT);
  const admin = await adminApi();
  expect((await admin.get<{ id: string; display_name: string }[]>('/api/admin/users')).find((u) => u.id === user.id)?.display_name).toBe(NEXT);
  // 새로 고쳐도 새 이름 (main 이 쥔 사본도 다시 읽는다)
  await win.reload();
  await expect(win.locator('.account-chip')).toContainText(NEXT);
});

test('닉네임 규칙은 서버가 지킨다: 41자 · 제어 문자 = 422 · 다른 사람과 같아도 된다', async () => {
  const me = await userApi(user);
  for (const bad of ['가'.repeat(41), '이름\u0007', ' ']) {
    const res = await me.raw('PATCH', '/api/me', { display_name: bad });
    expect(res.status, JSON.stringify(bad)).toBe(422);
    expect(await res.json()).toEqual({ detail: 'bad_display_name' });
  }
  const twin = (await poolUser('member')).display_name;
  expect((await me.patch<{ display_name: string }>('/api/me', { display_name: twin })).display_name).toBe(twin);
  await me.patch('/api/me', { display_name: NEXT });
});

test('비밀번호 바꾸기: 지금 비밀번호가 틀리면 안내 → 맞으면 바뀌고 다른 기기는 로그아웃 · 이 기기는 그대로', async () => {
  const elsewhere = await login(user); // 다른 기기의 세션
  const next = 'my next long passphrase 2026';
  await row('비밀번호').getByRole('button', { name: '변경' }).click();
  const dialog = win.getByRole('dialog', { name: '비밀번호 바꾸기' });
  await dialog.getByRole('textbox', { name: '지금 비밀번호' }).fill('not my password at all');
  await dialog.getByRole('textbox', { name: '새 비밀번호' }).fill(next);
  await dialog.getByRole('button', { name: '저장' }).click();
  await expect(dialog.getByText('지금 비밀번호가 맞지 않아요')).toBeVisible();
  await dialog.getByRole('textbox', { name: '지금 비밀번호' }).fill(user.password);
  await dialog.getByRole('button', { name: '저장' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(account().getByRole('status')).toHaveText('비밀번호를 바꿨어요. 다른 기기는 다시 로그인해야 해요');

  // 다른 세션 = access · refresh 둘 다 폐기
  expect((await fetch(`${API}/api/me`, { headers: { authorization: `Bearer ${elsewhere.access_token}` } })).status).toBe(401);
  const renew = await fetch(`${API}/api/auth/token`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: elsewhere.refresh_token }),
  });
  expect(renew.status).toBe(401);
  await win.getByRole('navigation', { name: '메뉴' }).getByRole('link', { name: '진행 상황' }).click();
  await expectHeading(win, '진행 상황'); // 이 기기는 로그인 그대로
  const tryLogin = (password: string) =>
    fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: user.email, password }) });
  expect((await tryLogin(user.password)).status).toBe(401);
  expect((await tryLogin(next)).status).toBe(200);
});
