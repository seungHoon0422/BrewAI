import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { adminApi, launchDesktop, login, poolUser, userApi, type Client, type NewUser } from './auth';
import { separatorsOnScreen } from './copy-rule';
import { API, MCP } from './env';
import { expectHeading, goHash, shot } from './helpers';
import { MEMO, NOTES_URL, addMemo, ask, chat, ensureTracker, idle, mcpState, myApps, openTrace, type AdminServer, type App } from './mcp';

// 연결된 앱 = 한 줄 앱 줄 (예전 두 줄 카드의 절반 높이) · 분류 칩 (전체 + 문서 · 검색 · 개발 · 업무 …) · 전체 = 분류마다 묶음 머리
// 아이콘 = 서비스 사이트 그림을 conductor 가 받아 캐시 (connectors/icons.py) → 데스크톱은 우리 API 로만 받는다 (CSP · 바깥 주소 0).
//   가짜 MCP(e2e/mock/mcp.mjs) /favicon.ico = 진짜 사이트 대신 · Host localhost = 아이콘 없음 → 첫 글자
// 분류 = 추천 서버(e2e/mock/mcp-presets.json)와 같은 주소 → 이름 낱말 → 도구 이름 (conductor presets.Kinds)
// 사용자 = 테스트 사용자 '일반 멤버'. 넣은 서버 · 앱은 끝에 지운다 (같은 conductor 를 뒤 스펙도 쓴다)
const SEARCH = { url: `${NOTES_URL}?team=icons-search`, name: 'E2E 웹 검색', handle: 'e2e_websearch' };
const DEV = { url: `${NOTES_URL}?team=icons-dev`, name: 'E2E 배포 도구', handle: 'e2e_deploy' };
const LOCAL = { url: `http://localhost:${new URL(MCP).port}/noauth/mcp?team=icons-local`, name: 'E2E 로컬 앱', handle: 'e2e_local' };
// 단색 로고 (가짜 MCP: Host mono.* = 투명 바탕 검은 세모) · 긴 도메인 (좁은 창에서 줄임표)
const MONO = { url: `http://mono.localhost:${new URL(MCP).port}/noauth/mcp?team=icons-mono`, name: 'E2E 단색 로고', handle: 'e2e_mono' };
const LONG = {
  url: `http://a-very-long-workspace-tenant-name-for-testing.localhost:${new URL(MCP).port}/noauth/mcp?team=icons-long`,
  name: 'E2E 팀 협업 도구', handle: 'e2e_long',
};
const OLD_ROW_PX = 66; // 예전 두 줄 카드 (패딩 12 + 이름 줄 + 도메인 줄 + 패딩 12)

test.describe.configure({ mode: 'serial' });
let admin: Client;
let api: Client;
let member: NewUser;
let tracker: AdminServer;
let search: AdminServer;
let app: ElectronApplication;
let win: Page;
const outside: string[] = []; // 화면이 우리 API · app:// 밖으로 보낸 요청 (없어야 한다)

const list = () => win.getByRole('list', { name: '내 앱 목록' });
const row = (name: string) => list().locator('li.conn-app').filter({ has: win.getByText(name, { exact: true }) });
const chips = () => win.getByRole('group', { name: '분류' });

async function cleanup() {
  for (const s of await admin.get<AdminServer[]>('/api/admin/mcp/servers')) {
    if (s.name === SEARCH.name || s.name === LONG.name) await admin.del(`/api/admin/mcp/servers/${s.id}`);
  }
  for (const a of (await myApps(api)).mine.filter((x) => x.source === 'own')) await api.del(`/api/me/mcp/servers/${a.id}`);
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  admin = await adminApi();
  member = await poolUser('member');
  api = await userApi(member);
  await cleanup();
  tracker = await ensureTracker(admin); // 추천 서버 e2e-tracker 와 같은 주소 = 업무
  search = await admin.post<AdminServer>('/api/admin/mcp/servers', { url: SEARCH.url, name: SEARCH.name, handle: SEARCH.handle, description: '웹 검색' });
  await addMemo(api); // 이름 '메모' = 문서
  await api.post('/api/me/mcp/servers', { url: DEV.url, name: DEV.name, handle: DEV.handle }); // '배포' = 개발
  await api.post('/api/me/mcp/servers', { url: LOCAL.url, name: LOCAL.name, handle: LOCAL.handle }); // 낱말 없음 → 도구 이름 (notes = 문서) · 아이콘 없음
  ({ app, win } = await launchDesktop({ as: member }));
  win.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith('app://') && !u.startsWith(`${API}/`) && !u.startsWith('data:') && !u.startsWith('devtools:')) outside.push(u);
  });
  await expectHeading(win, '무엇을 맡길까요?');
});
test.afterAll(async () => {
  await app?.close();
  if (api) await cleanup();
});

test('분류: 추천 서버 주소 · 이름 낱말 · 도구 이름으로 정한다 (API)', async () => {
  const mine = new Map((await myApps(api)).mine.map((a) => [a.name, (a as unknown as { category: string }).category]));
  expect([tracker.name, SEARCH.name, MEMO.name, DEV.name, LOCAL.name].map((n) => mine.get(n))).toEqual(['work', 'search', 'docs', 'dev', 'docs']);
});

test('연결된 앱: 한 줄 앱 줄 (예전 절반 높이) · 서비스 아이콘 · 없으면 첫 글자 · 분류마다 묶음 머리', async () => {
  await goHash(win, '#/connections');
  await expectHeading(win, '연결된 앱');
  await expect(row(tracker.name)).toHaveCount(1);
  // 묶음 머리 = 있는 분류만 · 고정 순서 (문서 → 검색 → 개발 → 업무 → … → 기타)
  const heads = await list().locator('.conn-group-head').evaluateAll((els) => els.map((e) => e.firstChild?.textContent ?? ''));
  expect(heads.filter((h) => ['문서', '검색', '개발', '업무'].includes(h))).toEqual(['문서', '검색', '개발', '업무']);
  await expect(list().locator('.conn-group[data-category="search"] li.conn-app')).toContainText([SEARCH.name]);
  await expect(chips().getByRole('button').first()).toContainText('전체');
  await expect(chips().getByRole('button', { name: /^문서/ })).toHaveAttribute('aria-pressed', 'false');
  // 줄 높이 = 예전의 절반쯤 (한 줄 · 작은 버튼)
  for (const name of [tracker.name, SEARCH.name, MEMO.name]) {
    const box = await row(name).boundingBox();
    expect(box?.height ?? 999).toBeLessThanOrEqual(OLD_ROW_PX * 0.6);
  }
  await expect(row(tracker.name).getByRole('button', { name: `${tracker.name} 연결` })).toBeVisible(); // 같은 버튼 그대로
  // 아이콘: conductor 가 받아 둔 사이트 그림 (data: 주소 = 우리 API 로 받은 것) · 아이콘 없는 사이트 = 첫 글자
  for (const name of [tracker.name, SEARCH.name, MEMO.name, DEV.name]) {
    await expect(row(name).locator('.app-icon img')).toHaveAttribute('src', /^data:image\/png;base64,/);
  }
  await expect(row(LOCAL.name).locator('.app-icon img')).toHaveCount(0);
  await expect(row(LOCAL.name).locator('.app-icon')).toHaveText('E');
  await expect(row(LOCAL.name).locator('.app-icon')).toHaveAttribute('aria-hidden', 'true'); // 장식 (이름은 바로 옆)
  expect(outside).toEqual([]); // 데스크톱은 바깥 사이트를 직접 부르지 않는다
  expect(await separatorsOnScreen(win)).toEqual([]);
  await win.screenshot({ path: shot('desktop-connections-compact'), animations: 'disabled' });
  await win.emulateMedia({ colorScheme: 'dark' });
  await win.screenshot({ path: shot('desktop-connections-compact-dark'), animations: 'disabled' });
  await win.emulateMedia({ colorScheme: 'light' });
});

test('분류 칩: 검색 = 검색 앱만 (묶음 머리 없음) · 전체로 돌아가면 다시 묶음', async () => {
  await chips().getByRole('button', { name: /^검색/ }).click();
  await expect(chips().getByRole('button', { name: /^검색/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(list()).toHaveAttribute('data-category', 'search');
  await expect(row(SEARCH.name)).toHaveCount(1);
  await expect(row(tracker.name)).toHaveCount(0);
  expect(new Set(await list().locator('li.conn-app').evaluateAll((els) => els.map((e) => e.getAttribute('data-category'))))).toEqual(new Set(['search']));
  await expect(win.locator('.conn-group-head')).toHaveCount(0);
  expect(await separatorsOnScreen(win)).toEqual([]);
  await win.screenshot({ path: shot('desktop-connections-category'), animations: 'disabled' });
  await chips().getByRole('button', { name: /^전체/ }).click();
  await expect(list().locator('.conn-group-head').first()).toBeVisible();
});

test('아이콘은 conductor 캐시에서 (가짜 사이트에 다시 안 감) · 로그인한 API 로만 · 상세 서랍 · 추천 서버에도', async () => {
  const token = (await login(member)).access_token;
  const before = (await mcpState() as unknown as { favicon_requests: number }).favicon_requests;
  const got = await fetch(`${API}/api/me/mcp/servers/${search.id}/icon`, { headers: { authorization: `Bearer ${token}` } });
  expect([got.status, got.headers.get('content-type'), got.headers.get('x-content-type-options')]).toEqual([200, 'image/png', 'nosniff']);
  const none = await fetch(`${API}/api/me/mcp/servers/${(await myApps(api)).mine.find((a) => a.name === LOCAL.name)!.id}/icon`, { headers: { authorization: `Bearer ${token}` } });
  expect(none.status).toBe(204); // 아이콘 없는 사이트 = 없음도 캐시
  expect((await fetch(`${API}/api/me/mcp/servers/${search.id}/icon`)).status).toBe(401);
  expect((await mcpState() as unknown as { favicon_requests: number }).favicon_requests).toBe(before);

  await row(SEARCH.name).getByRole('button', { name: `${SEARCH.name} 자세히` }).click();
  const sheet = win.getByRole('dialog', { name: SEARCH.name }); // 제목의 아이콘은 장식 = 서랍 이름 그대로
  await expect(sheet.locator('.app-sheet-title .app-icon img')).toHaveAttribute('src', /^data:image\/png/);
  await sheet.getByRole('button', { name: '닫기' }).first().click();
  await expect(sheet).toBeHidden();

  await win.getByRole('button', { name: '앱 추가' }).first().click();
  const dlg = win.getByRole('dialog', { name: '앱 추가' });
  const presets = dlg.getByRole('list', { name: '추천 서버 목록' });
  await expect(presets.locator('.app-preset').filter({ hasText: 'E2E 추천 메모' }).locator('.app-icon img')).toHaveAttribute('src', /^data:image\/png/);
  await expect(presets.locator('.app-preset').filter({ hasText: 'E2E 키 전용' }).locator('.app-icon img')).toHaveCount(0); // 못 쓰는 추천 = 받지 않는다
  await win.screenshot({ path: shot('desktop-connections-presets-icons'), animations: 'disabled' });
  await dlg.getByRole('button', { name: '취소' }).click();
  expect(outside).toEqual([]);
});

test('대화: 앱 고르기 한 줄 · 앱 도구 카드에도 같은 아이콘', async () => {
  test.setTimeout(90_000);
  await goHash(win, '#/');
  await win.getByRole('button', { name: '새 대화' }).click();
  await ask(win, `[fake:app ${MEMO.handle} 메모 검색] [fake:tool ${MEMO.handle}__search_notes {"query":"회의"}] 회의 메모 찾아줘`);
  await expect(chat(win).last).toContainText('앱 결과를 받았어요', { timeout: 25_000 });
  await idle(win);
  const panel = await openTrace(win);
  await expect(panel.locator(`.tp-note[data-app="${MEMO.handle}"] .app-icon img`)).toHaveAttribute('src', /^data:image\/png/);
  await expect(panel.locator(`.tp-tool[data-app="${MEMO.handle}"] .ttile .app-icon img`)).toHaveAttribute('src', /^data:image\/png/);
  expect(outside).toEqual([]);
  expect(await separatorsOnScreen(win)).toEqual([]);
  await win.screenshot({ path: shot('desktop-chat-app-icons'), animations: 'disabled' });
});

// 사이트 그림 = 두 테마 모두 밝은 받침 (--icon-plate) 위에 · 다크 면(#1e1e21)에 투명 바탕 검은 로고가 묻히지 않게
const rgb = (c: string) => (c.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
test('다크 모드: 투명 바탕 검은 로고도 밝은 받침 위에 보인다', async () => {
  const mono = await api.post<App>('/api/me/mcp/servers', { url: MONO.url, name: MONO.name, handle: MONO.handle });
  try {
    await goHash(win, '#/');
    await goHash(win, '#/connections');
    await expectHeading(win, '연결된 앱');
    const icon = row(MONO.name).locator('.app-icon');
    await expect(icon.locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/);
    await win.emulateMedia({ colorScheme: 'dark' });
    const plate = await icon.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(Math.min(...rgb(plate))).toBeGreaterThan(220); // 밝은 받침 (다크 면 #1e1e21 가 아니다)
    // 첫 글자 네모(그림 없음)는 그대로 다크 면 색
    const letter = await row(LOCAL.name).locator('.app-icon').evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(Math.max(...rgb(letter))).toBeLessThan(120);
    await row(MONO.name).scrollIntoViewIfNeeded();
    expect(outside).toEqual([]);
    await win.screenshot({ path: shot('desktop-connections-icon-mono-dark'), animations: 'disabled' });
  } finally {
    await win.emulateMedia({ colorScheme: 'light' });
    await api.del(`/api/me/mcp/servers/${mono.id}`);
  }
});

// 창 최소 너비(960 · main.js minWidth) + 사이드바 = 목록이 좁다 → 이름은 그대로 · 메타는 칸마다 줄임표 (글자가 반쯤 잘리지 않게) · 도구 수 그대로 · 버튼 그대로
test('좁은 창 (960px): 긴 도메인 = 줄임표 · 이름 · 도구 수 · 버튼은 그대로 · 가로 넘침 없음', async () => {
  const long = await admin.post<AdminServer>('/api/admin/mcp/servers', { url: LONG.url, name: LONG.name, handle: LONG.handle });
  const size = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize());
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 760));
    await goHash(win, '#/');
    await goHash(win, '#/connections');
    await expectHeading(win, '연결된 앱');
    const r = row(LONG.name);
    await expect(r.locator('.app-src')).toHaveText('전체 공통');
    await expect(r.getByRole('button', { name: '숨기기' })).toBeVisible();
    const fit = (el: Element) => el.scrollWidth <= el.clientWidth + 1;
    expect(await r.locator('.app-open b').evaluate(fit)).toBe(true); // 이름은 다 보인다
    const items = r.locator('.app-meta .ui-meta-item');
    await expect(items).toHaveCount(2); // 도메인 · 도구 수 (로그인 칸 없음 = 같은 곳)
    const dom = items.first();
    expect(await dom.evaluate((el) => getComputedStyle(el).textOverflow)).toBe('ellipsis');
    expect(await dom.evaluate(fit)).toBe(false); // 긴 도메인 = 줄임표로 줄었다
    expect(await items.last().evaluate(fit)).toBe(true); // 도구 수는 그대로
    await expect(r.locator('.app-meta')).toHaveAttribute('title', /^a-very-long-workspace-tenant-name-for-testing\.localhost, 도구 \d+개$/);
    for (const name of [LONG.name, tracker.name, SEARCH.name]) {
      expect(await row(name).evaluate(fit), name).toBe(true); // 줄 안에서 가로로 넘치지 않는다
      expect((await row(name).boundingBox())?.height ?? 999).toBeLessThanOrEqual(OLD_ROW_PX * 0.6); // 여전히 한 줄
    }
    await expect(row(tracker.name).getByRole('button', { name: `${tracker.name} 연결` })).toBeVisible();
    expect(await win.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await separatorsOnScreen(win)).toEqual([]);
    await r.scrollIntoViewIfNeeded();
    await win.screenshot({ path: shot('desktop-connections-compact-narrow'), animations: 'disabled' });
  } finally {
    await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h), size as [number, number]);
    await admin.del(`/api/admin/mcp/servers/${long.id}`);
  }
});
