import { test, expect } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { overflowX, shot } from './helpers';

// 웹 = 랜딩 + 다운로드만 (데스크톱 먼저). 정적 파일이라 서버 없이 file:// 로 연다
const LANDING = pathToFileURL(path.join(__dirname, '..', 'apps', 'web', 'index.html')).href;

test('랜딩에 OS별 다운로드 버튼이 있고, 이 PC 용이 앞에 온다', async ({ page }) => {
  await page.goto(LANDING);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  const mac = page.getByRole('button', { name: /macOS 용 받기/ });
  const win = page.getByRole('button', { name: /Windows 용 받기/ });
  await expect(mac).toBeVisible();
  await expect(win).toBeVisible();
  // 설치본 전까지는 누를 수 없다
  await expect(mac).toBeDisabled();
  await expect(win).toBeDisabled();

  const mine = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : null;
  if (mine) await expect(page.locator('.dl button').first()).toHaveAttribute('data-os', mine);

  await page.screenshot({ path: shot('web'), fullPage: true });
});

test.describe('폰 폭', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('가로 스크롤 없이 버튼이 한 줄씩 쌓인다', async ({ page }) => {
    await page.goto(LANDING);
    await expect.poll(() => overflowX(page)).toBeLessThanOrEqual(0);

    const buttons = page.locator('.dl button');
    const [a, b] = await Promise.all([buttons.nth(0).boundingBox(), buttons.nth(1).boundingBox()]);
    expect(b!.y).toBeGreaterThanOrEqual(a!.y + a!.height); // 두 번째 버튼이 첫 버튼 아래 줄

    await page.screenshot({ path: shot('web-phone'), fullPage: true });
  });
});
