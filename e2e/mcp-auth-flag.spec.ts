import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { adminApi, launchDesktop, userApi, type Client } from './auth';
import { separatorsOnScreen } from './copy-rule';
import { expectHeading, goHash, shot } from './helpers';
import {
  ask, captureBrowser, chat, connectViaApi, disconnect, ensureTracker, fakeMcp, followLogin, idle, nextOpened, openTrace, openedCount,
  type AdminServer,
} from './mcp';

// slice 05 mcp-auth-flag: '필요할 때 바로 로그인 화면 열기' (users.mcp_auto_auth · 기본 unset = 꺼짐으로 셈)
//   unset = 카드 A → [켜고 로그인] = on + 바로 브라우저 → 같은 대화에서 이어서 답
//   on    = revoke 뒤 다음 요청은 카드 A 없이 바로 브라우저 (카드 B '로그인 화면을 열었어요') → 이어서 답
//   on + 쓰기 도구 = 브라우저는 열지만 로그인 뒤 저절로 잇지 않는다 (할 일 = 도구 · 인자를 보이고 [이어서 하기])
//   off   = 카드 C + [연결된 앱 열기] → 거기서 연결 → 대화로 돌아오면 [이어서 하기]
// 브라우저 = main 의 shell.openExternal 을 바꿔 연 주소를 받고 fetch 로 끝까지 따라간다 (가짜 AS 자동 허용 → conductor → loopback)
const HOME_H1 = '무엇을 맡길까요?';

test.describe.configure({ mode: 'serial' });
let api: Client;
let tracker: AdminServer;
let app: ElectronApplication;
let win: Page;
let h = '';
const question = (tag: string) => `[fake:app ${h} 이슈 검색] [fake:tool ${h}__search_issues {"query":"${tag}"}] ${tag} 버그 이슈 찾아줘`;
const authCard = () => chat(win).cards.filter({ has: win.locator('.ac-title') }).last();

async function newChat() {
  await win.getByRole('button', { name: '새 대화' }).click();
  await expectHeading(win, HOME_H1);
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  tracker = await ensureTracker(await adminApi());
  h = tracker.handle;
  api = await userApi();
  await disconnect(api, tracker.id);
  await api.patch('/api/me/settings', { auto_auth: 'unset' });
  await fakeMcp('account', { name: 'alice' });
  ({ app, win } = await launchDesktop());
  await captureBrowser(app);
  await expectHeading(win, HOME_H1);
});
test.afterAll(async () => {
  await app?.close();
  if (api && tracker) {
    await disconnect(api, tracker.id);
    await api.patch('/api/me/settings', { auto_auth: 'unset' });
  }
});

test('unset: 카드 A (처음 한 번 묻기) → [켜고 로그인] = on + 브라우저 → 같은 대화에서 결과', async () => {
  test.setTimeout(90_000);
  await ask(win, question('처음'));
  const card = authCard();
  await expect(card).toHaveAttribute('data-card', 'ask', { timeout: 20_000 });
  await expect(card.locator('.ac-title')).toHaveText(`${tracker.name} 연결이 필요해요`);
  await expect(card).toContainText('다음부터 연결이 필요하면 바로 로그인 화면을 열까요?');
  await idle(win);
  // 멈춘 도구 = 연결 기다림 (앱 고르기 = 한 줄 메모)
  const panel = await openTrace(win);
  await expect(panel.locator('[data-tool="use_app"]')).toHaveAttribute('data-state', 'waiting');
  await expect(panel.locator('[data-tool="use_app"] .tn')).toHaveText(`${tracker.name} 연결을 기다려요`);
  expect(await chat(win).last.locator('.trace-line .trace-txt .seg').allTextContents()).toContain(`${tracker.name} 연결`); // 요약 줄
  expect(await separatorsOnScreen(win)).toEqual([]);
  await win.screenshot({ path: shot('desktop-mcp-card-a'), animations: 'disabled' });
  await win.emulateMedia({ colorScheme: 'dark' });
  await win.screenshot({ path: shot('desktop-mcp-card-a-dark'), animations: 'disabled' });
  await win.emulateMedia({ colorScheme: 'light' });

  const before = await openedCount(app);
  const sent = win.waitForRequest((r) => r.url().endsWith('/api/chat') && r.method() === 'POST' && (r.postDataJSON() as any)?.forwardedProps?.resume != null, { timeout: 30_000 });
  await card.getByRole('button', { name: '켜고 로그인' }).click();
  const url = await nextOpened(app, before);
  expect(new URL(url).searchParams.get('code_challenge_method')).toBe('S256'); // 제공자 로그인 주소 (PKCE)
  const back = await followLogin(url);
  expect(back.text).toContain('앱 연결을 마쳤어요');
  // 이어서 하기 = 질문 없이 멈춘 호출 id 만
  const body = (await sent).postDataJSON() as { messages: unknown[]; forwardedProps: { resume: { call_id: string } } };
  expect(body.messages).toEqual([]);
  expect(body.forwardedProps.resume.call_id).toMatch(/\S/);
  await expect(chat(win).last).toContainText('앱 결과를 받았어요', { timeout: 25_000 });
  await idle(win);
  await expect(chat(win).log.locator('.msg.user')).toHaveCount(1); // 이어서 하기 턴엔 질문 말풍선이 없다
  await expect(win.locator('.app-card[data-card="ask"]')).toHaveCount(0); // 이어서 한 뒤 카드는 접힌다
  // 결과 도구 카드 = 앱 이름 · 도구 이름
  const p2 = await openTrace(win);
  await expect(p2.locator(`[data-tool="${h}__search_issues"]`)).toHaveAttribute('data-app', h);
  await expect(p2.locator(`[data-tool="${h}__search_issues"] .th b`)).toContainText(`${tracker.name}:`);
  expect((await api.get<{ auto_auth: string }>('/api/me/settings')).auto_auth).toBe('on');
  await win.screenshot({ path: shot('desktop-mcp-resumed'), animations: 'disabled' });
});

test('on: revoke 뒤 다음 요청은 묻지 않고 바로 브라우저 (카드 B) → 이어서 답', async () => {
  test.setTimeout(90_000);
  await fakeMcp('revoke'); // access · refresh 모두 폐기 → 다시 로그인 필요
  const before = await openedCount(app);
  await ask(win, `[fake:tool ${h}__search_issues {"query":"다시"}] 다시 찾아줘`); // 이 대화에 고정된 도구 (use_app 없이)
  const url = await nextOpened(app, before); // 카드 A 없이 바로 열렸다
  const card = authCard();
  await expect(card).toHaveAttribute('data-card', 'auto');
  await expect(card.locator('.ac-title')).toHaveText(`${tracker.name} 로그인 화면을 열었어요`);
  await expect(card.getByRole('button', { name: '다시 열기' })).toBeVisible();
  await expect(card.getByRole('button', { name: '그만두기' })).toBeVisible();
  await expect(win.locator('.app-card[data-card="ask"]')).toHaveCount(0);
  await win.screenshot({ path: shot('desktop-mcp-card-b'), animations: 'disabled' });
  await followLogin(url);
  await expect(chat(win).last).toContainText('앱 결과를 받았어요', { timeout: 25_000 });
  await idle(win);
});

test('on + 쓰기 도구: 로그인 뒤 저절로 잇지 않고 할 일을 보여 준다 → [이어서 하기]', async () => {
  test.setTimeout(90_000);
  await ask(win, `[fake:app ${h} 이슈 만들기] 이슈 만들 도구 꺼내 줘`); // 연결된 채로 create_issue 를 이 대화에 고정
  await expect(chat(win).last).toContainText('골랐어요', { timeout: 25_000 });
  await idle(win);
  await fakeMcp('revoke');
  let resumed = 0;
  const onRequest = (r: { url(): string; method(): string; postDataJSON(): unknown }) => {
    if (r.url().endsWith('/api/chat') && r.method() === 'POST' && (r.postDataJSON() as any)?.forwardedProps?.resume != null) resumed += 1;
  };
  win.on('request', onRequest);
  const before = await openedCount(app);
  await ask(win, `[fake:tool ${h}__create_issue {"team":"ENG","title":"쓰기 대기"}] 이슈 만들어줘`);
  const url = await nextOpened(app, before); // on = 묻지 않고 로그인 화면은 연다
  const card = authCard();
  await expect(card).toHaveAttribute('data-write', 'true');
  await expect(card.locator('.ac-will')).toContainText('쓰기 대기'); // 무엇을 할지 (도구 · 인자)
  await followLogin(url);
  await expect(card).toHaveAttribute('data-ready', 'true');
  await expect(card).toContainText('아래 일은 앱의 데이터를 바꿔요');
  await expect(card.getByRole('button', { name: '이어서 하기' })).toBeVisible();
  await win.waitForTimeout(1500);
  expect(resumed).toBe(0); // 쓰기 = 저절로 잇지 않는다
  expect(await separatorsOnScreen(win)).toEqual([]);
  await win.screenshot({ path: shot('desktop-mcp-card-write'), animations: 'disabled' });
  await card.getByRole('button', { name: '이어서 하기' }).click();
  await expect(chat(win).last).toContainText('앱 결과를 받았어요', { timeout: 25_000 });
  await idle(win);
  expect(resumed).toBe(1);
  win.off('request', onRequest);
});

test('off: 카드 C + [연결된 앱 열기] → 거기서 연결 → 대화로 돌아와 [이어서 하기]', async () => {
  test.setTimeout(90_000);
  await goHash(win, '#/connections');
  const auto = win.getByRole('checkbox', { name: /필요할 때 바로 로그인 화면 열기/ });
  await expect(auto).toBeChecked();
  await auto.uncheck();
  await expect.poll(async () => (await api.get<{ auto_auth: string }>('/api/me/settings')).auto_auth).toBe('off');
  await disconnect(api, tracker.id);
  await goHash(win, '#/chat');
  await newChat();
  const before = await openedCount(app);
  await ask(win, question('직접'));
  const card = authCard();
  await expect(card).toHaveAttribute('data-card', 'manual', { timeout: 20_000 });
  await expect(card.locator('.ac-title')).toHaveText(`${tracker.name} 앱이 아직 연결되지 않았어요`);
  await expect(card).toContainText('연결된 앱에서 연결하면 이어서 할게요.');
  await idle(win);
  expect(await openedCount(app)).toBe(before); // off = 브라우저를 열지 않는다
  await win.screenshot({ path: shot('desktop-mcp-card-c'), animations: 'disabled' });
  expect(await separatorsOnScreen(win)).toEqual([]);

  await card.getByRole('button', { name: '연결된 앱 열기' }).click();
  await expectHeading(win, '연결된 앱');
  const sheet = win.getByRole('dialog', { name: tracker.name }); // 그 앱 상세가 열려 있다
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: '연결', exact: true }).click();
  await followLogin(await nextOpened(app, before));
  await expect(sheet.locator('.app-state')).toHaveText('연결됨');
  await sheet.getByRole('button', { name: '닫기' }).first().click();
  await goHash(win, '#/chat');
  const ready = authCard();
  await expect(ready).toHaveAttribute('data-ready', 'true');
  await ready.getByRole('button', { name: '이어서 하기' }).click();
  await expect(chat(win).last).toContainText('앱 결과를 받았어요', { timeout: 25_000 });
  await idle(win);
});

test('연결 없이 API 로 이어서 하기 = 409 (UI 는 권한 근거가 아니다)', async () => {
  await disconnect(api, tracker.id);
  const { id } = (await api.get<{ id: string }[]>('/api/threads'))[0];
  const res = await api.raw('POST', '/api/chat', {
    threadId: id, runId: crypto.randomUUID(), state: {}, messages: [], tools: [], context: [], forwardedProps: { resume: { call_id: 'nope_call' } },
  });
  expect(res.status).toBe(409);
  await connectViaApi(api, tracker.id); // 다음 스펙과 상관없이 정리는 afterAll 이 한다
});
