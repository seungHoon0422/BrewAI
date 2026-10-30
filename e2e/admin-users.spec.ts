import { test, expect, type Page } from '@playwright/test';
import { login, poolEmail, poolUser } from './auth';
import { ADMIN_USER, API, PASSWORD } from './env';
import { overflowX, shot } from './helpers';

// 관리자 '사용자·조직' (slice 04): 탭 넷 = 사용자 · 조직 · 스페이스 · 초대. 가입은 초대 코드로만 · 코드는 만든 직후 한 번만 보인다.
// 비활성화 = 모든 세션 폐기 + 로그인 불가 · 재설정 코드(bwp_) = 메일 서버 없이 관리자가 전한다.
// 바꾸는 사람 = '비활성 대상' (auth.ts POOL disabled) 만
const ORG = `E2E 조직 ${Date.now().toString(36)}`;

const tabs = (page: Page) => page.getByRole('tablist', { name: '사용자·조직 탭' });
const people = (page: Page) => page.getByRole('table', { name: '사용자 목록' });
const personRow = (page: Page, email: string) => people(page).getByRole('row').filter({ hasText: email });
const sheet = (page: Page, email: string) => page.getByRole('dialog').filter({ hasText: email });
const toast = (page: Page, text: string | RegExp) => page.getByRole('region', { name: '알림' }).getByText(text);
const post = (pathname: string, body: unknown) =>
  fetch(`${API}${pathname}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const tryLogin = (email: string, password: string) => post('/api/auth/login', { email, password });

test('사용자 탭: 나(관리자) · 테스트 사용자 · 로그인 방법 · 조직 · 검색', async ({ page }) => {
  await page.goto('/#/users');
  await expect(tabs(page).getByRole('tab', { name: '사용자' })).toHaveAttribute('aria-selected', 'true');
  const me = personRow(page, ADMIN_USER.email);
  await expect(me).toContainText('나');
  await expect(me).toContainText('관리자');
  const member = personRow(page, poolEmail('member'));
  await expect(member).toContainText('일반 멤버');
  await expect(member).toContainText('우리 팀 · 멤버');
  await expect(member).toContainText('비밀번호');
  await page.getByRole('searchbox', { name: '닉네임 · 이메일 검색' }).fill('일반 멤버');
  await expect(people(page).locator('tbody tr')).toHaveCount(1);
  await expect(page.getByText('1명', { exact: true })).toBeVisible();
  await page.screenshot({ path: shot('admin-users-people'), fullPage: true });
});

test('조직 만들기 → 그 조직 초대 코드 (한 번만 보임) → 데스크톱 미리보기 = 그 조직 → 취소하면 못 쓴다', async ({ page }) => {
  await page.goto('/#/users/orgs');
  await expect(tabs(page).getByRole('tab', { name: '조직' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: '조직 만들기' }).click();
  const create = page.getByRole('dialog', { name: '조직 만들기' });
  await create.getByRole('textbox', { name: '이름' }).fill(ORG);
  await create.getByRole('button', { name: '만들기' }).click();
  await expect(toast(page, `${ORG}을(를) 만들었어요`)).toBeVisible();
  const orgRow = page.getByRole('table', { name: '조직 목록' }).getByRole('row').filter({ hasText: ORG });
  await expect(orgRow).toContainText('초대 코드만');
  await page.screenshot({ path: shot('admin-users-orgs'), fullPage: true });

  await tabs(page).getByRole('tab', { name: '초대' }).click();
  await expect(page).toHaveURL(/#\/users\/invites$/);
  await page.getByRole('button', { name: '초대 코드 만들기' }).click();
  const form = page.getByRole('dialog', { name: '초대 코드 만들기' });
  await form.getByRole('combobox', { name: '조직' }).selectOption({ label: ORG }); // 조직이 둘 이상이면 고른다
  await expect(form.getByText('이 조직에 공유 스페이스가 아직 없어요.')).toBeVisible();
  await form.getByRole('button', { name: '코드 만들기' }).click();
  const result = page.getByRole('dialog', { name: '초대 코드를 만들었어요' });
  const code = (await result.getByLabel('초대 코드').textContent())!.trim();
  expect(code).toMatch(/^BREW-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  await expect(result).toContainText(`${ORG} · 멤버 · 1명까지`);
  await expect(result).toContainText('이 창을 닫으면 다시 볼 수 없어요');
  await page.screenshot({ path: shot('admin-invite-code') });
  await result.getByRole('button', { name: '닫기' }).first().click();

  const invites = page.getByRole('table', { name: '초대 코드 목록' });
  const row = invites.getByRole('row').filter({ hasText: ORG });
  await expect(row).toContainText('사용 가능');
  await expect(invites).not.toContainText(code); // 목록엔 코드가 없다 (서버는 sha256 만)
  // 데스크톱 가입 화면이 보는 미리보기 = 그 조직 · 초대한 사람(닉네임)
  const preview = await post('/api/auth/invite/preview', { code });
  expect(await preview.json()).toMatchObject({ org: { name: ORG }, inviter_name: ADMIN_USER.name, org_role: 'member', spaces: [] });

  await row.getByRole('button', { name: `${ORG} 초대 코드 취소` }).click();
  await page.getByRole('dialog', { name: '이 초대 코드를 취소할까요?' }).getByRole('button', { name: '코드 취소' }).click();
  await expect(toast(page, '초대 코드를 취소했어요')).toBeVisible();
  expect((await post('/api/auth/invite/preview', { code })).status).toBe(404);
});

test('스페이스 탭: 공유 스페이스는 이름 · 숫자만 · 내 스페이스는 개수만', async ({ page }) => {
  await page.goto('/#/users/spaces');
  await expect(page.getByRole('table', { name: '공유 스페이스 목록' })).toBeVisible();
  const panel = page.getByRole('tabpanel', { name: '스페이스' });
  await expect(panel).toContainText(/내 스페이스\(개인\) \d+개는 목록에 없어요/);
  await expect(panel).toContainText('관리자 콘솔은 대화 제목 · 내용을 보여 주지 않아요.');
});

test.describe('한 사람 관리', () => {
  test.describe.configure({ mode: 'serial' });
  const email = poolEmail('disabled');
  let password = PASSWORD;

  test('비활성화 → 그 사람의 세션이 끊기고 로그인할 수 없다 → 다시 활성화하면 된다', async ({ page }) => {
    const user = await poolUser('disabled');
    const session = await login(user);
    await page.goto('/#/users');
    await personRow(page, email).getByRole('button', { name: user.display_name }).click();
    const s = sheet(page, email);
    await expect(s).toContainText('로그인한 기기');
    await s.getByRole('button', { name: '비활성화' }).click();
    await page.getByRole('dialog', { name: `${user.display_name} 님을 비활성화할까요?` }).getByRole('button', { name: '비활성화' }).click();
    await expect(toast(page, `${user.display_name} 님을 비활성화했어요`)).toBeVisible();
    await expect(s).toContainText('비활성 계정은 로그인할 수 없어요');
    await expect(personRow(page, email)).toContainText('비활성');
    await page.screenshot({ path: shot('admin-user-disabled') });

    const denied = await tryLogin(email, password);
    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual({ detail: 'invalid_credentials' }); // 비활성이라고 알려 주지 않는다 (열거 방지)
    expect((await fetch(`${API}/api/me`, { headers: { authorization: `Bearer ${session.access_token}` } })).status).toBe(401);

    await s.getByRole('button', { name: '다시 활성화' }).click();
    await expect(toast(page, `${user.display_name} 님을 다시 활성화했어요`)).toBeVisible();
    expect((await tryLogin(email, password)).status).toBe(200);
  });

  test('재설정 코드: 한 번 보임 → 그 코드로 새 비밀번호 → 옛 비밀번호는 안 된다 · 코드는 한 번만', async ({ page }) => {
    const user = await poolUser('disabled');
    await page.goto('/#/users');
    await personRow(page, email).getByRole('button', { name: user.display_name }).click();
    const s = sheet(page, email);
    await s.getByRole('button', { name: '재설정 코드 만들기' }).click();
    const code = (await s.getByLabel('비밀번호 재설정 코드').textContent())!.trim();
    expect(code).toMatch(/^bwp_/);
    await expect(s).toContainText('한 번만 쓸 수 있어요');
    await page.screenshot({ path: shot('admin-user-reset-code') });

    const next = 'reset by the admin console';
    expect((await post('/api/auth/reset', { code, password: next })).status).toBe(204);
    expect((await tryLogin(email, password)).status).toBe(401);
    expect((await tryLogin(email, next)).status).toBe(200);
    password = next;
    expect((await post('/api/auth/reset', { code, password: 'and once more please' })).status).toBe(404);
  });

  test('내 계정은 비활성화 · 관리자 권한 빼기를 못 한다', async ({ page }) => {
    await page.goto('/#/users');
    await personRow(page, ADMIN_USER.email).getByRole('button', { name: ADMIN_USER.name }).click();
    const s = sheet(page, ADMIN_USER.email);
    await expect(s.getByRole('button', { name: '비활성화' })).toBeDisabled();
    await expect(s.getByRole('switch', { name: '관리자 콘솔 권한' })).toBeDisabled();
    await expect(s).toContainText('내 계정은 여기서 비활성화하거나 관리자 권한을 뺄 수 없어요.');
  });
});

test.describe('폰 폭 390px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('사용자·조직 탭 넷 어느 것도 가로로 넘치지 않는다', async ({ page }) => {
    for (const tab of ['', '/orgs', '/spaces', '/invites']) {
      await page.goto(`/#/users${tab}`);
      await expect(tabs(page)).toBeVisible();
      await expect.poll(() => overflowX(page), { message: tab || 'people' }).toBeLessThanOrEqual(0);
    }
    await page.screenshot({ path: shot('admin-users-phone'), fullPage: true });
  });
});
