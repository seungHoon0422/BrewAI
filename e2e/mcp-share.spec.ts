import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchDesktop, poolUser, userApi, type Client, type NewUser } from './auth';
import { expectHeading, goHash, pickOption, shot } from './helpers';
import {
  TRACKER_URL, ask, captureBrowser, chat, disconnect, fakeMcp, followLogin, idle, mcpState, myApps, nextOpened, openedCount, type App,
} from './mcp';

// slice 05 mcp-share: A 가 앱을 추가하면서 스페이스 S 에 공유 → 멤버 B 가 [가져오기] → B 는 자기 (가짜) 계정으로 로그인
// (mock 이 받은 토큰 = B 것 · A 토큰 아님) → 비멤버 C 에겐 안 보인다 (목록 · 상세 404). 공유되는 건 서버 정의뿐, 인증정보는 안 나눈다.
// A = alice · B = bob · C = 일반 멤버 (같은 조직 · S 멤버 아님)
const SPACE = `앱 공유 ${Date.now().toString(36)}`;
const NAME = '디자인 트래커';

test.describe.configure({ mode: 'serial' });
let alice: NewUser;
let bob: NewUser;
let aliceApi: Client;
let bobApi: Client;
let carolApi: Client;
let spaceId = '';
let serverId = '';
let app: ElectronApplication | null = null;
let win: Page;

const row = (name: string) => win.getByRole('list', { name: '내 앱 목록' }).locator('li.conn-app').filter({ has: win.getByText(name, { exact: true }) });

test.beforeAll(async () => {
  test.setTimeout(120_000);
  alice = await poolUser('alice');
  bob = await poolUser('bob');
  aliceApi = await userApi(alice);
  bobApi = await userApi(bob);
  carolApi = await userApi(await poolUser('member'));
  // 앞 실행이 남긴 alice 의 같은 주소 앱은 지운다 (주인 · 주소당 하나)
  for (const a of (await myApps(aliceApi)).mine.filter((x) => x.source === 'own')) await aliceApi.del(`/api/me/mcp/servers/${a.id}`);
  const space = await aliceApi.post<{ id: string }>('/api/spaces', { name: SPACE, visibility: 'private', members: [{ user_id: bob.id, role: 'member' }] });
  spaceId = space.id;
});
test.afterAll(async () => {
  await app?.close();
  if (serverId) await aliceApi.raw('DELETE', `/api/me/mcp/servers/${serverId}`);
  await fakeMcp('account', { name: 'alice' });
});

test('A: [앱 추가] + 공유 = 스페이스 S → 내가 추가 · 공유된 곳에 S', async () => {
  test.setTimeout(90_000);
  ({ app, win } = await launchDesktop({ as: alice }));
  await goHash(win, '#/connections');
  await expectHeading(win, '연결된 앱');
  await win.getByRole('button', { name: '앱 추가' }).first().click();
  const dlg = win.getByRole('dialog', { name: '앱 추가' });
  await dlg.getByRole('textbox', { name: '주소' }).fill(TRACKER_URL);
  await dlg.getByRole('textbox', { name: '이름' }).fill(NAME);
  await dlg.getByRole('textbox', { name: '에이전트가 읽는 한 줄 설명' }).fill('디자인팀 이슈');
  await dlg.getByRole('radio', { name: '스페이스' }).click();
  await pickOption(dlg.getByRole('combobox', { name: '공유할 곳' }), { label: SPACE });
  await dlg.getByRole('button', { name: '미리 확인' }).click();
  await expect(dlg.getByRole('status', { name: '미리 확인' })).toContainText('로그인 방식 OAuth (127.0.0.1), 도구 수는 로그인 뒤에 알 수 있어요');
  await win.screenshot({ path: shot('desktop-mcp-share-add'), animations: 'disabled' });
  await dlg.getByRole('button', { name: '추가', exact: true }).click();
  await expect(dlg).toBeHidden();
  await expect(row(NAME).locator('.app-src')).toHaveText('내가 추가');
  await expect(row(NAME).locator('.app-state')).toHaveText('연결 필요');

  const mine = (await myApps(aliceApi)).mine.find((a) => a.name === NAME) as App;
  serverId = mine.id;
  const detail = await aliceApi.get<{ shares: { scope_kind: string; scope_id: string }[] }>(`/api/me/mcp/servers/${serverId}`);
  expect(detail.shares).toEqual([expect.objectContaining({ scope_kind: 'space', scope_id: spaceId })]);
  // 상세 서랍의 공유 칸 = S 경로 + [공유 끊기]
  await row(NAME).getByRole('button', { name: `${NAME} 자세히` }).click();
  const sheet = win.getByRole('dialog', { name: NAME });
  await expect(sheet.locator('.app-shares li[data-share="space"]')).toContainText(SPACE);
  await expect(sheet.getByRole('button', { name: `${SPACE} 공유 끊기` })).toBeVisible();
  await win.screenshot({ path: shot('desktop-mcp-share-detail'), animations: 'disabled' });
  await app.close();
  app = null;
});

test('C (비멤버): 가져올 수 있는 앱에도 없고 상세는 404', async () => {
  const list = await myApps(carolApi);
  expect(list.importable.some((i) => i.id === serverId)).toBe(false);
  expect(list.mine.some((a) => a.id === serverId)).toBe(false);
  expect((await carolApi.raw('GET', `/api/me/mcp/servers/${serverId}`)).status).toBe(404);
  expect((await carolApi.raw('POST', `/api/me/mcp/servers/${serverId}/import`, {})).status).toBe(404);
});

test('B (멤버): 가져올 수 있는 앱 (S 경로) → [가져오기] → 가져옴 · 연결 필요 → 자기 계정(bob)으로 로그인', async () => {
  test.setTimeout(90_000);
  expect((await bobApi.raw('POST', `/api/me/mcp/servers/${serverId}/connect/start`, { port: 50000, ds: 'd'.repeat(16) })).status).toBe(409); // 가져오기 전 = needs_import
  ({ app, win } = await launchDesktop({ as: bob }));
  await captureBrowser(app);
  await goHash(win, '#/connections');
  const list = win.getByRole('list', { name: '가져올 수 있는 앱 목록' });
  const item = list.locator('li').filter({ hasText: NAME });
  await expect(item).toContainText(SPACE);
  await expect(item).toContainText(`${alice.display_name} 님이 공유함`);
  await win.screenshot({ path: shot('desktop-mcp-importable'), animations: 'disabled' });
  await item.getByRole('button', { name: `${NAME} 가져오기` }).click();
  await expect(row(NAME).locator('.app-src')).toHaveText('가져옴');
  await expect(list.locator('li').filter({ hasText: NAME })).toHaveCount(0);

  await disconnect(bobApi, serverId); // 같은 주소를 전에 연결했으면 끊고 시작
  await expect(async () => {
    await goHash(win, '#/chat');
    await goHash(win, '#/connections');
    await expect(row(NAME).locator('.app-state')).toHaveText('연결 필요', { timeout: 2000 });
  }).toPass();
  await fakeMcp('account', { name: 'bob' }); // 가짜 제공자에서 bob 으로 로그인
  const before = await openedCount(app);
  await row(NAME).getByRole('button', { name: `${NAME} 연결` }).click();
  await followLogin(await nextOpened(app, before));
  await expect(row(NAME).locator('.app-state')).toHaveText('연결됨');
  // 공유한 alice 는 여전히 연결 안 됨 (인증정보는 나누지 않는다)
  expect((await myApps(aliceApi)).mine.find((a) => a.id === serverId)?.connection).toBe('needs_login');
});

test('B 가 대화에서 쓰면 mock 이 받은 토큰 = bob 계정 (alice 토큰 아님)', async () => {
  test.setTimeout(60_000);
  const handle = (await myApps(bobApi)).mine.find((a) => a.id === serverId)!.handle;
  await goHash(win, '#/chat');
  await win.getByRole('button', { name: '새 대화' }).click();
  const before = (await mcpState()).calls.length;
  await ask(win, `[fake:app ${handle} viewer signed-in account] [fake:tool ${handle}__get_viewer] 나 누구야`);
  await expect(chat(win).last).toContainText('bob', { timeout: 25_000 });
  await idle(win);
  const calls = (await mcpState()).calls.slice(before);
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every((c) => c.account === 'bob')).toBe(true);
});

test('A 가 공유를 끊으면 B 목록에서 공유가 끊겼어요 (쓸 수 없음)', async () => {
  await aliceApi.del(`/api/me/mcp/servers/${serverId}/shares?scope_kind=space&scope_id=${spaceId}`);
  await goHash(win, '#/connections');
  await expect(async () => {
    await goHash(win, '#/chat');
    await goHash(win, '#/connections');
    await expect(row(NAME).locator('.app-state')).toHaveText('공유가 끊겼어요', { timeout: 2000 });
  }).toPass();
  const mine = (await myApps(bobApi)).mine.find((a) => a.id === serverId);
  expect(mine).toMatchObject({ share_lost: true, usable: false });
  await win.screenshot({ path: shot('desktop-mcp-share-lost'), animations: 'disabled' });
  // 상세는 더 못 본다 (정의도 안 보인다) · 목록에서 빼기만
  await row(NAME).getByRole('button', { name: `${NAME} 자세히` }).click();
  const sheet = win.getByRole('dialog', { name: NAME });
  await expect(sheet).toContainText('공유가 끊겨 지금은 쓸 수 없어요');
  await sheet.getByRole('button', { name: '목록에서 빼기' }).click();
  await expect(sheet).toBeHidden();
  await expect(row(NAME)).toHaveCount(0);
  expect((await myApps(bobApi)).mine.some((a) => a.id === serverId)).toBe(false);
});
