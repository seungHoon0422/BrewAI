import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { launchDesktop } from './auth';
import { API } from './env';
import { SETTINGS_NAV, expectMenu, expectScreen, goHash, openMenu, shot, type MenuItem } from './helpers';

// 사용자 데스크톱 앱 (Electron) 빌드본. npm run e2e 가 먼저 빌드한다. 로그인한 상태로 연다 (e2e/auth.ts)

// 메뉴 계약: 레일 순서 그대로 (설정은 구분선 아래 · 누르면 첫 세부 메뉴 '계정')
const NAV = '메뉴';
const MENU: MenuItem[] = [
  { id: 'chat', label: '대화', h1: '무엇을 맡길까요?' },
  { id: 'activity', label: '진행 상황' },
  { id: 'scheduled', label: '예약 작업' },
  { id: 'files', label: '파일' },
  { id: 'settings', label: '설정', h1: '계정' },
];
const CHAT = MENU[0];
const SETTINGS = MENU[4];
// 설정 세부 메뉴 계약: 사이드바 자리 · 묶음(영역)마다 순서 그대로 · 스킬 · 연결된 앱은 여기 안에
const GROUPS: { label: string; items: MenuItem[] }[] = [
  { label: '내 계정', items: [{ id: 'settings/account', label: '계정' }, { id: 'settings/general', label: '일반' }] },
  { label: 'AI 작업', items: [{ id: 'settings/model', label: '모델' }, { id: 'settings/skills', label: '스킬' }, { id: 'settings/connections', label: '연결된 앱' }] },
  { label: '정보', items: [{ id: 'settings/about', label: '앱 정보' }] },
];
const SUBS = GROUPS.flatMap((g) => g.items);

let app: ElectronApplication;
let win: Page;
// 바깥 주소 대신 이 PC 의 임시 서버 (인터넷이 끊겨도 '막힘' 을 제대로 센다)
let outside: http.Server;
let OUTSIDE = '';
let hits = 0;

test.beforeAll(async () => {
  test.setTimeout(180_000); // 첫 실행은 Electron 실행 파일(~130MB)을 받는다 (npm ci 는 안 받는다)
  outside = http.createServer((_req, res) => {
    hits++;
    res.end('ok');
  });
  await new Promise<void>((resolve) => outside.listen(0, '127.0.0.1', resolve));
  OUTSIDE = `http://127.0.0.1:${(outside.address() as AddressInfo).port}/`;
  // API 출처와 '바깥' 서버는 반드시 달라야 한다 (같으면 아래 차단 테스트가 의미 없다). 포트 0 = 임시 포트 ≠ 8787
  expect(new URL(OUTSIDE).origin).not.toBe(API);
  ({ app, win } = await launchDesktop());
});

test.afterAll(async () => {
  await app?.close();
  outside?.close();
});

test('창 제목은 BrewAI, 첫 화면은 대화', async () => {
  await expect(win).toHaveTitle('BrewAI');
  await expectScreen(win, NAV, CHAT);
});

test('렌더러에 Node 가 없다 (contextIsolation · sandbox 켬)', async () => {
  const prefs = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => {
      // Electron 44 런타임엔 있지만 타입 정의에서 빠졌다
      const p = (w.webContents as any).getLastWebPreferences();
      return { contextIsolation: p?.contextIsolation, sandbox: p?.sandbox, nodeIntegration: p?.nodeIntegration };
    }),
  );
  expect(prefs.length).toBeGreaterThan(0);
  for (const p of prefs) expect(p).toEqual({ contextIsolation: true, sandbox: true, nodeIntegration: false });
  expect(await win.evaluate(() => typeof require)).toBe('undefined');
});

test('렌더러는 바깥 주소에 못 나간다', async () => {
  // no-cors: 안 막혔으면 응답이 온다 → CORS 실패를 차단으로 잘못 세지 않는다
  const result = await win.evaluate(
    (url) => fetch(url, { mode: 'no-cors' }).then(() => 'reached', () => 'blocked'),
    OUTSIDE,
  );
  expect(result).toBe('blocked');
  expect(hits).toBe(0);
});

test('app:// 로 뜨고 CSP 가 붙는다 (인라인 스크립트·스타일 금지)', async () => {
  expect(win.url()).toMatch(/^app:\/\/brewai\//);
  const r = await win.evaluate(async () => {
    const csp = (await fetch(location.href)).headers.get('content-security-policy');
    const s = document.createElement('script');
    s.textContent = 'window.__inline = 1';
    document.head.append(s);
    return { csp, inline: (window as any).__inline === 1 };
  });
  expect(r.csp).toContain("script-src 'self'");
  expect(r.csp).not.toContain('unsafe-inline');
  expect(r.inline).toBe(false);
});

test('열린 곳은 API 출처 하나뿐 (CSP · config.json · main 요청 차단 세 겹)', async () => {
  const r = await win.evaluate(async (api) => {
    const csp = (await fetch(location.href)).headers.get('content-security-policy') ?? '';
    const config = await (await fetch('./config.json')).json();
    const reach = (u: string) => fetch(u, { mode: 'no-cors' }).then(() => 'reached', () => 'blocked');
    return {
      connect: csp.split('; ').find((d) => d.startsWith('connect-src')),
      config,
      health: await fetch(`${api}/healthz`).then((x) => x.status, () => 0), // CORS 까지 통과
      alias: await reach(api.replace('127.0.0.1', 'localhost') + '/healthz'), // 같은 PC 라도 다른 출처
    };
  }, API);
  expect(r.connect).toBe(`connect-src 'self' ${API}`);
  expect(r.config).toEqual({ apiUrl: API });
  expect(r.health).toBe(200);
  expect(r.alias).toBe('blocked');
  // CSP 를 빼고 onBeforeRequest 만 본다: main 의 net.fetch 도 이 세션의 webRequest 를 거친다
  const viaMain = (url: string) =>
    app.evaluate(({ net }, u) => net.fetch(u).then((x) => `reached ${x.status}`, (e: Error) => `blocked ${e.message}`), url);
  expect(await viaMain(`${API}/healthz`)).toBe('reached 200');
  expect(await viaMain(OUTSIDE)).toMatch(/^blocked .*ERR_BLOCKED_BY_CLIENT/);
  expect(hits).toBe(0);
});

test('바깥으로 이동·새 창은 막힌다', async () => {
  for (const url of [OUTSIDE, `${API}/healthz`]) {
    await win.evaluate((u) => {
      location.href = u;
    }, url);
    await win.waitForTimeout(500);
    expect(win.url()).toMatch(/^app:\/\/brewai\//);
  }
  expect(await win.evaluate(() => window.open(location.href) === null)).toBe(true);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  expect(hits).toBe(0);
  // 막힌 이동은 Playwright 쪽에 '이동 중' 으로 남는다 → 다시 열어 다음 테스트를 깨끗하게
  await win.reload();
});

test('레일 메뉴가 계약 순서대로 있다', async () => {
  await expectMenu(win, NAV, MENU);
});

test('메뉴를 누르면 그 화면이 뜬다', async () => {
  for (const item of MENU) {
    await openMenu(win, NAV, item);
    await win.screenshot({ path: shot(`desktop-${item.id}`) });
  }
});

test('레일에 마우스를 올리면 이름이 바로 (기다림 없이) 오른쪽에 뜬다', async () => {
  const rail = win.getByRole('navigation', { name: NAV, exact: true });
  for (const item of MENU) {
    const a = rail.getByRole('link', { name: item.label, exact: true });
    await a.hover();
    const tip = win.getByRole('tooltip', { name: item.label, exact: true });
    await expect(tip).toBeVisible({ timeout: 300 }); // 툴팁 기본 기다림(350ms)보다 짧게
    const [box, tipBox] = [await a.boundingBox(), await tip.boundingBox()];
    expect(tipBox!.x).toBeGreaterThan(box!.x + box!.width); // 아이콘 오른쪽
    expect(await a.getAttribute('title')).toBeNull(); // 늦게 뜨는 브라우저 툴팁은 없다
  }
  // 누른 뒤 마우스를 떼면 사라진다 (마우스 포커스로 남지 않음) · 키보드 Tab 이면 뜬다
  await rail.getByRole('link', { name: '설정', exact: true }).click();
  await win.mouse.move(600, 400);
  await expect(win.getByRole('tooltip')).toHaveCount(0);
  await win.keyboard.press('Shift+Tab');
  await expect(win.getByRole('tooltip', { name: '파일', exact: true })).toBeVisible();
  await win.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await rail.getByRole('link', { name: '파일', exact: true }).hover();
  await expect(win.getByRole('tooltip', { name: '파일', exact: true })).toHaveCSS('opacity', '1');
  await win.screenshot({ path: shot('desktop-rail-tip') });
  await win.mouse.move(600, 400);
});

test('설정 = 사이드바가 세부 메뉴로 (영역별 묶음) · 누르면 그 화면 · 대화로 가면 다시 대화 목록', async () => {
  await openMenu(win, NAV, SETTINGS);
  await expect(win).toHaveURL(/#\/settings\/account$/);
  const sub = win.getByRole('navigation', { name: SETTINGS_NAV, exact: true });
  await expect(sub.getByRole('group')).toHaveCount(GROUPS.length);
  await expectMenu(win, SETTINGS_NAV, SUBS); // 전체 순서
  for (const g of GROUPS) {
    const group = sub.getByRole('group', { name: g.label, exact: true });
    await expect(group).toContainText(g.label);
    await expect(group.getByRole('link')).toHaveText(g.items.map((i) => i.label));
  }
  await expect(win.getByRole('button', { name: '새 대화' })).toHaveCount(0); // 대화 목록 대신
  for (const item of SUBS) {
    await openMenu(win, SETTINGS_NAV, item);
    await expect(win.getByRole('navigation', { name: NAV, exact: true }).getByRole('link', { name: '설정' })).toHaveAttribute('aria-current', 'page');
    await win.screenshot({ path: shot(`desktop-${item.id.replace('/', '-')}`) });
  }
  await openMenu(win, NAV, CHAT);
  await expect(sub).toHaveCount(0);
  await expect(win.getByRole('button', { name: '새 대화' })).toBeVisible();
});

test('예전 주소 #/skills · #/connections · #/settings 는 설정 안 그 화면으로', async () => {
  for (const [hash, to, h1] of [['#/skills', 'settings/skills', '스킬'], ['#/connections', 'settings/connections', '연결된 앱'], ['#/settings', 'settings/account', '계정']]) {
    await goHash(win, '#/chat');
    await expectScreen(win, NAV, CHAT);
    await goHash(win, hash);
    await expect(win).toHaveURL(new RegExp(`#/${to}$`));
    await expectScreen(win, SETTINGS_NAV, { id: to, label: h1 });
  }
});

test('빈 주소·모르는 주소·관리자 주소는 대화로 간다', async () => {
  for (const hash of ['', '#/', '#/nope', '#/admin', '#/models']) {
    await goHash(win, '#/settings');
    await expectScreen(win, NAV, SETTINGS);
    await goHash(win, hash);
    await expectScreen(win, NAV, CHAT);
  }
});

test('어느 화면에도 관리자 문구가 없다', async () => {
  for (const item of MENU) {
    await openMenu(win, NAV, item);
    expect(await readableText(win), item.label).not.toMatch(/관리자|모델 관리/);
  }
  for (const item of SUBS) {
    await goHash(win, `#/${item.id}`);
    await expectScreen(win, SETTINGS_NAV, item);
    expect(await readableText(win), item.label).not.toMatch(/관리자|모델 관리/);
  }
});

// 화면 글 + 툴팁·aria-label·placeholder (숨은 요소 포함, script·style 은 뺀다)
function readableText(page: Page) {
  return page.evaluate(() => {
    const body = document.body.cloneNode(true) as HTMLElement;
    body.querySelectorAll('script, style, noscript').forEach((el) => el.remove());
    const attrs = [...body.querySelectorAll('*')].flatMap((el) =>
      ['aria-label', 'title', 'placeholder', 'alt'].map((a) => el.getAttribute(a) ?? ''));
    return [document.title, body.textContent ?? '', ...attrs].join(' ').replace(/\s+/g, ' ');
  });
}
