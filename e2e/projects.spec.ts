import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchDesktop, poolUser, userApi, type Client, type Me, type NewUser } from './auth';
import { expectHeading, shot } from './helpers';

// 프로젝트 (조직 > 스페이스 > 프로젝트 > 대화): 지금 스페이스의 묶음 + 지침. 지침은 그 프로젝트 대화마다 시스템 프롬프트 뒤에 붙는다.
// mock 게이트웨이 [fake:system] = 답 끝에 '· 지침: <system 마지막 줄>' → 지침이 모델까지 갔는지 본다.
// 사람 = 앨리스 (auth.ts POOL) · 내 스페이스에서 (프로젝트는 개인 스페이스에도 된다)
const HOME_H1 = '무엇을 맡길까요?';
const NAME = `주간 보고 ${Date.now().toString(36)}`;
const OTHER = `회의록 ${Date.now().toString(36)}`;
const RULE = '표로 답한다. 숫자에는 출처를 붙인다.';

const side = (win: Page) => win.getByRole('complementary', { name: '사이드바' });
const projects = (win: Page) => side(win).getByRole('list', { name: '프로젝트' });
const box = (win: Page) => win.getByRole('textbox', { name: '요청 입력' });
const crumbs = (win: Page) => win.getByRole('navigation', { name: '위치' }).getByRole('listitem');
// 보내고 새 답이 끝날 때까지 (같은 대화에 이어 물어도 앞 답과 헷갈리지 않게 개수로 기다린다)
async function ask(win: Page, text: string) {
  const answers = win.locator('.msg.agent');
  const before = await answers.count();
  await box(win).fill(text);
  await win.getByRole('button', { name: '보내기', exact: true }).click();
  await expect(answers).toHaveCount(before + 1);
  const answer = answers.last();
  await expect(answer).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
  return answer;
}

test.describe.configure({ mode: 'serial' });
let user: NewUser;
let api: Client & { me: Me };
let app: ElectronApplication;
let win: Page;
let projectId = '';

test.beforeAll(async () => {
  test.setTimeout(120_000);
  user = await poolUser('alice');
  api = await userApi(user);
  await api.patch('/api/me', { last_space_id: api.me.personal_space_id }); // 내 스페이스에서 시작
  ({ app, win } = await launchDesktop({ as: user }));
  await expectHeading(win, HOME_H1);
});
test.afterAll(async () => app?.close());

test('사이드바 프로젝트 = 지금 스페이스의 프로젝트 · [+ 새 프로젝트] → 이름 · 설명 · 지침 → 프로젝트 화면', async () => {
  await side(win).getByRole('button', { name: '새 프로젝트' }).first().click();
  const dialog = win.getByRole('dialog', { name: '새 프로젝트' });
  await dialog.getByRole('textbox', { name: '이름' }).fill(NAME);
  await dialog.getByRole('textbox', { name: '설명' }).fill('매주 금요일 보고');
  await dialog.getByRole('textbox', { name: '지침' }).fill(RULE);
  await expect(dialog).toContainText(`${[...RULE].length} / 4,000자`);
  await win.screenshot({ path: shot('desktop-project-create') });
  await dialog.getByRole('button', { name: '만들기' }).click();
  await expect(dialog).toHaveCount(0);

  await expectHeading(win, NAME);
  const head = win.locator('.proj-head');
  await expect(head).toContainText('매주 금요일 보고');
  await expect(head).toContainText(`${user.display_name} 님이 만듦`);
  await expect(head).toContainText('지침 있음');
  await expect(projects(win).getByRole('button', { name: NAME })).toHaveAttribute('aria-current', 'true');
  await expect(box(win)).toHaveAttribute('placeholder', `'${NAME}'에 새 대화`);
  await expect(win.locator('.proj')).toContainText('아직 대화가 없어요. 위에서 시작하면 이 프로젝트에 들어가요');

  const list = await api.get<{ id: string; name: string; instructions: string; can_edit: boolean; created_by_name: string }[]>(
    `/api/spaces/${api.me.personal_space_id}/projects`,
  );
  const p = list.find((x) => x.name === NAME)!;
  expect(p).toMatchObject({ instructions: RULE, can_edit: true, created_by_name: user.display_name });
  projectId = p.id;
});

test('프로젝트 안에서 시작한 대화 = 그 프로젝트 · 지침이 모델까지 간다 · 경로 줄에 프로젝트', async () => {
  const answer = await ask(win, '[fake:system] 이번 주 숫자');
  await expectHeading(win, '[fake:system] 이번 주 숫자');
  await expect(answer).toContainText(`· 지침: ${RULE}`);
  await expect(crumbs(win)).toHaveCount(2);
  await expect(crumbs(win).nth(0)).toHaveAttribute('data-kind', 'space');
  await expect(crumbs(win).nth(1)).toHaveAttribute('data-kind', 'project');
  await expect(crumbs(win).nth(1)).toContainText(NAME);
  await expect(projects(win).getByRole('button', { name: NAME })).not.toHaveAttribute('aria-current', 'true'); // 대화를 보는 중
  await win.screenshot({ path: shot('desktop-project-thread') });
  // 사이드바 프로젝트 → 프로젝트 화면 (그 대화가 목록에)
  await projects(win).getByRole('button', { name: NAME }).click();
  await expectHeading(win, NAME);
  await expect(win.getByRole('list', { name: '대화' })).toContainText('[fake:system] 이번 주 숫자');
  await win.screenshot({ path: shot('desktop-project-view') });
});

test('프로젝트 밖 대화엔 지침이 없다 → 칩으로 프로젝트에 옮기면 경로 · 목록이 바뀐다', async () => {
  await side(win).getByRole('button', { name: '새 대화' }).click();
  await expectHeading(win, HOME_H1);
  const answer = await ask(win, '[fake:system] 밖에서 묻기');
  await expectHeading(win, '[fake:system] 밖에서 묻기');
  await expect(answer).toContainText('· 지침: ');
  await expect(answer).not.toContainText(RULE);
  await expect(crumbs(win)).toHaveCount(1); // 스페이스만 (프로젝트 없음)

  const chip = win.locator('.composer .composer-ctx').getByRole('button', { name: /프로젝트 없음/ });
  await chip.click();
  await win.getByRole('menu', { name: '이 대화를 옮길 프로젝트' }).getByRole('menuitemradio', { name: NAME }).click();
  await expect(crumbs(win)).toHaveCount(2);
  await expect(crumbs(win).nth(1)).toContainText(NAME);
  // 옮긴 뒤 묻는 말엔 지침이 붙는다 (서버가 대화의 프로젝트를 DB 에서 읽는다)
  const after = await ask(win, '[fake:system] 옮긴 뒤');
  await expect(after).toContainText(`· 지침: ${RULE}`);

  const threads = await api.get<{ title: string; project_id: string | null; path: { kind: string }[] }[]>(`/api/threads?project=${projectId}`);
  const moved = threads.find((t) => t.title === '[fake:system] 밖에서 묻기')!;
  expect(moved.project_id).toBe(projectId);
  expect(moved.path.map((c) => c.kind)).toEqual(['org', 'space', 'project', 'thread']);
});

test('설정 서랍: 지침을 바꾸면 다음 답부터 새 지침 · 두 번째 프로젝트로 옮기기', async () => {
  await projects(win).getByRole('button', { name: NAME }).click();
  await expectHeading(win, NAME);
  await win.getByRole('button', { name: '프로젝트 설정' }).click();
  const sheet = win.getByRole('dialog', { name: '프로젝트 설정' });
  await sheet.getByRole('textbox', { name: '지침' }).fill('항상 세 줄로 답한다.');
  await sheet.getByRole('button', { name: '저장' }).click();
  await expect(sheet.getByRole('status')).toHaveText('저장했어요');
  await win.keyboard.press('Escape');
  const answer = await ask(win, '[fake:system] 새 지침 확인');
  await expectHeading(win, '[fake:system] 새 지침 확인');
  await expect(answer).toContainText('· 지침: 항상 세 줄로 답한다.');

  // 두 번째 프로젝트 (API) → 이 대화를 거기로
  const other = await api.post<{ id: string }>(`/api/spaces/${api.me.personal_space_id}/projects`, { name: OTHER });
  await win.reload(); // 사이드바 목록을 다시 읽는다
  await projects(win).getByRole('button', { name: NAME }).click();
  await win.getByRole('list', { name: '대화' }).getByRole('button', { name: /새 지침 확인/ }).click();
  await win.locator('.composer .composer-ctx').getByRole('button', { name: new RegExp(NAME) }).click();
  await win.getByRole('menu', { name: '이 대화를 옮길 프로젝트' }).getByRole('menuitemradio', { name: OTHER }).click();
  await expect(crumbs(win).nth(1)).toContainText(OTHER);
  const thread = (await api.get<{ id: string; title: string; project_id: string }[]>(`/api/threads?project=${other.id}`))[0];
  expect(thread.title).toBe('[fake:system] 새 지침 확인');
});

test('다른 스페이스의 프로젝트로는 못 옮긴다 (409 project_in_other_space) · 남이 만든 프로젝트는 못 고친다 (403)', async () => {
  const thread = (await api.get<{ id: string }[]>(`/api/threads?project=${projectId}`))[0];
  // 공유 스페이스의 프로젝트 하나
  const shared = await api.post<{ id: string }>('/api/spaces', { name: `옆 팀 ${Date.now().toString(36)}`, visibility: 'open' });
  const far = await api.post<{ id: string }>(`/api/spaces/${shared.id}/projects`, { name: '옆 팀 프로젝트' });
  const res = await api.raw('PATCH', `/api/threads/${thread.id}`, { project_id: far.id });
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ detail: 'project_in_other_space' });
  // 밥: 열린 스페이스에 참여 → 프로젝트는 보이지만 고칠 수 없다 (만든 사람 · 스페이스 운영만)
  const bob = await userApi(await poolUser('bob'));
  await bob.post(`/api/spaces/${shared.id}/join`);
  const seen = await bob.get<{ can_edit: boolean }>(`/api/projects/${far.id}`);
  expect(seen.can_edit).toBe(false);
  expect((await bob.raw('PATCH', `/api/projects/${far.id}`, { name: '밥이 바꿈' })).status).toBe(403);
  // 내 스페이스의 프로젝트는 남에게 아예 안 보인다
  expect((await bob.raw('GET', `/api/projects/${projectId}`)).status).toBe(404);
});
