import { test, expect, type Page } from '@playwright/test';
import { adminApi, type Client } from './auth';
import { separatorsOnScreen } from './copy-rule';
import { ADMIN_URL, MCP } from './env';
import { shot } from './helpers';
import { NOTES_URL, ensureTracker, type AdminServer } from './mcp';

// 관리자 '카탈로그 › MCP 서버' 의 서버 아이콘 = 서비스 사이트 그림 (conductor 가 받아 캐시 · connectors/icons.py) · 없으면 첫 글자.
// 가짜 MCP(e2e/mock/mcp.mjs) /favicon.ico = 진짜 사이트 대신 (바깥으로 안 나간다) · Host localhost = 아이콘 없음.
// 표 이름 칸 · 자세히 페이지 머리 · 서버 추가의 추천 서버 줄. 넣은 서버는 끝에 지운다
const WITH = { url: `${NOTES_URL}?team=admin-icons`, name: 'E2E 아이콘 메모' };
const WITHOUT = { url: `http://localhost:${new URL(MCP).port}/noauth/mcp?team=admin-icons`, name: 'E2E 아이콘 없음' };

const table = (page: Page) => page.getByRole('table', { name: 'MCP 서버 목록' });
const rowOf = (page: Page, name: string) => table(page).getByRole('row').filter({ hasText: name });
let admin: Client;
let made: AdminServer[] = [];

test.beforeAll(async () => {
  admin = await adminApi();
  for (const s of await admin.get<AdminServer[]>('/api/admin/mcp/servers')) {
    if (s.name === WITH.name || s.name === WITHOUT.name) await admin.del(`/api/admin/mcp/servers/${s.id}`);
  }
  await ensureTracker(admin);
  made = [await admin.post<AdminServer>('/api/admin/mcp/servers', WITH), await admin.post<AdminServer>('/api/admin/mcp/servers', WITHOUT)];
});
test.afterAll(async () => {
  for (const s of made) await admin.del(`/api/admin/mcp/servers/${s.id}`);
});

test('MCP 서버 표: 이름 칸에 서비스 아이콘 · 아이콘 없는 사이트 = 첫 글자 · 자세히 머리 · 추천 서버 줄', async ({ page }) => {
  const outside: string[] = [];
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(ADMIN_URL) && !u.startsWith('data:')) outside.push(u); // 콘솔은 같은 출처(/api 프록시)만
  });
  await page.goto('/#/catalog');
  await expect(rowOf(page, WITH.name)).toHaveCount(1);
  await expect(rowOf(page, WITH.name).locator('.mcp-icon img')).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect(rowOf(page, WITHOUT.name).locator('.mcp-icon img')).toHaveCount(0);
  await expect(rowOf(page, WITHOUT.name).locator('.mcp-icon')).toHaveText('E');
  await expect(rowOf(page, WITH.name).getByRole('rowheader')).toContainText(WITH.name);
  expect(await separatorsOnScreen(page)).toEqual([]);
  await page.screenshot({ path: shot('admin-mcp-icons') });

  // 자세히 페이지 머리 (아이콘은 h1 밖 = 제목 글 그대로)
  await rowOf(page, WITH.name).getByRole('link', { name: WITH.name }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText([WITH.name]);
  await expect(page.locator('.mcp-head .mcp-icon img')).toHaveAttribute('src', /^data:image\/png/);
  await page.screenshot({ path: shot('admin-mcp-icon-page') });

  // 추천 서버 = 쓸 수 있는 것만 그림 (못 쓰는 키 전용 = 받지 않고 첫 글자)
  await page.goto('/#/catalog');
  await page.getByRole('button', { name: 'MCP 서버 추가' }).first().click();
  const list = page.getByRole('dialog', { name: 'MCP 서버 추가' }).getByRole('list', { name: '추천 서버 목록' });
  await expect(list.locator('.mcp-preset').filter({ hasText: 'E2E 추천 메모' }).locator('.mcp-icon img')).toHaveAttribute('src', /^data:image\/png/);
  await expect(list.locator('.mcp-preset').filter({ hasText: 'E2E 키 전용' }).locator('.mcp-icon img')).toHaveCount(0);
  await page.screenshot({ path: shot('admin-mcp-presets-icons') });
  expect(outside).toEqual([]);
});
