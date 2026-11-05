import { test, expect, type Page } from '@playwright/test';
import { adminApi, poolUser, userApi } from './auth';
import { API } from './env';
import { shot } from './helpers';

// 관리자 › 사용자와 조직 › API 키 (slice 12 · ADR-0017): 정책 (허용 · 만료 · 기본 한도) · 전체 키 표 (값 없이 hint 만) ·
// 키마다 한도 → 바로 /v1 에 적용 (429) · 강제 폐기 → 401. 정책은 테스트 끝에 기본값으로 되돌린다 (다른 스펙이 같은 conductor 를 쓴다)
const NAME = `관리자 확인 키 ${Date.now().toString(36)}`;
const tabs = (page: Page) => page.getByRole('tablist', { name: '사용자와 조직 탭' });
const table = (page: Page) => page.getByRole('table', { name: '전체 API 키' });
const row = (page: Page) => table(page).getByRole('row').filter({ hasText: NAME });
const toast = (page: Page, text: string | RegExp) => page.getByRole('region', { name: '알림' }).getByText(text);
const v1 = (key: string, path: string, body?: unknown) =>
  fetch(`${API}/v1${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${key}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
const DEFAULT_POLICY = { enabled: true, default_days: 90, max_days: 365, limits: { rpm: 60, tokens_per_day: 1_000_000, usd_per_month: 20 } };

test.describe.configure({ mode: 'serial' });
let key = '';
test.beforeAll(async () => {
  const bob = await userApi(await poolUser('bob'));
  key = (await bob.post<{ key: string }>('/api/me/keys', { name: NAME, scopes: ['models:read', 'chat'] })).key;
});
test.afterAll(async () => {
  await (await adminApi()).patch('/api/admin/keys/policy', DEFAULT_POLICY);
});

test('API 키 탭: 정책 카드 (기본 한도) · 전체 키 표 = 사용자 · 이름 · hint (값 없음)', async ({ page }) => {
  await page.goto('/#/users/keys');
  await expect(tabs(page).getByRole('tab', { name: 'API 키' })).toHaveAttribute('aria-selected', 'true');
  const policy = page.getByRole('region', { name: '정책' });
  await expect(policy.getByRole('switch', { name: '사용자 API 키 허용' })).toHaveAttribute('aria-checked', 'true');
  await expect(policy.getByRole('textbox', { name: '분당 요청' })).toHaveValue('60');
  await expect(row(page)).toContainText(`bwk_${key.slice(4, 8)}…${key.slice(-4)}`);
  await expect(row(page)).toContainText('사용 중');
  await expect(page.locator('body')).not.toContainText(key);
  await page.screenshot({ path: shot('admin-keys'), fullPage: true });
});

test('키마다 한도 → 바로 적용 (분당 1 → 두 번째 429) · 정책 기본값으로 되돌리기', async ({ page }) => {
  await page.goto('/#/users/keys');
  await row(page).getByRole('button', { name: `한도 바꾸기 ${NAME}` }).click();
  const dialog = page.getByRole('dialog', { name: `'${NAME}' 키 한도` });
  await dialog.getByRole('textbox', { name: '분당 요청' }).fill('1');
  await dialog.getByRole('button', { name: '저장' }).click();
  await expect(toast(page, `한도를 바꿨어요: ${NAME}`)).toBeVisible();
  await expect(row(page)).toContainText('따로 정함');
  const body = { model: 'fake-chat-small', messages: [{ role: 'user', content: '한도 확인' }] };
  expect((await v1(key, '/chat/completions', body)).status).toBe(200);
  const second = await v1(key, '/chat/completions', body);
  expect(second.status).toBe(429);
  expect(((await second.json()) as { error: { code: string } }).error.code).toBe('key_limit_rpm');
  await row(page).getByRole('button', { name: `한도 바꾸기 ${NAME}` }).click();
  await page.getByRole('dialog', { name: `'${NAME}' 키 한도` }).getByRole('button', { name: '정책 기본값으로' }).click();
  await expect(row(page)).not.toContainText('따로 정함');
});

test('정책: 끄면 /v1 이 403 api_keys_off · 다시 켜기 · 강제 폐기 → 401', async ({ page }) => {
  await page.goto('/#/users/keys');
  const sw = page.getByRole('region', { name: '정책' }).getByRole('switch', { name: '사용자 API 키 허용' });
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  const off = await v1(key, '/models');
  expect(off.status).toBe(403);
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  expect((await v1(key, '/models')).status).toBe(200);
  await row(page).getByRole('button', { name: `폐기 ${NAME}` }).click();
  await page.getByRole('dialog', { name: /폐기할까요/ }).getByRole('button', { name: '폐기' }).click();
  await expect(row(page)).toContainText('폐기');
  expect((await v1(key, '/models')).status).toBe(401);
});
