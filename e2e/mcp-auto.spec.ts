import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { adminApi, launchDesktop, poolUser, userApi, type Client, type NewUser } from './auth';
import { separatorsOnScreen } from './copy-rule';
import { GATEWAY, GATEWAY_KEY } from './env';
import { expectHeading, goHash, shot } from './helpers';
import {
  NOTES_URL, ask, captureBrowser, chat, chatRecords, clearRecord, disconnect, ensureTracker, fakeMcp, followLogin, idle, mcpState, myApps,
  nextOpened, openedCount, type AdminServer,
} from './mcp';

// 관리자가 넣은 전체 공통 앱이 일반 사용자에게 어떻게 가는지 (사용자가 아무것도 누르지 않은 상태에서 시작)
//   로그인 없음 = 연결을 누르지 않아도 대화에서 바로 · 주소의 키(?tavilyApiKey=…)는 화면 · 응답 · 모델 요청 어디에도 없다 (*** 로 가림)
//   OAuth = 대화에 로그인 카드 → 로그인 → 같은 대화에서 결과 · 그 뒤 새 대화는 카드 없이 그 사람 계정(가짜 MCP 계정 mina)으로 바로
//   같은 주소 (내가 추가 + 전체 공통) = 연결된 앱에 하나만 · 도구를 못 쓰는 모델 = 모델 메뉴에 '앱과 스킬 없이 답해요'
// 사용자 = 테스트 사용자 '일반 멤버' (관리자 아님). 바꾼 것(서버 · 연결 · 설정 · mock 카탈로그)은 끝에 되돌린다 (같은 conductor 를 뒤 스펙도 쓴다)
const HOME_H1 = '무엇을 맡길까요?';
const KEY = 'e2e-tavily-key-NOT-REAL-4f2a'; // 가짜 키 (가짜 MCP 는 query 를 보지 않는다)
const SEARCH = { url: `${NOTES_URL}?tavilyApiKey=${KEY}`, name: 'E2E 검색', handle: 'e2e_search' };
const DUP = { url: `${NOTES_URL}?space=dup`, own: 'E2E 내 메모', common: 'E2E 공통 메모', added: 'E2E 새로 넣은 메모' };
const MCP_ACCOUNT = 'mina'; // 이 사람이 가짜 MCP 에 로그인하는 계정 (도구 호출이 이 계정으로 갔는지)

test.describe.configure({ mode: 'serial' });
let admin: Client;
let api: Client;
let member: NewUser;
let tracker: AdminServer;
let search: AdminServer;
let app: ElectronApplication;
let win: Page;

const row = (name: string) => win.getByRole('list', { name: '내 앱 목록' }).locator('li.conn-app').filter({ has: win.getByText(name, { exact: true }) });
const authCard = () => chat(win).cards.filter({ has: win.locator('.ac-title') }).last();
const handleOf = async (id: string) => (await myApps(api)).mine.find((a) => a.id === id)?.handle ?? '';

async function newChat() {
  await win.getByRole('button', { name: '새 대화' }).click();
  await expectHeading(win, HOME_H1);
}
async function fakeCatalog(body: object) {
  const res = await fetch(`${GATEWAY}/__fake/catalog`, {
    method: 'POST', headers: { authorization: `Bearer ${GATEWAY_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  expect(res.ok).toBe(true);
}
// 앞 실행이 남긴 이 스펙의 서버 (관리자 목록 주소는 가려서 온다 → 이름으로)
async function cleanup() {
  for (const s of await admin.get<AdminServer[]>('/api/admin/mcp/servers')) {
    if (s.name === SEARCH.name || s.name === DUP.common) await admin.del(`/api/admin/mcp/servers/${s.id}`);
  }
  for (const a of (await myApps(api)).mine.filter((x) => x.source === 'own')) await api.del(`/api/me/mcp/servers/${a.id}`);
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  admin = await adminApi();
  member = await poolUser('member');
  api = await userApi(member);
  await cleanup();
  tracker = await ensureTracker(admin);
  await disconnect(api, tracker.id);
  await api.patch('/api/me/settings', { auto_auth: 'unset' });
  await fakeMcp('account', { name: MCP_ACCOUNT });
  search = await admin.post<AdminServer>('/api/admin/mcp/servers', { url: SEARCH.url, name: SEARCH.name, handle: SEARCH.handle, description: '웹 검색' });
  ({ app, win } = await launchDesktop({ as: member }));
  await captureBrowser(app);
  await expectHeading(win, HOME_H1);
});
test.afterAll(async () => {
  await app?.close();
  await fakeCatalog({ reset: true });
  if (admin) await admin.post('/api/admin/models/sync', {});
  if (api) {
    if (tracker) await disconnect(api, tracker.id);
    await api.patch('/api/me/settings', { auto_auth: 'unset' });
    await cleanup();
  }
  await fakeMcp('account', { name: 'alice' });
});

test('전체 공통 앱 (로그인 없음) = 연결을 누르지 않아도 연결됨 · 주소의 키는 *** 로만 보인다', async () => {
  // 관리자 응답도 가린 주소 (원래 주소는 호출에만)
  expect(search.url).toBe(`${NOTES_URL}?tavilyApiKey=***`);
  const list = await myApps(api);
  expect(JSON.stringify(list)).not.toContain(KEY);
  const mine = list.mine.find((a) => a.id === search.id)!;
  expect([mine.source, mine.connection, mine.usable]).toEqual(['install', 'none', true]);

  await goHash(win, '#/connections');
  await expectHeading(win, '연결된 앱');
  const r = row(SEARCH.name);
  await expect(r.locator('.app-src')).toHaveText('전체 공통');
  await expect(r.locator('.app-state')).toHaveText('연결됨');
  await expect(r.getByRole('button', { name: `${SEARCH.name} 연결` })).toHaveCount(0); // 누를 것 없음
  const tr = row(tracker.name);
  await expect(tr.locator('.app-state')).toHaveText('연결 필요'); // OAuth 공통 앱 = 대화에서 처음 쓸 때 로그인 (아래)
  expect(await separatorsOnScreen(win)).toEqual([]);
  await win.screenshot({ path: shot('desktop-mcp-auto-common'), animations: 'disabled' });

  await r.getByRole('button', { name: `${SEARCH.name} 자세히` }).click();
  const sheet = win.getByRole('dialog', { name: SEARCH.name });
  await expect(sheet).toContainText(`${NOTES_URL}?tavilyApiKey=***`);
  expect(await win.content()).not.toContain(KEY);
  await win.screenshot({ path: shot('desktop-mcp-auto-masked'), animations: 'disabled' });
  await sheet.getByRole('button', { name: '닫기' }).first().click();
  await expect(sheet).toBeHidden();
});

test('대화: 전체 공통 앱을 연결 없이 바로 쓴다 · 모델 요청에도 키 없음', async () => {
  test.setTimeout(90_000);
  const h = await handleOf(search.id);
  expect(h).toBe(SEARCH.handle);
  clearRecord();
  await goHash(win, '#/');
  await newChat();
  const before = (await mcpState()).calls.length;
  await ask(win, `[fake:app ${h} 메모 검색] [fake:tool ${h}__search_notes {"query":"회의"}] 자동 회의 메모 찾아줘`);
  await expect(chat(win).last).toContainText('앱 결과를 받았어요', { timeout: 25_000 });
  await idle(win);
  await expect(win.locator('.app-card[data-card]')).toHaveCount(0); // 로그인 카드 없음
  const calls = (await mcpState()).calls.slice(before);
  expect(calls.map((c) => [c.server, c.tool])).toEqual([['notes', 'search_notes']]);
  const sent = JSON.stringify(chatRecords().map((r) => r.body));
  expect(sent).toContain(h); // 앱 목록 한 줄에 실렸다
  expect(sent).not.toContain(KEY); // 지침 · 도구 결과 · 도구 정의 어디에도 키 없음
  expect(await win.content()).not.toContain(KEY);
  expect(await separatorsOnScreen(win)).toEqual([]);
  await win.screenshot({ path: shot('desktop-mcp-auto-chat'), animations: 'disabled' });
});

test('대화: OAuth 전체 공통 앱 = 로그인 카드 → 로그인 → 같은 대화에서 결과 (내 계정) → 새 대화는 카드 없이 바로', async () => {
  test.setTimeout(120_000);
  const h = await handleOf(tracker.id);
  await newChat();
  await ask(win, `[fake:app ${h} 이슈 검색] [fake:tool ${h}__search_issues {"query":"자동"}] 자동 버그 이슈 찾아줘`);
  const card = authCard();
  await expect(card).toHaveAttribute('data-card', 'ask', { timeout: 20_000 });
  await expect(card.locator('.ac-title')).toHaveText(`${tracker.name} 연결이 필요해요`);
  await idle(win);
  expect(await separatorsOnScreen(win)).toEqual([]);
  await win.screenshot({ path: shot('desktop-mcp-auto-auth-card'), animations: 'disabled' });

  const before = await openedCount(app);
  await card.getByRole('button', { name: '켜고 로그인' }).click();
  const back = await followLogin(await nextOpened(app, before));
  expect(back.text).toContain('앱 연결을 마쳤어요');
  await expect(chat(win).last).toContainText('앱 결과를 받았어요', { timeout: 25_000 });
  await idle(win);
  let calls = (await mcpState()).calls;
  expect(calls.at(-1)).toMatchObject({ server: 'tracker', tool: 'search_issues', account: MCP_ACCOUNT }); // 이 사람의 로그인으로
  expect(calls.at(-1)?.token_sha).toBeTruthy();
  await win.screenshot({ path: shot('desktop-mcp-auto-after-login'), animations: 'disabled' });

  // 새 대화 = 카드 없이 바로 (저장된 내 인증정보를 그대로 쓴다)
  await newChat();
  const n = calls.length;
  await ask(win, `[fake:app ${h} 이슈 검색] [fake:tool ${h}__search_issues {"query":"바로"}] 바로 버그 이슈 찾아줘`);
  await expect(chat(win).last).toContainText('앱 결과를 받았어요', { timeout: 25_000 });
  await idle(win);
  await expect(win.locator('.app-card[data-card]')).toHaveCount(0);
  calls = (await mcpState()).calls;
  expect(calls.slice(n).map((c) => [c.tool, c.account])).toEqual([['search_issues', MCP_ACCOUNT]]);
  await win.screenshot({ path: shot('desktop-mcp-auto-direct'), animations: 'disabled' });
});

test('같은 주소 = 연결된 앱에 하나만 (전체 공통이 이긴다 · 부르는 이름 그대로)', async () => {
  const own = await api.post<{ id: string; handle: string }>('/api/me/mcp/servers', { url: DUP.url, name: DUP.own });
  let common: AdminServer | null = null;
  try {
    common = await admin.post<AdminServer>('/api/admin/mcp/servers', { url: DUP.url, name: DUP.common });
    const commonId = common.id;
    const mine = (await myApps(api)).mine;
    expect(mine.filter((a) => a.id === own.id || a.id === commonId).map((a) => [a.id, a.source])).toEqual([[commonId, 'install']]);
    const handle = mine.find((a) => a.id === commonId)!.handle;
    expect(handle).toBe(own.handle); // 내가 쓰던 이름이 공통 줄로 옮겨 간다 (대화에 고정된 이름 · 프롬프트 캐시)
    expect((await myApps(api)).mine.find((a) => a.id === commonId)!.handle).toBe(handle); // 다시 읽어도 같은 이름

    await goHash(win, '#/');
    await goHash(win, '#/connections');
    await expectHeading(win, '연결된 앱');
    await expect(row(DUP.common)).toHaveCount(1);
    await expect(row(DUP.common).locator('.app-src')).toHaveText('전체 공통');
    await expect(row(DUP.common)).toHaveAttribute('data-app', handle);
    await expect(row(DUP.own)).toHaveCount(0);
    expect(await separatorsOnScreen(win)).toEqual([]);
    await win.screenshot({ path: shot('desktop-mcp-auto-dedup'), animations: 'disabled' });
  } finally {
    if (common) await admin.del(`/api/admin/mcp/servers/${common.id}`);
    await api.del(`/api/me/mcp/servers/${own.id}`);
  }
});

test('[앱 추가] 같은 주소의 전체 공통 앱이 있으면 = 추가는 되고 안내 한 줄 · 목록엔 공통 앱 하나', async () => {
  const common = await admin.post<AdminServer>('/api/admin/mcp/servers', { url: DUP.url, name: DUP.common });
  try {
    await goHash(win, '#/');
    await goHash(win, '#/connections');
    await expectHeading(win, '연결된 앱');
    await expect(row(DUP.common)).toHaveCount(1);
    await win.getByRole('button', { name: '앱 추가' }).first().click();
    const dlg = win.getByRole('dialog', { name: '앱 추가' });
    await dlg.getByRole('textbox', { name: '주소' }).fill(DUP.url);
    await dlg.getByRole('textbox', { name: '이름' }).fill(DUP.added);
    await dlg.getByRole('button', { name: '미리 확인' }).click();
    await expect(dlg.getByRole('status', { name: '미리 확인' })).toContainText('로그인 없음');
    await dlg.getByRole('button', { name: '추가', exact: true }).click();
    await expect(dlg).toBeHidden();
    const note = win.locator('.conn-note');
    await expect(note).toContainText(`${DUP.added} 앱은 같은 주소의 전체 공통 앱이 있어서 그 앱 하나로 보여요`);
    await expect(row(DUP.common)).toHaveCount(1);
    await expect(row(DUP.added)).toHaveCount(0);
    const mine = (await myApps(api)).mine;
    expect(mine.filter((a) => a.name === DUP.added || a.id === common.id).map((a) => a.id)).toEqual([common.id]);
    expect(await separatorsOnScreen(win)).toEqual([]);
    await win.screenshot({ path: shot('desktop-mcp-auto-add-merged'), animations: 'disabled' });
  } finally {
    await admin.del(`/api/admin/mcp/servers/${common.id}`);
    for (const a of (await myApps(api)).mine.filter((x) => x.source === 'own')) await api.del(`/api/me/mcp/servers/${a.id}`);
  }
});

test('도구를 못 쓰는 모델 (LiteLLM 이 supports_function_calling 을 안 알려 줌) = 모델 메뉴에 옅은 한 줄', async () => {
  await fakeCatalog({ tools_off: ['fake-chat-small'] });
  try {
    await admin.post('/api/admin/models/sync', {});
    await goHash(win, '#/');
    await newChat();
    await win.locator('.composer .mpick-btn').click();
    const menu = win.getByRole('dialog', { name: '모델과 생각 깊이' });
    const off = menu.locator('.mopt[data-model="fake-chat-small"]');
    await expect(off).toHaveAttribute('data-tools', 'off');
    await expect(off.locator('.mnotools')).toHaveText('앱과 스킬 없이 답해요');
    await expect(off).toHaveAttribute('aria-label', /이 모델로는 앱과 스킬을 쓸 수 없어요/);
    await expect(menu.locator('.mopt[data-model="fake-chat-large"] .mnotools')).toHaveCount(0);
    await expect(menu).not.toContainText('관리자'); // 사용자 앱 = 관리자 말 없음
    expect(await separatorsOnScreen(win)).toEqual([]);
    await win.screenshot({ path: shot('desktop-mcp-auto-model-notools'), animations: 'disabled' });
    await win.keyboard.press('Escape');
  } finally {
    await fakeCatalog({ reset: true });
    await admin.post('/api/admin/models/sync', {});
  }
});
