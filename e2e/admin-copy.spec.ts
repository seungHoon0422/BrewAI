import { test, expect, type Page } from '@playwright/test';
import { separatorsInCopy, separatorsOnScreen } from './copy-rule';

// UI 문구 규칙 (AGENTS.md): 가운뎃점(·) 구분자 없음 — 칸 나눔(여백) 또는 쉼표.
// 위 = 문구 파일 (copy.ts 전부 · 앱 없이) · 아래 = 관리자 콘솔 주요 화면에 그려진 글 · 속성. 데스크톱 화면은 chat-copy.spec.ts
const h1 = (page: Page) => page.getByRole('heading', { level: 1 });

test('copy.ts 문구에 가운뎃점 구분자가 없다 (주석은 빼고)', () => {
  expect(separatorsInCopy()).toEqual([]);
});

test('관리자 화면에 가운뎃점이 없다: 개요 · 모델 목록 · 모델 추가 · 모델 자세히 · 사용자 탭 넷 · 카탈로그', async ({ page }) => {
  const look = async (hash: string, ready: () => Promise<void>) => {
    await page.goto(`/#/${hash}`);
    await ready();
    expect(await separatorsOnScreen(page), hash).toEqual([]);
  };
  const gateway = page.locator('.stat').filter({ has: page.locator('dt', { hasText: /^게이트웨이$/ }) });
  await look('overview', () => expect(gateway.locator('.v')).toHaveText('연결됨'));
  await look('models', () => expect(page.getByRole('table', { name: '모델 목록' }).locator('tbody tr[data-model="fake-chat-small"]')).toBeVisible());
  await look('models/add', () => expect(h1(page)).toBeVisible());
  await look('models/fake-chat-small', () => expect(page.locator('.mhead')).toBeVisible());
  await look('users', () => expect(page.getByRole('table', { name: '사용자 목록' }).getByRole('row').nth(1)).toBeVisible());
  for (const tab of ['orgs', 'spaces', 'invites']) await look(`users/${tab}`, () => expect(page.getByRole('tabpanel')).toBeVisible());
  await look('catalog', () => expect(page.getByRole('tabpanel')).toBeVisible());
  await page.getByRole('tab', { name: 'Skill', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Skill 목록' }).locator('tbody tr').first()).toBeVisible();
  expect(await separatorsOnScreen(page), 'catalog/skill').toEqual([]);
});
