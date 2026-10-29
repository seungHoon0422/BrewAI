import { test, expect, type Page } from '@playwright/test';
import { API } from './env';
import { shot } from './helpers';

// 관리자 '모델' 표 = conductor GET /api/admin/models = mock 게이트웨이 /model_group/info (읽기 전용, ADR-0006)
const COLS = ['표시 이름', '게이트웨이 ID', '상태', '순서'];
const table = (page: Page) => page.getByRole('table', { name: '모델 목록' });

test('mock 게이트웨이 모델이 표에 뜬다 (채팅 = 노출 · 순서, 임베딩 = 숨김)', async ({ page }) => {
  await page.goto('/#/models');
  await expect(table(page).getByRole('columnheader')).toHaveText(COLS);
  const rows = table(page).locator('tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).getByRole('cell')).toHaveText(['fake-chat-small', 'fake-chat-small', '노출', '1']);
  await expect(rows.nth(1).getByRole('cell')).toHaveText(['fake-chat-large', 'fake-chat-large', '노출', '2']);
  await expect(rows.nth(2).getByRole('cell')).toHaveText(['fake-embed', 'fake-embed', '숨김', '—']);
  await expect(page.locator('.legend')).toContainText('노출 2');
  await expect(page.locator('.legend')).toContainText('숨김 1');
  await page.screenshot({ path: shot('admin-models-live'), fullPage: true });
});

test('conductor 가 꺼져 있으면 안내 → 다시 시도로 회복', async ({ page }) => {
  await page.route(`${API}/**`, (r) => r.abort('connectionrefused'));
  await page.goto('/#/models');
  await expect(page.getByRole('alert')).toContainText('conductor 에 연결할 수 없어요');
  await page.unroute(`${API}/**`);
  await page.getByRole('button', { name: '다시 시도' }).click();
  await expect(table(page).locator('tbody tr')).toHaveCount(3);
});

test('게이트웨이가 꺼져 있으면 (conductor 503) 게이트웨이 안내', async ({ page }) => {
  await page.route(`${API}/api/admin/models`, (r) =>
    r.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"gateway_unreachable"}' }));
  await page.goto('/#/models');
  await expect(page.getByRole('alert')).toContainText('게이트웨이에 연결할 수 없어요');
  await expect(page.locator('.legend')).toContainText('노출 —'); // 오류일 땐 0 이 아니라 —
});

test('게이트웨이가 떠 있는데 오류를 내면 (conductor 502) "꺼짐" 이 아니라 오류 안내', async ({ page }) => {
  await page.route(`${API}/api/admin/models`, (r) =>
    r.fulfill({ status: 502, contentType: 'application/json', body: '{"detail":"gateway_error"}' }));
  await page.goto('/#/models');
  await expect(page.getByRole('alert')).toContainText('게이트웨이가 오류를 냈어요');
  await page.goto('/#/overview');
  await expect(gatewayCard(page).locator('.v')).toHaveText('오류');
});

test('게이트웨이에 모델이 0개면 빈 표 안내', async ({ page }) => {
  await page.route(`${API}/api/admin/models`, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto('/#/models');
  await expect(table(page)).toContainText('게이트웨이에 모델이 없어요');
});

// 개요 '게이트웨이' 카드 = 같은 API 의 실제 결과 (예전엔 '미연결' 고정 글)
const card = (page: Page, label: string) => page.locator('.stat').filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) });
const gatewayCard = (page: Page) => card(page, '게이트웨이');
const exposedCard = (page: Page) => card(page, '노출 모델');

test('개요: 게이트웨이 연결됨 · 노출 모델 수', async ({ page }) => {
  await page.goto('/#/overview');
  await expect(gatewayCard(page)).toHaveAttribute('data-state', 'ok');
  await expect(gatewayCard(page).locator('.v')).toHaveText('연결됨');
  await expect(gatewayCard(page).locator('.sub')).toHaveText('LiteLLM · 모델 3개');
  await expect(exposedCard(page).locator('.v')).toHaveText('2');
  await expect(exposedCard(page).locator('.sub')).toHaveText('후보 0 · 숨김 1');
  await page.screenshot({ path: shot('admin-overview-live'), fullPage: true });
});

test('개요: conductor · 게이트웨이가 꺼지면 카드가 그렇게 말한다', async ({ page }) => {
  await page.route(`${API}/**`, (r) => r.abort('connectionrefused'));
  await page.goto('/#/overview');
  await expect(gatewayCard(page)).toHaveAttribute('data-state', 'error');
  await expect(gatewayCard(page).locator('.v')).toHaveText('conductor 꺼짐');
  await page.unroute(`${API}/**`);
  await page.route(`${API}/api/admin/models`, (r) =>
    r.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"gateway_unreachable"}' }));
  await page.reload();
  await expect(gatewayCard(page).locator('.v')).toHaveText('꺼짐');
  await expect(gatewayCard(page).locator('.sub')).toContainText('npm run gateway');
  await expect(exposedCard(page).locator('.v')).toHaveText('—');
});
