import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

// 메뉴 계약 한 칸: 링크 이름 · 해시 경로(#/id) · 화면 h1 (없으면 링크 이름)
export type MenuItem = { id: string; label: string; h1?: string };

// 스크린샷은 test-results/shots/ 에 모은다 (실행마다 새로 만든다)
export function shot(name: string) {
  return path.join(test.info().project.outputDir, 'shots', `${name}.png`);
}

function nav(page: Page, name: string) {
  return page.getByRole('navigation', { name, exact: true });
}

function link(page: Page, navName: string, item: MenuItem) {
  return nav(page, navName).getByRole('link', { name: item.label, exact: true });
}

// 메뉴 링크가 계약과 같은 이름·순서·주소인지 (하나라도 더 있거나 빠지면 실패)
export async function expectMenu(page: Page, navName: string, menu: MenuItem[]) {
  const links = nav(page, navName).getByRole('link');
  await expect(links).toHaveCount(menu.length);
  for (const [i, item] of menu.entries()) {
    await expect(links.nth(i)).toHaveAccessibleName(item.label);
    await expect(links.nth(i)).toHaveAttribute('href', `#/${item.id}`);
  }
}

// 배열로 비교 = h1 이 딱 하나이고 글이 같다
export async function expectHeading(page: Page, text: string) {
  await expect(page.getByRole('heading', { level: 1 })).toHaveText([text]);
}

// 지금 화면이 item 인지: h1 + 그 링크에만 aria-current="page"
export async function expectScreen(page: Page, navName: string, item: MenuItem) {
  await expectHeading(page, item.h1 ?? item.label);
  await expect(link(page, navName, item)).toHaveAttribute('aria-current', 'page');
  await expect(nav(page, navName).locator('[aria-current="page"]')).toHaveCount(1);
}

// 메뉴를 눌러 그 화면으로 간다 (주소도 #/id 로 바뀐다)
export async function openMenu(page: Page, navName: string, item: MenuItem) {
  await link(page, navName, item).click();
  await expect(page).toHaveURL(new RegExp(`#/${item.id}$`));
  await expectScreen(page, navName, item);
}

// 해시만 바꾼다 (새로 고침 없음)
export async function goHash(page: Page, hash: string) {
  await page.evaluate((h) => { location.hash = h; }, hash);
}

// 가로로 넘친 px. 0 이하 = 가로 스크롤 없음
export function overflowX(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}
