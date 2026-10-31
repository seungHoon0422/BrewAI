import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { optionsOf, overflowX, shot } from './helpers';

// UI 부품 모음 (#/ui · ADR-0012) = @brewai/ui 토큰 · 부품 전부를 라이트 · 다크로 나란히. 다시 그릴 때 여기서 먼저 본다.
// 관리자 개발 서버에만 있다 (빌드본에선 빠짐 = 메뉴 · 사용자 계약 밖). 로그인 문 밖이라 로그인 없이 열린다
const SECTIONS = ['색', '글자', '둥글기, 그림자, 유리', '버튼', '입력', '고르기', '배지, 점, 아바타', '카드, 알림, 빈 상태', '표', '떠 있는 층', '길 찾기', '아이콘', '기다림'];

test('라이트 · 다크 두 줄에 모든 부분이 그려진다 · 오류 없음 · 가로로 넘치지 않는다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/#/ui');
  await expect(page.locator('.gal-top').getByRole('heading', { level: 1 })).toHaveText('UI 부품'); // 칸 안의 PageHeader 예시도 h1 이라 머리에서만
  const cols = page.locator('[data-gallery-theme]');
  await expect(cols).toHaveCount(2);
  expect(await cols.evaluateAll((els) => els.map((e) => e.getAttribute('data-theme')))).toEqual(['light', 'dark']);
  for (const col of [cols.nth(0), cols.nth(1)]) {
    await expect(col.locator('.gal-sec > h2')).toHaveText(SECTIONS);
  }
  // 다크 칸은 진짜 다크 토큰 (바탕이 라이트와 다르다)
  const bg = await cols.evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
  expect(bg[0]).not.toBe(bg[1]);
  await expect.poll(() => overflowX(page)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: shot('ui-gallery'), fullPage: true });
  expect(errors).toEqual([]);
});

test('테마 하나만 보기 · 관리자 콘솔로 돌아가는 링크', async ({ page }) => {
  await page.goto('/#/ui');
  const theme = page.getByRole('radiogroup', { name: '테마' });
  await theme.getByRole('radio', { name: '다크' }).click();
  await expect(page.locator('[data-gallery-theme]')).toHaveCount(1);
  await expect(page.locator('[data-gallery-theme]')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: shot('ui-gallery-dark'), fullPage: true });
  await theme.getByRole('radio', { name: '둘 다' }).click();
  await expect(page.locator('[data-gallery-theme]')).toHaveCount(2);
  await expect(page.getByRole('link', { name: '관리자 콘솔로' })).toHaveAttribute('href', '#/overview');
});

test('아이콘 = 부품의 아이콘 이름 전부 (빠진 그림 없음)', async ({ page }) => {
  // 기대값 = 소스 packages/ui/src/icons.tsx 의 PATHS 키 (하드코딩 아님 · 같은 순서)
  const src = fs.readFileSync(path.join(__dirname, '..', 'packages', 'ui', 'src', 'icons.tsx'), 'utf8');
  const start = src.indexOf('const PATHS = {');
  const names = [...src.slice(start, src.indexOf('\n};', start)).matchAll(/^ {2}'?([a-z0-9-]+)'?:/gm)].map((m) => m[1]);
  expect(names.length).toBeGreaterThan(10);
  await page.goto('/#/ui');
  const icons = page.locator('[data-gallery-theme="light"] .gal-icons').first().locator('.gal-icon');
  await expect(icons.locator('code')).toHaveText(names);
  // 빈 그림 없음 (path · 도형이 하나 이상)
  expect(await icons.locator('svg').evaluateAll((els) => els.filter((e) => e.querySelector('path, circle, rect, line, polyline, polygon, ellipse') === null).length)).toBe(0);
});

test('다크 값 두 덩어리(OS 다크 · data-theme="dark")가 같다 — 하나만 고치고 잊지 않게', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'packages', 'ui', 'src', 'styles', 'tokens.css'), 'utf8');
  const decls = (selector: string) => {
    const start = css.indexOf('{', css.indexOf(selector)) + 1;
    const body = css.slice(start, css.indexOf('}', start));
    return Object.fromEntries([...body.matchAll(/(--[\w-]+|color-scheme)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  };
  const os = decls(':root:not([data-theme="light"]){');
  const forced = decls('\n[data-theme="dark"]{');
  expect(Object.keys(os).length).toBeGreaterThan(20);
  expect(forced).toEqual(os);
});

test('고르기 상자 (공용 Select): 최상위 층 목록 · 꺼진 줄은 건너뛴다 · 화면 아래 끝이면 위로 · 대화상자 안에서도 위에 · Esc 는 목록만 닫는다', async ({ page }) => {
  await page.goto('/#/ui');
  await expect(page.locator('select')).toHaveCount(0); // 브라우저 기본 고르기 상자 없음
  const col = page.locator('[data-gallery-theme="light"]');
  const box = col.getByRole('combobox', { name: '제공사' });
  await box.click();
  const opts = await optionsOf(box);
  await expect(opts).toHaveCount(7);
  const list = page.locator(`[id="${await box.getAttribute('aria-controls')}"]`);
  await expect(list).toHaveAttribute('role', 'listbox');
  expect(await list.evaluate((el) => el.matches(':popover-open'))).toBe(true);
  await expect(box).toBeFocused(); // 포커스는 단추에
  await page.keyboard.press('End'); // 마지막 줄 = 꺼짐 → 그 앞에서 멈춘다
  await expect(opts.nth(6)).toHaveAttribute('aria-disabled', 'true');
  await expect(opts.nth(5)).toHaveAttribute('data-active', '');
  await opts.nth(6).click({ force: true }); // 꺼진 줄은 눌러도 안 골라진다 (aria-disabled = Playwright 도 꺼짐으로 본다)
  await expect(box).toHaveAttribute('data-value', 'all');
  const fifth = (await opts.nth(5).getAttribute('data-value'))!;
  await page.keyboard.press('Enter');
  await expect(box).toHaveAttribute('data-value', fifth);
  await expect(box).toHaveAttribute('aria-expanded', 'false');
  await expect(col.getByRole('combobox', { name: '꺼진 고르기' })).toBeDisabled();

  // 화면 아래 끝 = 위로 연다 (잘리지 않게)
  const small = col.getByRole('combobox', { name: '기간' });
  await small.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().bottom - window.innerHeight + 12));
  await small.click();
  const up = page.locator(`[id="${await small.getAttribute('aria-controls')}"]`);
  await expect(up).toHaveAttribute('data-side', 'top');
  const top = (await small.boundingBox())!.y;
  await expect.poll(async () => { const l = (await up.boundingBox())!; return l.y + l.height; }).toBeLessThanOrEqual(top); // 열림 움직임이 끝나면
  await page.keyboard.press('Escape');

  // 대화상자 안: 목록이 대화상자 위에 뜬다 · Esc = 목록만 닫고 대화상자는 그대로
  await col.getByRole('button', { name: '대화상자', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '스페이스 나가기' });
  const inDialog = dialog.getByRole('combobox', { name: '옮길 곳' });
  await inDialog.click();
  const dlist = page.locator(`[id="${await inDialog.getAttribute('aria-controls')}"]`);
  await expect(dlist).toBeVisible();
  const topmost = await dlist.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  });
  expect(topmost).toBe(true);
  await page.screenshot({ path: shot('ui-gallery-select-dialog') });
  await page.keyboard.press('Escape');
  await expect(dlist).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
