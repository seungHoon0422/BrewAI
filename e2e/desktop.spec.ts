import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { launchDesktop } from './auth';
import { API } from './env';
import { expectMenu, expectScreen, goHash, openMenu, shot, type MenuItem } from './helpers';

// 사용자 데스크톱 앱 (Electron) 빌드본. npm run e2e 가 먼저 빌드한다. 로그인한 상태로 연다 (e2e/auth.ts)

// 메뉴 계약: 레일 순서 그대로 (설정은 구분선 아래)
const NAV = '메뉴';
const MENU: MenuItem[] = [
  { id: 'chat', label: '대화', h1: '무엇을 맡길까요?' },
  { id: 'activity', label: '진행 상황' },
  { id: 'scheduled', label: '예약 작업' },
  { id: 'skills', label: '스킬' },
  { id: 'connections', label: '연결된 앱' },
  { id: 'settings', label: '설정' },
];
const CHAT = MENU[0];
const SETTINGS = MENU[5];

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
