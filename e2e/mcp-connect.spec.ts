import { test, expect, chromium, type Browser, type ElectronApplication, type Page } from '@playwright/test';
import { adminApi, launchDesktop, userApi, type Client } from './auth';
import { API } from './env';
import { separatorsOnScreen } from './copy-rule';
import { expectHeading, goHash, shot } from './helpers';
import { NOTES_URL, captureBrowser, disconnect, ensureTracker, fakeMcp, myApp, myApps, nextOpened, openedCount, type AdminServer } from './mcp';

// slice 05 mcp-connect: 연결된 앱 '연결 필요' → (가짜) 로그인 → 연결됨 · 앱을 다시 열어도 유지 · 연결 끊기
// + [앱 추가] 미리 확인 (로그인 방식 · 도구 수 · 예상 토큰) → 추가 → 지우기 · 상세 서랍의 도구 목록 (쓰기 표시)
// 시스템 브라우저 대신 Playwright 브라우저 탭 (main 의 shell.openExternal 을 바꿔 연 주소를 받는다 · auth-google 과 같은 방법)
const channel = process.platform === 'darwin' ? 'chrome' : process.platform === 'win32' ? 'msedge' : undefined;

test.describe.configure({ mode: 'serial' });
let browser: Browser;
let api: Client;
let tracker: AdminServer;
let app: ElectronApplication;
let win: Page;

const row = (name: string) => win.getByRole('list', { name: '내 앱 목록' }).locator('li.conn-app').filter({ has: win.getByText(name, { exact: true }) });

test.beforeAll(async () => {
  test.setTimeout(120_000);
  browser = await chromium.launch({ channel });
  tracker = await ensureTracker(await adminApi());
  api = await userApi();
  await disconnect(api, tracker.id);
  await fakeMcp('account', { name: 'alice' });
  ({ app, win } = await launchDesktop());
  await captureBrowser(app);
});
test.afterAll(async () => {
  await app?.close();
  await browser?.close();
  if (api && tracker) await disconnect(api, tracker.id); // 관리자 계정을 연결 안 된 채로 돌려 둔다 (admin-mcp 의 '연결 시험 = needs_login')
});

test('연결된 앱: 맨 위 체크박스 (기본 꺼짐) · 전체 공통 앱 = 연결 필요', async () => {
  await goHash(win, '#/connections');
  await expectHeading(win, '연결된 앱');
  const auto = win.getByRole('checkbox', { name: /필요할 때 바로 로그인 화면 열기/ });
  await expect(auto).not.toBeChecked();
  const r = row(tracker.name);
  await expect(r.locator('.app-src')).toHaveText('전체 공통');
  await expect(r.locator('.app-state')).toHaveText('연결 필요');
  await expect(r.getByRole('button', { name: `${tracker.name} 연결` })).toBeVisible();
  await expect(win.getByText('미연결')).toHaveCount(0); // 예시 목록(SAMPLE_APPS) 은 없다
  expect(await separatorsOnScreen(win)).toEqual([]); // 가운뎃점 없음
  await win.screenshot({ path: shot('desktop-mcp-connections'), animations: 'disabled' });
});

test('연결: 시스템 브라우저(탭) 로그인 → loopback 은 1회용 bwm_ code 만 → 연결됨 · 도구 30개', async () => {
  const before = await openedCount(app);
  await row(tracker.name).getByRole('button', { name: `${tracker.name} 연결` }).click();
  await expect(row(tracker.name).locator('.app-state')).toHaveText('브라우저에서 로그인 중');
  const url = await nextOpened(app, before);
  const tab = await browser.newPage();
  await tab.goto(url);
  await expect(tab.getByRole('heading', { level: 1 })).toHaveText('BrewAI로 돌아가세요');
  await expect(tab.locator('p')).toHaveText('앱 연결을 마쳤어요. 이 탭은 닫아도 돼요.');
  const back = new URL(tab.url());
  expect(back.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  expect(back.pathname).toBe('/cb');
  expect(back.searchParams.get('code')).toMatch(/^bwm_/); // MCP 토큰이 아니라 conductor 의 1회용 handoff
  expect(back.searchParams.get('ds')).toBeNull(); // ds 는 주소에 없다 (conductor 가 complete 에서 본다)
  await tab.close();

  await expect(row(tracker.name).locator('.app-state')).toHaveText('연결됨');
  await expect(row(tracker.name)).toContainText('도구 30개');
  expect((await myApp(api, tracker.id))?.connection).toBe('connected');
  // 같은 handoff code 는 다시 못 쓴다
  const again = await api.raw('POST', `/api/me/mcp/servers/${tracker.id}/connect/complete`, { code: back.searchParams.get('code'), ds: 'x'.repeat(32) });
  expect(again.status).toBe(400);
  // 화면(renderer)은 MCP 토큰을 모른다: 저장소 · 쿠키에 없다
  const seen = await win.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, cookie: document.cookie }));
  expect(seen).not.toMatch(/bwm_|access_token|refresh_token/);
  await win.screenshot({ path: shot('desktop-mcp-connected'), animations: 'disabled' });
  await win.emulateMedia({ colorScheme: 'dark' });
  await win.screenshot({ path: shot('desktop-mcp-connected-dark'), animations: 'disabled' });
  await win.emulateMedia({ colorScheme: 'light' });
});

test('상세 서랍: 도구 목록 · 쓰기 도구는 쓰기 표시 · 에이전트가 보는 줄 (라이트 · 다크)', async () => {
  await row(tracker.name).getByRole('button', { name: `${tracker.name} 자세히` }).click();
  const sheet = win.getByRole('dialog', { name: tracker.name });
  await expect(sheet).toBeVisible();
  const tools = sheet.getByRole('list', { name: '도구' }).locator('li');
  await expect(tools).toHaveCount(30);
  await expect(sheet.locator('li[data-write] .write')).toHaveCount(12);
  await expect(sheet.locator('li[data-tool="create_issue"] .write')).toHaveText('쓰기');
  await expect(sheet.locator('li[data-tool="search_issues"] .write')).toHaveCount(0);
  await expect(sheet.locator('.app-line code')).toContainText(tracker.handle);
  expect(await separatorsOnScreen(win)).toEqual([]);
  await win.screenshot({ path: shot('desktop-mcp-detail'), animations: 'disabled' });
  await win.emulateMedia({ colorScheme: 'dark' });
  await win.screenshot({ path: shot('desktop-mcp-detail-dark'), animations: 'disabled' });
  await win.emulateMedia({ colorScheme: 'light' });
  await sheet.getByRole('button', { name: '닫기' }).first().click();
  await expect(sheet).toBeHidden();
});

test('앱을 다시 열어도 연결은 그대로 (인증정보는 conductor 금고에 · 데스크톱엔 없음)', async () => {
  await app.close();
  ({ app, win } = await launchDesktop());
  await captureBrowser(app);
  await goHash(win, '#/connections');
  await expect(row(tracker.name).locator('.app-state')).toHaveText('연결됨');
});

test('연결 끊기 → 연결 필요', async () => {
  await row(tracker.name).getByRole('button', { name: '연결 끊기' }).click();
  await expect(row(tracker.name).locator('.app-state')).toHaveText('연결 필요');
  expect((await myApp(api, tracker.id))?.connection).toBe('needs_login');
});

test('[앱 추가] 주소 → 미리 확인 (로그인 없음, 도구 4개, 쓰기 1개, 예상 토큰) → 추가 = 내가 추가 · 연결됨 → 지우기', async () => {
  // 앞 실행이 남긴 같은 주소가 있으면 지운다
  for (const a of (await myApps(api)).mine.filter((x) => x.source === 'own')) await api.del(`/api/me/mcp/servers/${a.id}`);
  await win.getByRole('button', { name: '앱 추가' }).first().click();
  const dlg = win.getByRole('dialog', { name: '앱 추가' });
  await dlg.getByRole('textbox', { name: '주소' }).fill('ftp://nope');
  await dlg.getByRole('button', { name: '미리 확인' }).click();
  await expect(dlg.getByRole('alert')).toHaveText(/https 주소만|주소 모양/);
  await dlg.getByRole('textbox', { name: '주소' }).fill(NOTES_URL);
  await dlg.getByRole('textbox', { name: '이름' }).fill('메모장');
  await dlg.getByRole('textbox', { name: '에이전트가 읽는 한 줄 설명' }).fill('내 메모 찾기와 저장');
  await dlg.getByRole('textbox', { name: '찾을 때 쓸 말' }).fill('메모, 노트');
  await dlg.getByRole('button', { name: '미리 확인' }).click();
  const preview = dlg.getByRole('status', { name: '미리 확인' });
  await expect(preview).toContainText('로그인 없음, 도구 4개, 쓰기 1개, 예상 토큰 약');
  await expect(preview.locator('.app-line code')).toContainText('메모장');
  await win.screenshot({ path: shot('desktop-mcp-add-preview'), animations: 'disabled' });
  expect(await separatorsOnScreen(win)).toEqual([]);
  await dlg.getByRole('button', { name: '추가', exact: true }).click();
  await expect(dlg).toBeHidden();
  const r = row('메모장');
  await expect(r.locator('.app-src')).toHaveText('내가 추가');
  await expect(r.locator('.app-state')).toHaveText('연결됨'); // 인증 없는 서버 = 바로 쓴다
  await expect(r).toContainText('도구 4개');

  await r.getByRole('button', { name: '메모장 자세히' }).click();
  const sheet = win.getByRole('dialog', { name: '메모장' });
  await expect(sheet.locator('li[data-tool="add_note"] .write')).toHaveText('쓰기');
  await sheet.getByRole('button', { name: '앱 지우기' }).click();
  await win.getByRole('dialog', { name: '앱을 지울까요?' }).getByRole('button', { name: '앱 지우기' }).click();
  await expect(sheet).toBeHidden();
  await expect(row('메모장')).toHaveCount(0);
  expect((await myApps(api)).mine.some((a) => a.name === '메모장')).toBe(false);
});

test('API: 보이지 않는 서버 = 404 · 데스크톱 말고 브라우저 주소로는 연결 시작 안 됨 (Bearer 필요)', async () => {
  const res = await fetch(`${API}/api/me/mcp/servers/${tracker.id}/connect/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  expect(res.status).toBe(401);
  const gone = await api.raw('GET', '/api/me/mcp/servers/nope-404');
  expect(gone.status).toBe(404);
});
