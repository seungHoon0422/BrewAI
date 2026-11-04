import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchDesktop, userApi, type Client } from './auth';
import { separatorsOnScreen } from './copy-rule';
import { expectHeading, shot } from './helpers';
import { MEMO, addMemo, idle, type App } from './mcp';

// 개발용 샘플 메뉴 (개발 빌드에서만 = main 이 배포본이 아닐 때 --brewai-dev → preload window.brewai.dev · E2E 빌드본도 개발 빌드)
// 입력창 첨부 옆 '샘플' 단추 → 기능 묶음 11개의 질문 → 고르면 홈 제안처럼 바로 보낸다 (POST /api/chat 의 마지막 user 글 = 그 질문)
// 질문은 진짜 모델용 글이라 mock 표시([fake:…])가 없다 → mock 게이트웨이는 그냥 답한다. 앱 도구 묶음 = 쓸 수 있는 내 앱 (여기선 '메모')
const HOME_H1 = '무엇을 맡길까요?';
const GROUPS = ['대화 기본', '생각', '마크다운 표', '스킬 요약', '스킬 비교표', '문서 파일 만들기', '앱 도구', '동시 실행', '여러 단계', '에이전트 팀', '오류 처리'];
const FIRST = '안녕! 너는 어떤 일을 도와줄 수 있어? 세 줄로 알려 줘';
const MEMO_DOCS = `${MEMO.name} 앱으로 시작하기 문서를 찾아 핵심 세 가지를 정리해 줘`; // 메모 = 분류 문서 → 시작하기 문서 찾기
const SECOND = '블랙홀이 무엇인지 초등학생도 알 수 있게 세 문장으로 설명해 줘';

const ui = (win: Page) => ({
  box: win.getByRole('textbox', { name: '요청 입력' }),
  button: win.locator('.composer').getByRole('button', { name: '샘플', exact: true }),
  menu: win.getByRole('menu', { name: '개발용 샘플 질문' }),
  log: win.getByRole('log', { name: '대화 내용' }),
});
const items = (win: Page) => ui(win).menu.getByRole('menuitem');
const lastUser = (body: { messages: { role: string; content: unknown }[] }) => body.messages.at(-1);
const chatPost = (win: Page) => win.waitForRequest((r) => r.url().endsWith('/api/chat') && r.method() === 'POST');

test.describe.configure({ mode: 'serial' });
let api: Client;
let memo: App | null = null;
let app: ElectronApplication;
let win: Page;
test.beforeAll(async () => {
  test.setTimeout(120_000);
  api = await userApi();
  memo = await addMemo(api); // 켜기 전에 = 앱 도구 묶음에 처음부터 메모
  ({ app, win } = await launchDesktop());
  await expectHeading(win, HOME_H1);
});
test.afterAll(async () => {
  await app?.close();
  if (api && memo) await api.del(`/api/me/mcp/servers/${memo.id}`);
});

test('개발 빌드: 입력창에 샘플 단추 · 메뉴 = 기능 묶음 11개 · 앱 도구는 연결된 앱 기준 · mock 표시 없음', async () => {
  expect(await win.evaluate(() => (window as { brewai?: { dev?: boolean } }).brewai?.dev)).toBe(true);
  const { button, menu } = ui(win);
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute('aria-haspopup', 'menu');
  await button.click();
  await expect(menu).toBeVisible();
  await expect(menu.locator('.ui-menu-heading')).toHaveText(GROUPS);
  // 앱 도구 묶음에 메모 (꼬리표 = 앱 이름) · 동시 실행 · 여러 단계에도 앱 질문
  await expect(menu.getByRole('menuitem', { name: '시작하기 문서 찾기' }).filter({ hasText: MEMO.name }).first()).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /앱에서 두 가지 동시에 찾기/ })).toHaveCount(1);
  await expect(menu.getByRole('menuitem', { name: /앱에서 찾고 요약 스킬로 정리/ })).toHaveCount(1);
  await expect(menu).not.toContainText('[fake:');
  expect(await separatorsOnScreen(win)).toEqual([]);
  await expect(items(win).first()).toBeFocused(); // 열리면 첫 칸으로
  await win.screenshot({ path: shot('desktop-samples-menu'), animations: 'disabled' });
  await win.emulateMedia({ colorScheme: 'dark' });
  await win.screenshot({ path: shot('desktop-samples-menu-dark'), animations: 'disabled' });
  await win.emulateMedia({ colorScheme: 'light' });
});

test('키보드: 위아래 · End · Home 으로 옮기고 Esc 로 닫으면 단추로 돌아간다', async () => {
  const { button, menu } = ui(win);
  await win.keyboard.press('ArrowDown');
  await expect(items(win).nth(1)).toBeFocused();
  await win.keyboard.press('End');
  await expect(items(win).last()).toBeFocused();
  await expect(items(win).last()).toContainText('긴 답 멈추기');
  await win.keyboard.press('Home');
  await expect(items(win).first()).toBeFocused();
  await win.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
});

test('홈: 키보드로 고르면 바로 보낸다 (요청 = 그 질문 · 홈 제안과 같은 길) → 대화 화면 · 포커스 = 입력창', async () => {
  const { box, button, log } = ui(win);
  await button.focus();
  await win.keyboard.press('Enter');
  await expect(items(win).first()).toBeFocused();
  await expect(items(win).first()).toContainText('인사하고 할 수 있는 일 묻기');
  const sent = chatPost(win);
  await win.keyboard.press('Enter');
  expect(lastUser((await sent).postDataJSON())).toMatchObject({ role: 'user', content: FIRST });
  await expect(log.locator('.msg.user')).toHaveText([FIRST]);
  await expect(ui(win).menu).toHaveCount(0);
  // 홈 → 대화 화면으로 바뀌며 샘플 단추가 사라진다 (메뉴는 닫히며 단추로 돌려놓는다) → 포커스는 새 화면의 입력창
  await expect(box).toBeFocused();
  await idle(win);
  await expect(box).toBeFocused();
});

test('대화 화면: 키보드로 앱 질문을 골라 Enter = 보낸다 · 입력창에 쓰던 글은 그대로', async () => {
  const { box, button, log } = ui(win);
  await box.fill('쓰던 글');
  await button.click();
  const target = items(win).filter({ hasText: '시작하기 문서 찾기' }).filter({ hasText: MEMO.name }).first();
  // 첫 칸에서 그 칸까지 아래 화살표 (포커스가 옮겨 가며 메뉴가 스크롤된다)
  for (let i = 0; i < 40 && !(await target.evaluate((el) => el === document.activeElement)); i++) await win.keyboard.press('ArrowDown');
  await expect(target).toBeFocused();
  const sent = chatPost(win);
  await win.keyboard.press('Enter');
  expect(lastUser((await sent).postDataJSON())).toMatchObject({ role: 'user', content: MEMO_DOCS });
  await expect(box).toBeFocused(); // 고른 뒤 포커스 = 입력창 (샘플 단추는 보내는 동안 꺼진다 = 거기 두면 body 로 빠진다)
  await expect(log.locator('.msg.user').last()).toHaveText(MEMO_DOCS);
  await idle(win);
  await expect(box).toHaveValue('쓰던 글'); // 제안처럼 입력창은 건드리지 않는다
  await box.fill('');
  // 셋째: 짧은 설명 (마우스)
  await button.click();
  const third = chatPost(win);
  await items(win).filter({ hasText: '쉽게 설명하기' }).click();
  expect(lastUser((await third).postDataJSON())).toMatchObject({ role: 'user', content: SECOND });
  await expect(log.locator('.msg.user')).toHaveText([FIRST, MEMO_DOCS, SECOND]);
  await idle(win);
  await expect(button).toBeEnabled();
});
