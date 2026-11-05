import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchDesktop, poolUser, userApi, type Client, type Me, type NewUser } from './auth';
import { expectHeading, goHash, shot } from './helpers';

// 프로젝트 (조직 > 스페이스 > 프로젝트 > 대화): 지금 스페이스의 묶음 + 지침. 지침은 그 프로젝트 대화마다 시스템 프롬프트 뒤에 붙는다.
// mock 게이트웨이 [fake:system] = 답 끝에 ', 지침: <system 마지막 줄>' → 지침이 모델까지 갔는지 본다.
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
  await expect(projects(win).getByRole('button', { name: NAME, exact: true })).toHaveAttribute('aria-current', 'true');
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
  await expect(answer).toContainText(`, 지침: ${RULE}`);
  await expect(crumbs(win)).toHaveCount(2);
  await expect(crumbs(win).nth(0)).toHaveAttribute('data-kind', 'space');
  await expect(crumbs(win).nth(1)).toHaveAttribute('data-kind', 'project');
  await expect(crumbs(win).nth(1)).toContainText(NAME);
  await expect(projects(win).getByRole('button', { name: NAME, exact: true })).not.toHaveAttribute('aria-current', 'true'); // 대화를 보는 중
  // 사이드바: 프로젝트 대화는 그 프로젝트 아래 묶음 (지금 연 대화의 프로젝트 = 저절로 펼침) · '최근' 에는 없다
  const group = side(win).getByRole('list', { name: `${NAME} 대화` });
  await expect(group.getByRole('button', { name: '[fake:system] 이번 주 숫자' })).toHaveAttribute('aria-current', 'true');
  await expect(side(win).getByRole('list', { name: '최근' }).getByRole('button', { name: '[fake:system] 이번 주 숫자' })).toHaveCount(0);
  await side(win).getByRole('button', { name: `${NAME} 대화` }).click(); // 접기
  await expect(group).toHaveCount(0);
  await side(win).getByRole('button', { name: `${NAME} 대화` }).click(); // 펼치기
  await expect(group).toBeVisible();
  await win.screenshot({ path: shot('desktop-project-thread') });
  // 사이드바 프로젝트 → 프로젝트 화면 (그 대화가 목록에)
  await projects(win).getByRole('button', { name: NAME, exact: true }).click();
  await expectHeading(win, NAME);
  await expect(win.getByRole('list', { name: '대화', exact: true })).toContainText('[fake:system] 이번 주 숫자');
  await win.screenshot({ path: shot('desktop-project-view') });
});

test('프로젝트 밖 대화엔 지침이 없다 → 칩으로 프로젝트에 옮기면 경로 · 목록이 바뀐다', async () => {
  await side(win).getByRole('button', { name: '새 대화' }).click();
  await expectHeading(win, HOME_H1);
  const answer = await ask(win, '[fake:system] 밖에서 묻기');
  await expectHeading(win, '[fake:system] 밖에서 묻기');
  await expect(answer).toContainText(', 지침: ');
  await expect(answer).not.toContainText(RULE);
  await expect(crumbs(win)).toHaveCount(1); // 스페이스만 (프로젝트 없음)

  const chip = win.locator('.composer .composer-ctx').getByRole('button', { name: /프로젝트 없음/ });
  await chip.click();
  await win.getByRole('menu', { name: '이 대화를 옮길 프로젝트' }).getByRole('menuitemradio', { name: NAME }).click();
  await expect(crumbs(win)).toHaveCount(2);
  await expect(crumbs(win).nth(1)).toContainText(NAME);
  // 옮긴 뒤 묻는 말엔 지침이 붙는다 (서버가 대화의 프로젝트를 DB 에서 읽는다)
  const after = await ask(win, '[fake:system] 옮긴 뒤');
  await expect(after).toContainText(`, 지침: ${RULE}`);
  // 옮긴 대화 = 사이드바에서도 그 프로젝트 아래로
  await expect(side(win).getByRole('list', { name: `${NAME} 대화` }).getByRole('button', { name: '[fake:system] 밖에서 묻기' })).toBeVisible();
  await expect(side(win).getByRole('list', { name: '최근' }).getByRole('button', { name: '[fake:system] 밖에서 묻기' })).toHaveCount(0);

  const threads = await api.get<{ title: string; project_id: string | null; path: { kind: string }[] }[]>(`/api/threads?project=${projectId}`);
  const moved = threads.find((t) => t.title === '[fake:system] 밖에서 묻기')!;
  expect(moved.project_id).toBe(projectId);
  expect(moved.path.map((c) => c.kind)).toEqual(['org', 'space', 'project', 'thread']);
});

test('설정 서랍: 지침을 바꾸면 다음 답부터 새 지침 · 두 번째 프로젝트로 옮기기', async () => {
  await projects(win).getByRole('button', { name: NAME, exact: true }).click();
  await expectHeading(win, NAME);
  await win.getByRole('button', { name: '프로젝트 설정' }).click();
  const sheet = win.getByRole('dialog', { name: '프로젝트 설정' });
  await sheet.getByRole('textbox', { name: '지침' }).fill('항상 세 줄로 답한다.');
  await sheet.getByRole('button', { name: '저장' }).click();
  await expect(sheet.getByRole('status')).toHaveText('저장했어요');
  await win.keyboard.press('Escape');
  const answer = await ask(win, '[fake:system] 새 지침 확인');
  await expectHeading(win, '[fake:system] 새 지침 확인');
  await expect(answer).toContainText(', 지침: 항상 세 줄로 답한다.');

  // 두 번째 프로젝트 (API) → 이 대화를 거기로
  const other = await api.post<{ id: string }>(`/api/spaces/${api.me.personal_space_id}/projects`, { name: OTHER });
  await win.reload(); // 사이드바 목록을 다시 읽는다
  await projects(win).getByRole('button', { name: NAME, exact: true }).click();
  await win.getByRole('list', { name: '대화', exact: true }).getByRole('button', { name: /새 지침 확인/ }).click();
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

test('설정 › 사용량 = 내 호출 · 토큰 (API 와 같은 숫자) · 세부 보기 (모델 · 프로젝트 · 스페이스 · 조직) → 줄을 누르면 거름 · 칩으로 해제', async () => {
  await goHash(win, '#/settings/usage');
  await expectHeading(win, '사용량');
  const now = new Date();
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const start = new Date(now);
  start.setDate(start.getDate() - 29);
  const q = `from=${ymd(start)}&to=${ymd(now)}&tz=${-now.getTimezoneOffset()}`;
  const mine = await api.get<{ totals: { runs: number } }>(`/api/me/usage?${q}`);
  const inProject = await api.get<{ totals: { runs: number } }>(`/api/me/usage?${q}&project=${projectId}`);
  expect(mine.totals.runs).toBeGreaterThan(inProject.totals.runs); // 위 테스트들 = 프로젝트 안 + 밖
  const runs = win.locator('[data-kpi="runs"] .ui-stat-value');
  await expect(runs).toHaveText(mine.totals.runs.toLocaleString('ko-KR'));
  const tabs = win.getByRole('tablist', { name: '세부 보기' });
  await expect(tabs.getByRole('tab')).toHaveText(['모델', '프로젝트', '스페이스', '조직']);
  await expect(win.getByRole('table', { name: '모델별 사용량' }).locator('tbody tr')).not.toHaveCount(0);
  // 프로젝트 탭 → 이 프로젝트 줄을 누르면 위 숫자가 그 프로젝트 것으로 · 칩
  await tabs.getByRole('tab', { name: '프로젝트' }).click();
  const projTable = win.getByRole('table', { name: '프로젝트별 사용량' });
  await expect(projTable).toContainText('프로젝트 밖 대화');
  await projTable.getByRole('button', { name: new RegExp(NAME) }).click();
  const chips = win.getByRole('group', { name: '거른 항목' });
  await expect(chips.getByRole('button')).toHaveText([`프로젝트: ${NAME}`]);
  await expect(runs).toHaveText(inProject.totals.runs.toLocaleString('ko-KR'));
  // 스페이스 탭 = 거른 채로 (내 스페이스 하나)
  await tabs.getByRole('tab', { name: '스페이스' }).click();
  await expect(win.getByRole('table', { name: '스페이스별 사용량' }).locator('tbody tr')).toHaveCount(1);
  await expect(win.getByRole('table', { name: '스페이스별 사용량' })).toContainText('내 스페이스');
  await win.screenshot({ path: shot('desktop-settings-usage'), fullPage: true });
  await chips.getByRole('button', { name: `${NAME} 거르기 해제` }).click();
  await expect(chips).toHaveCount(0);
  await expect(runs).toHaveText(mine.totals.runs.toLocaleString('ko-KR'));
  await win.getByRole('radiogroup', { name: '기간' }).getByRole('radio', { name: '7일' }).click();
  await expect(win.locator('[data-kpi="runs"]')).toContainText('지난 7일 대비');
});
