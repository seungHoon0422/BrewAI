import { test, expect } from '@playwright/test';
import { expectHeading, expectMenu, expectScreen, goHash, openMenu, overflowX, shot, type MenuItem } from './helpers';

// 관리자 콘솔 = 사용자 앱과 따로 도는 SPA. 빌드본을 vite preview(4174)로 띄운다 (config webServer)
const NAV = '관리 메뉴';
const MENU: MenuItem[] = [
  { id: 'overview', label: '개요' },
  { id: 'models', label: '모델' },
  { id: 'catalog', label: '카탈로그' },
  { id: 'approvals', label: '승인 기록' },
  { id: 'traces', label: '트레이스' },
  { id: 'users', label: '사용자·예산' },
  { id: 'settings', label: '설정' },
];
const OVERVIEW = MENU[0];
const MODELS = MENU[1];
const SETTINGS = MENU[6];

// 모델 원본은 게이트웨이(LiteLLM). 관리자는 노출·표시 이름·순서만 정한다 (ADR-0006)
const GATEWAY_ONLY = /price|가격|단가|context|컨텍스트|provider|제공자|제공사|endpoint|엔드포인트/i;
const REGISTER = /모델 (추가|등록)|add model/i;

test('첫 화면은 개요, 탭 제목은 BrewAI 관리자', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('BrewAI 관리자');
  await expectScreen(page, NAV, OVERVIEW);
});

test('관리 메뉴가 계약 순서대로 있다', async ({ page }) => {
  await page.goto('/');
  await expectMenu(page, NAV, MENU);
});

test('메뉴를 누르면 그 화면이 뜬다', async ({ page }) => {
  await page.goto('/');
  for (const item of MENU) {
    await openMenu(page, NAV, item);
    await page.screenshot({ path: shot(`admin-${item.id}`), fullPage: true });
  }
});

test('빈 주소·모르는 주소·사용자 앱 주소는 개요로 간다', async ({ page }) => {
  await page.goto('/');
  for (const hash of ['', '#/', '#/nope', '#/chat']) {
    await goHash(page, '#/settings');
    await expectScreen(page, NAV, SETTINGS);
    await goHash(page, hash);
    await expectScreen(page, NAV, OVERVIEW);
  }
});

test('모델 화면에 가격·컨텍스트·provider 입력칸이 없다', async ({ page }) => {
  await page.goto('/#/models');
  await expectScreen(page, NAV, MODELS);
  for (const role of ['textbox', 'searchbox', 'spinbutton', 'combobox', 'slider'] as const) {
    await expect(page.getByRole(role, { name: GATEWAY_ONLY })).toHaveCount(0);
  }
  await expect(page.getByPlaceholder(GATEWAY_ONLY)).toHaveCount(0);
  // 모델을 직접 등록하는 버튼·링크도 없다
  await expect(page.getByRole('button', { name: REGISTER }).or(page.getByRole('link', { name: REGISTER }))).toHaveCount(0);
});

test.describe('폰 폭 390px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('어느 화면도 가로로 넘치지 않는다', async ({ page }) => {
    for (const item of MENU) {
      await page.goto(`/#/${item.id}`);
      await expectHeading(page, item.label);
      await expect.poll(() => overflowX(page), { message: item.label }).toBeLessThanOrEqual(0);
    }
    await page.goto('/');
    await expectHeading(page, OVERVIEW.label);
    await page.screenshot({ path: shot('admin-phone'), fullPage: true });
  });
});
