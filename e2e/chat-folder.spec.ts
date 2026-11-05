import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchDesktop, poolUser, userApi, type Client, type Me, type NewUser } from './auth';
import { LOCAL_HOME } from './env';
import { expectHeading, shot } from './helpers';
import { chat, clearRecord, chatRecords, idle, openTrace, toolNames } from './mcp';

// 로컬 폴더 (slice 09 · ADR-0016): 프로젝트에 이 PC 폴더 연결 → 그 프로젝트 대화에만 읽기 도구 3개 (folder_list · folder_read · folder_search).
// E2E = 폴더 대화상자 없이 BREWAI_E2E_PICK_DIR · conductor 경계 = LOCAL_HOME (playwright.config CONDUCTOR_LOCAL_HOME).
// mock 표시: [fake:tool <이름> {인자}] → 그 도구 한 번 (요청 tools 에 있을 때만)
const HOME_H1 = '무엇을 맡길까요?';
const NAME = `쇼핑몰 ${Date.now().toString(36)}`;
const SHOP = path.join(LOCAL_HOME, `shop-${Date.now().toString(36)}`);
const SECRET = 'sk-e2e-local-folder-DO-NOT-LEAK';

const side = (win: Page) => win.getByRole('complementary', { name: '사이드바' });
const projects = (win: Page) => side(win).getByRole('list', { name: '프로젝트' });
const row = (win: Page) => win.getByTestId('project-folder');
async function askAndWait(win: Page, text: string) {
  const answers = win.locator('.msg.agent');
  const before = await answers.count();
  await chat(win).box.fill(text);
  await chat(win).send.click();
  await expect(answers).toHaveCount(before + 1);
  await idle(win);
  return answers.last();
}

test.describe.configure({ mode: 'serial' });
let user: NewUser;
let api: Client & { me: Me };
let app: ElectronApplication;
let win: Page;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  fs.mkdirSync(path.join(SHOP, 'src'), { recursive: true });
  fs.writeFileSync(path.join(SHOP, 'src', 'app.py'), 'def main():\n    # TODO 결제 붙이기\n    return 1\n');
  fs.writeFileSync(path.join(SHOP, 'README.md'), '# shop\n');
  fs.writeFileSync(path.join(SHOP, '.env'), `API_KEY=${SECRET}\n`);
  user = await poolUser('alice');
  api = await userApi(user);
  await api.patch('/api/me', { last_space_id: api.me.personal_space_id });
  await api.post(`/api/spaces/${api.me.personal_space_id}/projects`, { name: NAME });
  process.env.BREWAI_E2E_PICK_DIR = SHOP; // launchDesktop 이 process.env 를 넘긴다 (main = 배포본 아닐 때만 받음)
  ({ app, win } = await launchDesktop({ as: user }));
  delete process.env.BREWAI_E2E_PICK_DIR;
  await expectHeading(win, HOME_H1);
});
test.afterAll(async () => {
  await app?.close();
  fs.rmSync(SHOP, { recursive: true, force: true });
});

test('프로젝트 화면 [로컬 폴더 연결] → 폴더 이름 · 경로 · 읽기만', async () => {
  await projects(win).getByRole('button', { name: NAME }).click();
  await expectHeading(win, NAME);
  await row(win).getByRole('button', { name: '로컬 폴더 연결' }).click();
  await expect(row(win)).toContainText(path.basename(SHOP));
  await expect(row(win)).toContainText('읽기만');
  await expect(row(win).getByRole('button', { name: '연결 끊기' })).toBeVisible();
  await win.screenshot({ path: shot('desktop-project-folder') });
});

test('그 프로젝트 대화 = 폴더 검색 · 읽기 도구 · .env 는 막힘 · 비밀은 모델에도 화면에도 0', async () => {
  clearRecord();
  const found = await askAndWait(win, '할 일 찾아줘 [fake:tool folder_search {"query":"TODO"}]');
  await expect(found).toContainText('src/app.py');
  await expect(await openTrace(win)).toContainText('폴더 검색');
  const first = chatRecords().find((r) => JSON.stringify(r.body?.messages ?? []).includes('할 일 찾아줘'));
  expect(toolNames(first!)).toEqual(expect.arrayContaining(['folder_list', 'folder_read', 'folder_search']));

  const blocked = await askAndWait(win, '키 보여줘 [fake:tool folder_read {"path":".env"}]');
  await expect(blocked).toContainText('blocked');
  await expect(win.locator('body')).not.toContainText(SECRET);
  for (const r of chatRecords()) expect(JSON.stringify(r.body)).not.toContain(SECRET);
  await win.screenshot({ path: shot('desktop-project-folder-chat') });
});

test('[연결 끊기] → 다음 대화엔 폴더 도구가 없다', async () => {
  await projects(win).getByRole('button', { name: NAME }).click();
  await expectHeading(win, NAME);
  await row(win).getByRole('button', { name: '연결 끊기' }).click();
  await expect(row(win).getByRole('button', { name: '로컬 폴더 연결' })).toBeVisible();
  clearRecord();
  await askAndWait(win, '다시 찾아줘');
  const r = chatRecords().find((x) => JSON.stringify(x.body?.messages ?? []).includes('다시 찾아줘'));
  expect(toolNames(r!).filter((n) => n.startsWith('folder_'))).toEqual([]);
});
