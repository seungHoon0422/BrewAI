import { test, expect, type Page } from '@playwright/test';
import { adminApi, userApi, type Client } from './auth';
import { separatorsOnScreen } from './copy-rule';
import { MCP } from './env';
import { overflowX, shot } from './helpers';

// 관리자 '카탈로그 › MCP 서버' (slice 05 · ADR-0013). 가짜 MCP = e2e/mock/mcp.mjs:
//   notes   = MCP/noauth/mcp · 로그인 없음 · 도구 4개 (쓰기 1: add_note)
//   tracker = MCP/mcp · OAuth (DCR · 자동 허용 · 계정 alice) · 도구 30개 (쓰기 12)
// 관리자가 추가 = 전체 공통 (install 공유) · 도구 수 · 예상 토큰 = conductor 가 받은 도구 목록. OAuth 서버는 누군가 로그인한 뒤에 보인다.
// 쓰기 도구 = 지금 바로 허용 (표시만 · 승인 카드는 slice 07). 인증정보는 개수만 (연결한 사람 수 · has_secret).
// 바꾼 정책 · 연결은 테스트 끝에 되돌린다 (같은 conductor 를 뒤 스펙도 쓴다)
const COLS = ['이름', '도메인', '로그인 방식', '도구 수', '예상 토큰', '연결한 사람 수', '상태', '연결 테스트'];
const USER_COLS = ['이름', '주인', '도메인', '로그인 방식', '도구 수', '공유', '연결한 사람 수', '사용'];
const NOTES = { url: `${MCP}/noauth/mcp`, name: 'E2E 노트', desc: '메모 저장과 검색' };
const TRACKER = { url: `${MCP}/mcp`, name: 'E2E 트래커' };

const tabs = (page: Page) => page.getByRole('tablist', { name: '카탈로그 종류' });
const table = (page: Page) => page.getByRole('table', { name: 'MCP 서버 목록' });
const rowOf = (page: Page, name: string) => table(page).getByRole('row').filter({ hasText: name });
const part = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const tools = (page: Page) => page.getByRole('table', { name: '도구 목록' });
const toolRow = (page: Page, title: string) => tools(page).getByRole('row').filter({ has: page.getByRole('rowheader').filter({ hasText: title }) });
const toast = (page: Page, text: string | RegExp) => page.getByRole('region', { name: '알림' }).getByText(text);
const h1 = (page: Page) => page.getByRole('heading', { level: 1 });

type Server = { id: string; url: string; origin: string; tool_count: number | null; connected_count?: number };
let admin: Client;
let me: Awaited<ReturnType<typeof userApi>>; // 관리자 계정의 사용자 API (데스크톱처럼 Bearer) — 자기 계정으로 tracker 로그인

// 데스크톱 앱 대신 loopback handoff 를 그대로 밟는다: start → 제공자(자동 허용) → conductor 콜백 → 302 loopback ?code=bwm_ → complete
async function connect(user: Client, serverId: string) {
  const ds = `e2e-admin-${Date.now().toString(36)}`;
  const { authorize_url } = await user.post<{ authorize_url: string }>(`/api/me/mcp/servers/${serverId}/connect/start`, { port: 45999, ds });
  const toProvider = await fetch(authorize_url, { redirect: 'manual' });
  expect(toProvider.status).toBe(302);
  const callback = new URL(toProvider.headers.get('location')!, authorize_url);
  const toLoopback = await fetch(callback, { redirect: 'manual' });
  expect(toLoopback.status).toBe(302);
  const loop = new URL(toLoopback.headers.get('location')!);
  expect(loop.host).toBe('127.0.0.1:45999');
  const code = loop.searchParams.get('code');
  expect(code, loop.search).toMatch(/^bwm_/);
  await user.post(`/api/me/mcp/servers/${serverId}/connect/complete`, { code, ds });
}

async function adminServers() {
  return admin.get<Server[]>('/api/admin/mcp/servers');
}

test.beforeAll(async () => {
  admin = await adminApi();
  me = await userApi();
  // 같은 실행의 앞 스펙이 같은 주소를 관리자 서버로 넣어 뒀으면 지운다 (관리자 서버는 주소마다 하나)
  for (const s of await adminServers()) {
    if (s.url === NOTES.url || s.url === TRACKER.url) await admin.del(`/api/admin/mcp/servers/${s.id}`);
  }
});

test.afterAll(async () => {
  await admin.patch('/api/admin/mcp/policy', { allow_user_servers: true, url_allowlist: [] });
});

// 추천 서버 = e2e/mock/mcp-presets.json (CONDUCTOR_MCP_PRESETS · 가짜 MCP 주소만). 누르면 칸만 채운다 (추가는 사람이)
const PRESET = {
  pick: { name: 'E2E 추천 트래커', url: `${MCP}/mcp`, handle: 'e2e_tracker', desc: '팀 이슈와 프로젝트를 다뤄요' },
  added: { name: 'E2E 이미 추가한 메모', url: `${MCP}/noauth/mcp?preset=added` },
  off: { name: 'E2E 키 전용', reason: 'API 키로만 연결돼요, API 키 방식은 아직 지원하지 않아요' },
};

test('추천 서버: 목록 · 누르면 칸 채우기 · 못 쓰는 서버는 이유와 함께 막힘 · 이미 추가한 서버 = 추가됨', async ({ page }) => {
  const added = await admin.post<Server>('/api/admin/mcp/servers', { url: PRESET.added.url, name: PRESET.added.name });
  try {
    await page.goto('/#/catalog');
    await page.getByRole('button', { name: 'MCP 서버 추가' }).first().click();
    const dlg = page.getByRole('dialog', { name: 'MCP 서버 추가' });
    const presets = dlg.getByRole('region', { name: '추천 서버' });
    const list = presets.getByRole('list', { name: '추천 서버 목록' });
    await expect(list.getByRole('listitem')).toHaveCount(4);
    const item = (name: string) => list.getByRole('button', { name: new RegExp(name) });
    // 이미 추가 = 추가됨 + 누를 수 없음 · 못 씀 = 이유 + 누를 수 없음 · 순서 = 쓸 수 있는 것 → 추가됨 → 못 씀
    await expect(item(PRESET.added.name)).toContainText('추가됨');
    await expect(item(PRESET.added.name)).toBeDisabled();
    await expect(item(PRESET.off.name)).toContainText(PRESET.off.reason);
    await expect(item(PRESET.off.name)).toContainText('API 키 필요');
    await expect(item(PRESET.off.name)).toBeDisabled();
    await expect(list.locator('.mcp-preset-name')).toHaveText(['E2E 추천 메모', PRESET.pick.name, PRESET.added.name, PRESET.off.name]);
    await expect(item('E2E 추천 메모')).toContainText('로그인 없음');
    await expect(item(PRESET.pick.name)).toContainText('로그인 필요');
    // 누르면 주소 · 이름 · 설명 · 부르는 이름을 채운다 (저장은 안 함)
    await item(PRESET.pick.name).click();
    await expect(item(PRESET.pick.name)).toHaveAttribute('aria-pressed', 'true');
    await expect(dlg.getByRole('textbox', { name: '주소' })).toHaveValue(PRESET.pick.url);
    await expect(dlg.getByRole('textbox', { name: '이름', exact: true })).toHaveValue(PRESET.pick.name);
    await expect(dlg.getByRole('textbox', { name: '에이전트가 읽는 한 줄 설명' })).toHaveValue(PRESET.pick.desc);
    await expect(dlg.getByRole('textbox', { name: '부르는 이름' })).toHaveValue(PRESET.pick.handle);
    await expect(dlg.locator('.mcp-preset-picked')).toContainText(`${PRESET.pick.name}을(를) 골랐어요`);
    // 주소를 고치면 고른 상태가 풀리고 추천이 채운 부르는 이름도 지운다 (다른 서버에 붙지 않게)
    await dlg.getByRole('textbox', { name: '주소' }).fill(`${MCP}/mcp?other=1`);
    await expect(dlg.getByRole('textbox', { name: '부르는 이름' })).toHaveValue('');
    await expect(dlg.locator('.mcp-preset-picked')).toHaveCount(0);
    // 키보드: Shift+Tab 으로 앞 추천 줄(위 = 다시 고른 트래커 → 메모)에 가서 Enter = 고르기
    await item(PRESET.pick.name).click();
    await expect(item(PRESET.pick.name)).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(item('E2E 추천 메모')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dlg.getByRole('textbox', { name: '주소' })).toHaveValue(`${MCP}/noauth/mcp?preset=pick`);
    expect(await separatorsOnScreen(page), 'preset picker').toEqual([]);
    await page.screenshot({ path: shot('admin-mcp-presets') });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: shot('admin-mcp-presets-dark'), animations: 'disabled' });
    await page.emulateMedia({ colorScheme: 'light' });
    await dlg.getByRole('button', { name: '취소' }).click();
    expect((await adminServers()).some((x) => x.url === PRESET.pick.url)).toBe(false); // 누르기만 = 추가 안 됨
  } finally {
    await admin.del(`/api/admin/mcp/servers/${added.id}`);
  }
});

test('MCP 서버 탭: 표 머리 · 추가 (로그인 없음) → 찾은 내용 = 도구 4개 쓰기 1개 + 예상 토큰 → 표 · 연결 테스트', async ({ page }) => {
  await page.goto('/#/catalog');
  await expect(tabs(page).getByRole('tab')).toHaveText(['MCP 서버', '사용자 추가 서버', 'Skill']);
  await expect(tabs(page).getByRole('tab', { name: 'MCP 서버', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(table(page).getByRole('columnheader')).toHaveText(COLS);

  await page.getByRole('button', { name: 'MCP 서버 추가' }).first().click();
  const dlg = page.getByRole('dialog', { name: 'MCP 서버 추가' });
  await dlg.getByRole('textbox', { name: '주소' }).fill(NOTES.url);
  await dlg.getByRole('textbox', { name: '이름', exact: true }).fill(NOTES.name);
  await dlg.getByRole('textbox', { name: '에이전트가 읽는 한 줄 설명' }).fill(NOTES.desc);
  await dlg.getByRole('textbox', { name: '찾을 때 쓸 말' }).fill('노트, 메모');
  expect(await separatorsOnScreen(page), 'add dialog').toEqual([]);
  await dlg.getByRole('button', { name: '찾아서 추가' }).click();

  const done = page.getByRole('dialog', { name: '추가했어요' });
  await expect(done).toContainText('로그인 없음');
  await expect(done).toContainText('4개, 쓰기 1개');
  await expect(done.locator('.mcp-write')).toHaveText('쓰기');
  await expect(done).toContainText(/약 \d+토큰/);
  await expect(done.locator('.mcp-line-code')).toContainText(`(${NOTES.name}): ${NOTES.desc} [연결됨]`);
  expect(await separatorsOnScreen(page), 'added dialog').toEqual([]);
  await page.screenshot({ path: shot('admin-mcp-added') });
  await done.getByRole('button', { name: '닫기' }).first().click();

  const row = rowOf(page, NOTES.name);
  await expect(row).toContainText('127.0.0.1');
  await expect(row).toContainText('로그인 없음');
  await expect(row).toContainText('4');
  await expect(row).toContainText('쓰기 1개');
  await expect(row).toContainText(/약 \d+/);
  await expect(row).toContainText('0명');
  await expect(row.locator('.mcp-status')).toHaveText('사용 중');
  await row.getByRole('button', { name: `${NOTES.name} 연결 테스트` }).click();
  await expect(row.locator('.mcp-hl')).toContainText('정상');
  await expect(row.locator('.mcp-hl')).toContainText('도구 4개');
  expect(await separatorsOnScreen(page), 'mcp table').toEqual([]);
  await page.screenshot({ path: shot('admin-mcp-list'), fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: shot('admin-mcp-list-dark'), fullPage: true, animations: 'disabled' }); // 색 전환 중간이 찍히지 않게
  await page.emulateMedia({ colorScheme: 'light' });

  // 같은 주소 다시 = 이미 추가한 주소
  await page.getByRole('button', { name: 'MCP 서버 추가' }).first().click();
  await dlg.getByRole('textbox', { name: '주소' }).fill(NOTES.url);
  await dlg.getByRole('button', { name: '찾아서 추가' }).click();
  await expect(toast(page, '이미 추가한 주소예요')).toBeVisible();
  await dlg.getByRole('button', { name: '취소' }).click();
  // https 가 아닌 바깥 주소 = 막힘 (loopback 만 E2E 허용)
  await page.getByRole('button', { name: 'MCP 서버 추가' }).first().click();
  await dlg.getByRole('textbox', { name: '주소' }).fill('http://example.com/mcp');
  await dlg.getByRole('button', { name: '찾아서 추가' }).click();
  await expect(toast(page, 'https 주소만 쓸 수 있어요')).toBeVisible();
  await dlg.getByRole('button', { name: '취소' }).click();
});

test('자세히 페이지: 에이전트가 보는 줄 + 토큰 · 도구 표 (쓰기 표시 · 숨김 · 바로 실행) · 정보 저장 · 끄기 · 삭제', async ({ page }) => {
  const s = (await adminServers()).find((x) => x.url === NOTES.url)!;
  await page.goto('/#/catalog');
  await rowOf(page, NOTES.name).getByRole('link', { name: NOTES.name }).click();
  await expect(page).toHaveURL(new RegExp(`#/catalog/mcp/${s.id}$`));
  await expect(h1(page)).toHaveText([NOTES.name]);
  await expect(page.getByRole('link', { name: 'MCP 서버' })).toHaveAttribute('href', '#/catalog');

  const line = part(page, '에이전트가 보는 목록');
  await expect(line.locator('.mcp-line-code')).toContainText(`(${NOTES.name}): ${NOTES.desc} [연결됨]`);
  await expect(line).toContainText(/약 \d+토큰/);
  await expect(line).toContainText('대화마다');

  await expect(tools(page).getByRole('columnheader')).toHaveText(['도구', '설명', '예상 토큰', '숨김', '바로 실행', '항상 같이 열기']);
  await expect(tools(page).locator('tbody tr')).toHaveCount(4);
  await expect(toolRow(page, 'Add Note').locator('.mcp-write')).toHaveText('쓰기');
  await expect(toolRow(page, 'Echo').locator('.mcp-write')).toHaveCount(0);
  expect(await separatorsOnScreen(page), 'detail').toEqual([]);
  await page.screenshot({ path: shot('admin-mcp-detail'), fullPage: true });

  // 숨김 → 서버에 mode hidden · 바로 실행은 꺼져 못 누름 → 되돌림
  const hide = page.getByRole('switch', { name: 'Echo 숨김' });
  await hide.click();
  await expect(toast(page, 'Echo: 숨김')).toBeVisible();
  await expect(hide).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('switch', { name: 'Echo 바로 실행' })).toBeDisabled();
  let list = await admin.get<{ tools: { name: string; mode: string }[] }>(`/api/admin/mcp/servers/${s.id}/tools`);
  expect(list.tools.find((t) => t.name === 'echo')?.mode).toBe('hidden');
  await hide.click();
  await expect(hide).toHaveAttribute('aria-checked', 'false');

  // 바로 실행 끔 = approval 로 저장만 (승인 카드 07 전) → 딱지 → 되돌림
  const auto = page.getByRole('switch', { name: 'Add Note 바로 실행' });
  await expect(auto).toHaveAttribute('aria-checked', 'true');
  await auto.click();
  await expect(toolRow(page, 'Add Note')).toContainText('승인 필요 (07부터)');
  list = await admin.get(`/api/admin/mcp/servers/${s.id}/tools`);
  expect(list.tools.find((t) => t.name === 'add_note')?.mode).toBe('approval');
  await auto.click();
  await expect(auto).toHaveAttribute('aria-checked', 'true');

  // 정보: 한 줄 설명을 바꾸면 에이전트가 보는 줄도 바뀐다 · 주소는 못 바꾼다
  const info = part(page, '정보');
  await expect(info.getByRole('textbox', { name: '주소' })).toHaveAttribute('readonly', '');
  await info.getByRole('textbox', { name: '에이전트가 읽는 한 줄 설명' }).fill('메모를 저장하고 찾아요');
  await info.getByRole('button', { name: '저장' }).click();
  await expect(toast(page, '저장했어요')).toBeVisible();
  await expect(line.locator('.mcp-line-code')).toContainText('메모를 저장하고 찾아요');

  // 끄기 → 꺼짐 → 켜기
  const use = page.getByRole('switch', { name: '사용' });
  await use.click();
  await expect(page.locator('.mcp-head .mcp-status')).toHaveText('꺼짐');
  await use.click();
  await expect(page.locator('.mcp-head .mcp-status')).toHaveText('사용 중');

  // 연결 테스트 (머리)
  await page.getByRole('button', { name: '연결 테스트', exact: true }).click();
  await expect(page.locator('.mcp-head .mcp-hl')).toContainText('도구 4개');

  // 삭제 → 목록으로 · 줄 없음
  await page.getByRole('button', { name: '삭제', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: `${NOTES.name}을(를) 삭제할까요?` });
  await confirm.getByRole('button', { name: '삭제' }).click();
  await expect(page).toHaveURL(/#\/catalog$/);
  await expect(toast(page, `${NOTES.name}을(를) 삭제했어요`)).toBeVisible();
  await expect(rowOf(page, NOTES.name)).toHaveCount(0);
  // 없는 서버 주소 = 안내
  await page.goto(`/#/catalog/mcp/${s.id}`);
  await expect(h1(page)).toHaveText(['없는 MCP 서버']);
});

test('OAuth 서버: 추가 = 도구는 로그인 뒤 → 관리자 본인이 연결하면 30개 쓰기 12개 · 쓰기 표시 · 사전 등록 client (secret 은 안 보임)', async ({ page }) => {
  await page.goto('/#/catalog');
  await page.getByRole('button', { name: 'MCP 서버 추가' }).first().click();
  const dlg = page.getByRole('dialog', { name: 'MCP 서버 추가' });
  await dlg.getByRole('textbox', { name: '주소' }).fill(TRACKER.url);
  await dlg.getByRole('textbox', { name: '이름', exact: true }).fill(TRACKER.name);
  await dlg.getByRole('button', { name: '찾아서 추가' }).click();
  const done = page.getByRole('dialog', { name: '추가했어요' });
  await expect(done).toContainText('OAuth');
  await expect(done).toContainText('로그인 뒤에 보여요');
  await expect(done.locator('.mcp-line-code')).toContainText('[연결 필요]');
  await done.getByRole('button', { name: '닫기' }).first().click();

  const row = rowOf(page, TRACKER.name);
  await expect(row).toContainText('OAuth');
  await expect(row).toContainText('로그인 뒤');
  await row.getByRole('button', { name: `${TRACKER.name} 연결 테스트` }).click();
  await expect(row.locator('.mcp-hl')).toContainText('응답 정상, 도구는 로그인 뒤');

  // 관리자 본인이 (데스크톱처럼) 자기 계정으로 연결 → 도구 목록이 생긴다
  const s = (await adminServers()).find((x) => x.url === TRACKER.url)!;
  // 연결한 사람 수 = 이 주소(resource)의 인증정보 수. 같은 실행의 데스크톱 스펙(mcp-share 의 bob 등)이 남긴 연결도 센다 → 앞 + 1
  const people = `${(s.connected_count ?? 0) + 1}명`;
  await connect(me, s.id);
  await page.reload();
  await expect(row).toContainText('30');
  await expect(row).toContainText('쓰기 12개');
  await expect(row).toContainText(people);
  await row.getByRole('button', { name: `${TRACKER.name} 연결 테스트` }).click();
  await expect(row.locator('.mcp-hl')).toContainText('도구 30개');

  await row.getByRole('link', { name: TRACKER.name }).click();
  await expect(h1(page)).toHaveText([TRACKER.name]);
  await expect(tools(page).locator('tbody tr')).toHaveCount(30);
  await expect(tools(page).locator('.mcp-write')).toHaveCount(12);
  await expect(toolRow(page, 'Create Issue').locator('.mcp-write')).toHaveText('쓰기');
  await expect(toolRow(page, 'List Issues').locator('.mcp-write')).toHaveCount(0);
  await expect(part(page, '연결')).toContainText(people);

  // 사전 등록 client: 지금 = 자동 등록(DCR) → 같은 client ID 에 비밀값을 넣어 저장 → '비밀값 저장됨' (값은 어디에도 안 보임)
  const client = part(page, '사전 등록 OAuth client');
  await expect(client).toContainText('자동 등록 (DCR)');
  const dcrId = (await client.locator('code').first().textContent())!.trim();
  await client.getByRole('textbox', { name: 'client ID' }).fill(dcrId);
  await client.getByLabel('client secret').fill('e2e-client-secret-not-real');
  await client.getByRole('button', { name: 'client 저장' }).click();
  await expect(toast(page, 'OAuth client 를 저장했어요')).toBeVisible();
  await expect(client).toContainText('사전 등록');
  await expect(client).toContainText('비밀값 저장됨');
  await expect(client.getByLabel('client secret')).toHaveValue('');
  expect(await page.content()).not.toContain('e2e-client-secret-not-real');
  const raw = JSON.stringify(await admin.get(`/api/admin/mcp/servers/${s.id}`));
  expect(raw).not.toContain('e2e-client-secret-not-real');
  expect(await separatorsOnScreen(page), 'oauth detail').toEqual([]);
  await page.screenshot({ path: shot('admin-mcp-oauth-detail'), fullPage: true });

  // 되돌리기: 공개 client 로 (mock 이 아는 같은 client ID) · 연결 끊기
  await admin.put(`/api/admin/mcp/servers/${s.id}/oauth-client`, { client_id: dcrId, auth_method: 'none' });
  await me.del(`/api/me/mcp/servers/${s.id}/connection`);
});

test('사용자 추가 서버 탭: 주인 · 공유 수 · 연결한 사람 수 (인증정보 없음) · 하나 끄기 · 정책 (추가 허용 · 주소 허용 목록)', async ({ page }) => {
  // 사용자(관리자 계정의 사용자 API) 가 데스크톱에서 추가한 서버 하나
  const created = await me.raw('POST', '/api/me/mcp/servers', { url: NOTES.url, name: 'E2E 내 노트' });
  expect([201, 409]).toContain(created.status); // 409 = 같은 실행의 앞 스펙이 이미 넣어 둠 (이름이 다를 수 있다)
  type UserServer = Server & { name: string; owner_user_id: string | null; owner_name: string };
  const mine = (await admin.get<UserServer[]>('/api/admin/mcp/user-servers')).find((x) => x.url === NOTES.url && x.owner_user_id === me.me.id)!;
  expect(mine.owner_name).toBe(me.me.display_name);

  await page.goto('/#/catalog/user-servers');
  await expect(tabs(page).getByRole('tab', { name: '사용자 추가 서버' })).toHaveAttribute('aria-selected', 'true');
  const users = page.getByRole('table', { name: '사용자 추가 서버 목록' });
  await expect(users.getByRole('columnheader')).toHaveText(USER_COLS);
  const row = users.getByRole('row').filter({ has: page.getByRole('link', { name: mine.name, exact: true }) });
  await expect(row).toContainText(me.me.display_name);
  await expect(row).toContainText('0명');
  // 끄기 → 켜기
  const sw = row.getByRole('switch');
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  // 자세히 = 읽기 전용 (정보 입력칸 없음 · 삭제 없음) · 돌아가기 = 이 탭
  await row.getByRole('link').first().click();
  await expect(page.locator('.mcp-head .mcp-origin')).toHaveText('사용자 추가');
  await expect(part(page, '정보').getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '삭제', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '사용자 추가 서버' })).toHaveAttribute('href', '#/catalog/user-servers');
  await page.getByRole('link', { name: '사용자 추가 서버' }).click();

  // 정책: 사용자 추가 막기 → 사용자 미리 확인 = 403 → 다시 허용
  const policy = part(page, '사용자 추가 정책');
  const allow = policy.getByRole('switch', { name: '사용자가 MCP 서버를 추가할 수 있어요' });
  await expect(allow).toHaveAttribute('aria-checked', 'true');
  await allow.click();
  await expect(toast(page, '사용자 추가를 막았어요')).toBeVisible();
  const blocked = await me.raw('POST', '/api/me/mcp/servers/preview', { url: NOTES.url });
  expect(blocked.status).toBe(403);
  await allow.click();
  await expect(allow).toHaveAttribute('aria-checked', 'true');
  // 주소 허용 목록 저장 · 틀린 모양 = 안내 · 비우기
  const box = policy.getByRole('textbox', { name: '주소 허용 목록' });
  await box.fill('linear.app, *.example.com');
  await policy.getByRole('button', { name: '허용 목록 저장' }).click();
  await expect(toast(page, '주소 허용 목록을 저장했어요')).toBeVisible();
  expect((await admin.get<{ url_allowlist: string[] }>('/api/admin/mcp/policy')).url_allowlist).toEqual(['linear.app', '*.example.com']);
  await box.fill('https://bad/');
  await policy.getByRole('button', { name: '허용 목록 저장' }).click();
  await expect(toast(page, /허용 목록 형식이 맞지 않아요/)).toBeVisible();
  await box.fill('');
  await policy.getByRole('button', { name: '허용 목록 저장' }).click();
  await expect.poll(async () => (await admin.get<{ url_allowlist: string[] }>('/api/admin/mcp/policy')).url_allowlist).toEqual([]);
  expect(await separatorsOnScreen(page), 'user servers').toEqual([]);
  // 스크린샷 = 알림 · 저장 중 상태가 없는 새 화면
  await page.reload();
  await expect(row).toContainText(me.me.display_name);
  await expect(allow).toBeEnabled();
  await expect(allow).toHaveAttribute('aria-checked', 'true');
  await page.screenshot({ path: shot('admin-mcp-user-servers'), fullPage: true });
  if (created.status === 201) await me.del(`/api/me/mcp/servers/${mine.id}`);
});

test.describe('폰 폭 390px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('MCP 탭 · 사용자 추가 서버 탭 · 자세히가 가로로 넘치지 않는다', async ({ page }) => {
    for (const hash of ['catalog', 'catalog/user-servers']) {
      await page.goto(`/#/${hash}`);
      await expect(page.getByRole('tabpanel')).toBeVisible();
      await expect.poll(() => overflowX(page), { message: hash }).toBeLessThanOrEqual(0);
    }
    // 추가 대화상자 (추천 서버 목록 포함) 도 넘치지 않는다
    await page.goto('/#/catalog');
    await page.getByRole('button', { name: 'MCP 서버 추가' }).first().click();
    await expect(page.getByRole('region', { name: '추천 서버' })).toBeVisible();
    await expect.poll(() => overflowX(page), { message: 'add dialog' }).toBeLessThanOrEqual(0);
    await page.screenshot({ path: shot('admin-mcp-presets-phone') });
    await page.getByRole('dialog', { name: 'MCP 서버 추가' }).getByRole('button', { name: '취소' }).click();
    const s = (await adminServers()).find((x) => x.url === TRACKER.url);
    if (s) {
      await page.goto(`/#/catalog/mcp/${s.id}`);
      await expect(h1(page)).toHaveText([TRACKER.name]);
      await expect.poll(() => overflowX(page), { message: 'detail' }).toBeLessThanOrEqual(0);
      await page.screenshot({ path: shot('admin-mcp-phone'), fullPage: true });
    }
  });
});
