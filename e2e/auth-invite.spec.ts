import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { adminApi, createInvite, launchDesktop, poolUser, uniqueEmail, userApi, type Client } from './auth';
import { ADMIN_USER, API, PASSWORD } from './env';
import { expectHeading, shot } from './helpers';

// 가입 = 초대 코드로만 (ADR-0011 · slice 04). 관리자가 코드를 만들고 → 데스크톱 '초대 코드가 있어요' → 미리보기(조직 · 초대한 사람 · 역할 · 스페이스)
// → 이메일 · 닉네임 · 비밀번호 → 그 조직 member + 코드에 넣은 공유 스페이스 멤버. 코드는 대소문자 · 띄어쓰기 · O/0 를 가리지 않는다
const HOME_H1 = '무엇을 맡길까요?';

test.describe.configure({ mode: 'serial' });
let admin: Client;
let app: ElectronApplication;
let win: Page;
let space: { id: string; name: string };
let code: string;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  admin = await adminApi();
  // 코드에 넣을 공유 스페이스 (조직 멤버가 만든 비공개 스페이스)
  const host = await userApi(await poolUser('member'));
  space = await host.post<{ id: string; name: string }>('/api/spaces', { name: `초대 스페이스 ${Date.now().toString(36)}`, visibility: 'private' });
  ({ code } = await createInvite(admin, { space_ids: [space.id] }));
  expect(code).toMatch(/^BREW-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  ({ app, win } = await launchDesktop({ as: null }));
});
test.afterAll(async () => app?.close());

const codeBox = () => win.getByRole('textbox', { name: '초대 코드' });
const check = () => win.getByRole('button', { name: '확인', exact: true });

test('모르는 코드 = 안내 (조직을 보여 주지 않는다)', async () => {
  await win.getByRole('button', { name: '초대 코드가 있어요' }).click();
  await expectHeading(win, '초대 코드로 가입');
  await expect(check()).toBeDisabled();
  await codeBox().fill('BREW-ZZZZ-ZZZZ');
  await check().click();
  await expect(win.locator('.auth-card').getByRole('alert')).toHaveText('쓸 수 없는 초대 코드예요. 만료됐거나 이미 다 쓰였을 수 있어요');
  await expect(win.locator('.auth-invite')).toHaveCount(0);
});

test('코드 → 미리보기: 조직 · 초대한 사람(닉네임) · 역할 · 함께 들어가는 스페이스 · 만료', async () => {
  // 소문자 · 띄어쓰기 · O 를 0 으로 잘못 써도 같은 코드
  await codeBox().fill(` ${code.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o')} `);
  await check().click();
  const card = win.locator('.auth-invite');
  await expect(card.locator('.auth-invite-org')).toHaveText('우리 팀');
  await expect(card).toContainText(`${ADMIN_USER.name} 님이 초대했어요`);
  await expect(card).toContainText('멤버로 들어가요');
  await expect(card).toContainText(/\d+월 \d+일까지/);
  await expect(card.getByLabel('함께 들어가는 스페이스')).toHaveText(space.name);
  await expect(win.getByRole('button', { name: 'Google로 가입' })).toBeVisible();
  await win.screenshot({ path: shot('desktop-invite-preview') });
});

test('비밀번호 15자 미만이면 가입 버튼이 잠긴다 · 닉네임은 비워도 된다 (이메일 @ 앞)', async () => {
  const submit = win.getByRole('button', { name: '가입하기' });
  await win.getByRole('textbox', { name: '이메일' }).fill('someone@brewai.test');
  await win.getByRole('textbox', { name: '비밀번호' }).fill('fourteen chars');
  await expect(submit).toBeDisabled();
  await expect(win.getByRole('textbox', { name: '닉네임' })).toHaveAttribute('placeholder', '비워 두면 이메일 @ 앞부분');
});

test('가입 → 바로 로그인 · 계정 칩 = 닉네임 · 조직 member · 코드의 스페이스에 들어가 있다', async () => {
  const email = uniqueEmail('invited');
  await win.getByRole('textbox', { name: '이메일' }).fill(email);
  await win.getByRole('textbox', { name: '닉네임' }).fill('새로 온 사람');
  await win.getByRole('textbox', { name: '비밀번호' }).fill(PASSWORD);
  await win.getByRole('button', { name: '가입하기' }).click();
  await expectHeading(win, HOME_H1);
  await expect(win.locator('.account-chip')).toContainText('새로 온 사람');
  // 스페이스 전환기: 내 스페이스(지금) + 참여한 스페이스에 코드의 스페이스
  await win.locator('.space-switch').click();
  const menu = win.getByRole('menu', { name: '스페이스 바꾸기' });
  await expect(menu.getByRole('menuitemradio', { name: /^내 스페이스/ })).toHaveAttribute('aria-checked', 'true');
  await expect(menu.getByRole('menuitemradio', { name: new RegExp(`^${space.name}`) })).toBeVisible();
  await win.screenshot({ path: shot('desktop-invite-joined') });
  await win.keyboard.press('Escape');

  const me = await userApi({ email, password: PASSWORD });
  const who = await me.get<{ display_name: string; orgs: { name: string; role: string }[]; instance_role: string }>('/api/me');
  expect(who).toMatchObject({ display_name: '새로 온 사람', instance_role: 'user', orgs: [{ name: '우리 팀', role: 'member' }] });
  const { spaces } = await me.get<{ spaces: { id: string; kind: string; role: string | null }[] }>('/api/spaces');
  expect(spaces.map((s) => s.kind)).toEqual(['personal', 'shared']);
  expect(spaces[1]).toMatchObject({ id: space.id, role: 'member' });
});

test('1명용 코드는 한 번 쓰면 끝 · 관리자 목록에 "다 씀"', async () => {
  const preview = await fetch(`${API}/api/auth/invite/preview`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }),
  });
  expect(preview.status).toBe(404);
  expect(await preview.json()).toEqual({ detail: 'invite_invalid' });
  const invites = await admin.get<{ spaces: { name: string }[]; status: string; uses: number }[]>('/api/admin/invites');
  expect(invites.find((i) => i.spaces.some((s) => s.name === space.name))).toMatchObject({ status: 'used_up', uses: 1 });
});
