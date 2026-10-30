import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchDesktop, poolUser, userApi, type Client, type Me, type NewUser } from './auth';
import { expectHeading, shot } from './helpers';

// 스페이스 (ADR-0011 · slice 04): 사이드바 맨 위 전환기 = 내 스페이스 · 참여한 공유 스페이스 · 둘러보기(열린 곳).
// 대화는 기본 '나만 보기' — 같은 스페이스 멤버도 못 본다(404). [공유] 하면 멤버에게 보기만 (이어 쓰기는 주인만 · 403).
// 두 사람 = 앨리스 · 밥 (auth.ts POOL). 창 둘을 같이 띄운다
const HOME_H1 = '무엇을 맡길까요?';
const SPACE = `제품팀 ${Date.now().toString(36)}`;
const TITLE = '앨리스의 비밀 계획';

const switcher = (win: Page) => win.locator('.space-switch');
const spaceMenu = (win: Page) => win.getByRole('menu', { name: '스페이스 바꾸기' });
const recent = (win: Page) => win.getByRole('list', { name: '최근' });
async function pickSpace(win: Page, name: RegExp) {
  await switcher(win).click();
  await spaceMenu(win).getByRole('menuitemradio', { name }).click();
  await expect(spaceMenu(win)).toHaveCount(0);
}

test.describe.configure({ mode: 'serial' });
let alice: NewUser;
let bob: NewUser;
let a: { app: ElectronApplication; win: Page };
let b: { app: ElectronApplication; win: Page };
let aliceApi: Client & { me: Me };
let bobApi: Client & { me: Me };
let spaceId = '';
let threadId = '';

test.beforeAll(async () => {
  test.setTimeout(180_000);
  [alice, bob] = await Promise.all([poolUser('alice'), poolUser('bob')]);
  [aliceApi, bobApi] = await Promise.all([userApi(alice), userApi(bob)]);
  // 앞 실행 · 다른 스펙이 남긴 '마지막 스페이스' 와 상관없이 내 스페이스에서 시작
  for (const api of [aliceApi, bobApi]) await api.patch('/api/me', { last_space_id: api.me.personal_space_id });
  a = await launchDesktop({ as: alice });
  await expectHeading(a.win, HOME_H1);
});
test.afterAll(async () => {
  await a?.app.close();
  await b?.app.close();
});

test('처음 = 내 스페이스 · 전환기에 참여한 곳 · 새로 만들기', async () => {
  await expect(switcher(a.win)).toHaveText('내 스페이스');
  await switcher(a.win).click();
  const menu = spaceMenu(a.win);
  await expect(menu.getByRole('menuitemradio', { name: '내 스페이스' })).toHaveAttribute('aria-checked', 'true');
  await expect(menu.getByRole('menuitem', { name: '새로 만들기' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: '스페이스 설정' })).toHaveCount(0); // 내 스페이스엔 설정 없음
  await a.win.screenshot({ path: shot('desktop-space-switcher') });
  await a.win.keyboard.press('Escape');
});

test('새 스페이스: 이름 · 초대한 사람만 · 멤버로 밥 (조직 안에서 닉네임으로 찾기) → 만들면 그 스페이스로', async () => {
  await switcher(a.win).click();
  await spaceMenu(a.win).getByRole('menuitem', { name: '새로 만들기' }).click();
  const dialog = a.win.getByRole('dialog', { name: '새 스페이스' });
  await dialog.getByRole('textbox', { name: '이름' }).fill(SPACE);
  await dialog.getByRole('radiogroup', { name: '공개 범위' }).getByRole('radio', { name: '초대한 사람만' }).click();
  await dialog.getByRole('textbox', { name: '사람 찾기' }).fill(bob.display_name);
  const found = dialog.getByRole('list', { name: '사람 찾기' }).getByRole('listitem').filter({ hasText: bob.email });
  await found.getByRole('button', { name: '넣기' }).click();
  await expect(dialog.getByRole('list', { name: '멤버' })).toContainText(bob.display_name);
  await a.win.screenshot({ path: shot('desktop-space-create') });
  await dialog.getByRole('button', { name: '만들기' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(switcher(a.win)).toHaveText(SPACE);
  await expect(recent(a.win)).toContainText('아직 대화가 없어요');

  const { spaces } = await aliceApi.get<{ spaces: { id: string; name: string; visibility: string; role: string; member_count: number }[] }>('/api/spaces');
  const made = spaces.find((s) => s.name === SPACE)!;
  expect(made).toMatchObject({ visibility: 'private', role: 'admin', member_count: 2 });
  spaceId = made.id;
});

test('그 스페이스의 대화 = 기본 나만 보기 · 경로 줄에 스페이스 · [공유] 버튼', async () => {
  await a.win.getByRole('textbox', { name: '요청 입력' }).fill(TITLE);
  await a.win.getByRole('button', { name: '보내기', exact: true }).click();
  await expectHeading(a.win, TITLE);
  await expect(a.win.locator('.msg.agent').last()).toContainText(`받은 질문: ${TITLE}`, { timeout: 15_000 });
  // 조직이 하나뿐이면 조직 칸은 숨긴다 · 대화 이름은 제목(h1)이 보여 준다 → 스페이스 한 칸
  const crumbs = a.win.getByRole('navigation', { name: '위치' }).getByRole('listitem');
  await expect(crumbs).toHaveCount(1);
  await expect(crumbs.first()).toHaveAttribute('data-kind', 'space');
  await expect(crumbs.first()).toHaveText(`${SPACE}(스페이스)`); // 층 이름은 화면 읽기에만
  await expect(a.win.getByRole('button', { name: '공유', exact: true })).toBeVisible();
  await expect(recent(a.win).getByRole('button', { name: TITLE })).toBeVisible();

  const threads = await aliceApi.get<{ id: string; title: string; visibility: string; space_id: string; path: { kind: string; name: string }[] }[]>(`/api/threads?space=${spaceId}`);
  const t = threads.find((x) => x.title === TITLE)!;
  expect(t).toMatchObject({ visibility: 'private', space_id: spaceId });
  expect(t.path.map((c) => c.kind)).toEqual(['org', 'space', 'thread']);
  threadId = t.id;
});

test('밥: 전환기에 그 스페이스 · 들어가도 앨리스의 대화는 안 보인다 (API 도 404)', async () => {
  b = await launchDesktop({ as: bob });
  await expectHeading(b.win, HOME_H1);
  await pickSpace(b.win, new RegExp(`^${SPACE}`));
  await expect(switcher(b.win)).toHaveText(SPACE);
  await expect(recent(b.win)).toContainText('아직 대화가 없어요');
  expect((await bobApi.raw('GET', `/api/threads/${threadId}`)).status).toBe(404);
  expect((await bobApi.get<{ id: string }[]>(`/api/threads?space=${spaceId}`)).map((t) => t.id)).not.toContain(threadId);
});

test('앨리스가 [공유] → 밥에게 보인다 (닉네임 꼬리표) · 보기만 · 이어 쓰기 · 고치기는 403', async () => {
  await a.win.getByRole('button', { name: '공유', exact: true }).click();
  const pop = a.win.getByRole('dialog', { name: '대화 공유' });
  await pop.getByRole('switch', { name: '이 스페이스 멤버에게 보이기' }).click();
  await expect(pop.getByRole('status')).toHaveText('멤버가 이 대화를 볼 수 있어요. 이어 쓰기는 나만 할 수 있어요');
  await a.win.screenshot({ path: shot('desktop-share-on') });
  await a.win.keyboard.press('Escape');
  await expect(a.win.getByRole('button', { name: '공유됨' })).toBeVisible();

  await b.win.reload(); // 마지막 스페이스(제품팀)로 다시 열린다
  await expect(switcher(b.win)).toHaveText(SPACE);
  const item = recent(b.win).getByRole('button', { name: new RegExp(`^${TITLE}`) });
  await expect(item.locator('.owner-tag')).toHaveText(alice.display_name);
  await item.click();
  await expectHeading(b.win, TITLE);
  await expect(b.win.locator('.msg.agent').last()).toContainText(`받은 질문: ${TITLE}`);
  await expect(b.win.locator('.readonly')).toHaveText(`${alice.display_name} 님이 공유한 대화예요 · 보기만 할 수 있어요`);
  await expect(b.win.getByRole('textbox', { name: '요청 입력' })).toHaveCount(0);
  await expect(b.win.getByRole('button', { name: /^공유/ })).toHaveCount(0); // 남의 대화엔 공유 버튼도 없다
  await b.win.screenshot({ path: shot('desktop-share-viewer') });

  const thread = await bobApi.get<{ mine: boolean; owner_name: string; can_edit: boolean }>(`/api/threads/${threadId}`);
  expect(thread).toMatchObject({ mine: false, owner_name: alice.display_name, can_edit: false });
  expect((await bobApi.raw('PATCH', `/api/threads/${threadId}`, { title: '바꿔 볼까' })).status).toBe(403);
  expect((await bobApi.raw('DELETE', `/api/threads/${threadId}`)).status).toBe(403);
});

test('앨리스가 내 스페이스로 바꾸면 최근 = 그 스페이스의 대화만 · 다시 바꾸면 돌아온다', async () => {
  await pickSpace(a.win, /^내 스페이스/);
  await expect(switcher(a.win)).toHaveText('내 스페이스');
  await expectHeading(a.win, HOME_H1);
  await expect(recent(a.win).getByRole('button', { name: TITLE })).toHaveCount(0);
  await pickSpace(a.win, new RegExp(`^${SPACE}`));
  await expect(recent(a.win).getByRole('button', { name: TITLE })).toBeVisible();
});

test('열린 스페이스 = 둘러보기에서 스스로 참여', async () => {
  const OPEN = `모두의 방 ${Date.now().toString(36)}`;
  await aliceApi.post('/api/spaces', { name: OPEN, visibility: 'open' });
  await b.win.reload();
  await switcher(b.win).click();
  await spaceMenu(b.win).getByRole('menuitem', { name: new RegExp(`^${OPEN}.*참여`) }).click();
  await expect(switcher(b.win)).toHaveText(OPEN);
  const { spaces } = await bobApi.get<{ spaces: { name: string; role: string }[] }>('/api/spaces');
  expect(spaces.find((s) => s.name === OPEN)).toMatchObject({ role: 'member' });
});
