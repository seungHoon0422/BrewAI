import { expect, test, type Locator, type Page } from '@playwright/test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
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
// 공용 고르기 상자 (@brewai/ui Select = combobox 단추 + 최상위 층 listbox). 브라우저 select 가 아니라 selectOption 대신 이것.
// 값(data-value) 또는 보이는 이름(줄 이름 칸 · 오른쪽 옅은 글 빼고)으로 고른다 → 목록이 닫힐 때까지 기다린다
export const optionsOf = async (box: Locator) => {
  const id = await box.getAttribute('aria-controls');
  return box.page().locator(`[id="${id}"]`).getByRole('option');
};
export async function pickOption(box: Locator, pick: { value: string } | { label: string }) {
  if ((await box.getAttribute('aria-expanded')) !== 'true') await box.click();
  const options = await optionsOf(box);
  const option = 'value' in pick
    ? options.and(box.page().locator(`[data-value="${pick.value}"]`))
    : options.filter({ has: box.page().locator('.ui-select-opt-label').getByText(pick.label, { exact: true }) });
  await option.click();
  await expect(box).toHaveAttribute('aria-expanded', 'false');
}
// 단추에 보이는 이름 (숨은 너비 잡이 글은 빼고)
export const pickedText = (box: Locator) => box.locator('.ui-select-text');

export function overflowX(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

// 127.0.0.1 임시 포트의 중계 → target. close() = 연결 거부 (서버가 꺼진 것과 같다) · open() = 같은 포트로 다시 켬.
// 스트리밍(SSE)도 그대로 흘린다
export type Relay = { url: string; close: () => Promise<void>; open: () => Promise<void> };
export async function relay(target: string): Promise<Relay> {
  const to = new URL(target);
  const server = http.createServer((req, res) => {
    const up = http.request({ host: to.hostname, port: to.port, method: req.method, path: req.url, headers: { ...req.headers, host: to.host } }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on('error', () => res.destroy());
    req.pipe(up);
  });
  const listen = (port: number) => new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  await listen(0);
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        if (!server.listening) return resolve();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
    open: () => (server.listening ? Promise.resolve() : listen(port)),
  };
}
