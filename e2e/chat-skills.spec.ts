import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchDesktop, userApi, type Client } from './auth';
import { separatorsOnScreen } from './copy-rule';
import { expectHeading, openMenu, openSettings, shot } from './helpers';

// 스킬 (제품 스킬 = runtime/skills · conductor 가 읽는다 · 평소에 쓰는 문서 스킬 2개만): 스킬 메뉴 목록 → 대화에서 스킬 카드 → 사용 횟수.
// mock 표시: [fake:skill <이름>] → use_skill (내장 도구는 없다)
const NAV = '메뉴';
const SKILLS = { id: 'settings/skills', label: '스킬' }; // 설정 › 스킬
const CHAT = { id: 'chat', label: '대화', h1: '무엇을 맡길까요?' };
const STARTERS = ['비교표 만들기', 'Excel 표', 'PDF 문서', '발표 자료', '요약', 'Word 문서']; // 이름 순 (compare-table · excel-sheet · pdf-doc · ppt-deck · summarize · word-doc)

test.describe.configure({ mode: 'serial' });
let app: ElectronApplication;
let win: Page;
let api: Client; // 같은 사람(첫 관리자)의 사용자 API

test.beforeAll(async () => {
  test.setTimeout(120_000);
  ({ app, win } = await launchDesktop());
  api = await userApi();
  await expectHeading(win, CHAT.h1);
});
test.afterAll(async () => app?.close());

const skillList = (p: Page) => p.getByRole('list', { name: '스킬 목록' });
const skillRow = (p: Page, name: string) => skillList(p).locator(`li[data-skill="${name}"]`);
const usedOf = async (name: string) =>
  (await api.get<{ name: string; used: number }[]>('/api/skills')).find((s) => s.name === name)?.used ?? -1;

test('스킬 메뉴: 스타터 스킬 6개 (이름 · 설명 · 내장 · 사용 횟수) · 문서 스킬만 쓰는 도구 = 파일 만들기 · 없앤 스킬', async () => {
  await openSettings(win, SKILLS);
  await expect(skillList(win).locator('li')).toHaveCount(6);
  await expect(skillList(win).locator('li b')).toHaveText(STARTERS);
  await expect(win.locator('.sec-head .count').first()).toHaveText('6');
  const compare = skillRow(win, 'compare-table');
  await expect(compare.locator('.badge')).toHaveText('내장');
  await expect(compare.locator('.sk-name')).toHaveText('compare-table');
  await expect(compare.locator('.row-sub')).toContainText('비교하는 표');
  await expect(skillList(win).locator('.sk-tools')).toHaveCount(4); // 문서 스킬 4개 = make_file
  await expect(skillRow(win, 'word-doc').locator('.sk-tools')).toHaveText('파일 만들기');
  await expect(compare.locator('.sk-tools')).toHaveCount(0);
  for (const gone of ['email-reply', 'meeting-prep', 'skill-creator']) await expect(skillRow(win, gone)).toHaveCount(0);
  await expect(win.getByText('스킬 만들기')).toHaveCount(0);
  await expect(win.getByText('아직 Skill이 없어요')).toHaveCount(0); // 빈 상태 대신 목록
  await expect(win.locator('.page-title .chip')).toHaveCount(0); // '준비 중' 딱지 없음
  await win.screenshot({ path: shot('desktop-skills-menu'), animations: 'disabled' });
});

test('스킬 메뉴: 문서 디자인 견본 4종 (견본 쪽 그림 · 이름 · 설명 · 고르는 말) = GET /api/designs', async () => {
  await openSettings(win, SKILLS);
  const cards = win.getByRole('list', { name: '문서 디자인 목록' }).getByRole('listitem');
  await expect(cards).toHaveCount(4);
  await expect(cards.locator('b')).toHaveText(['깔끔', '보고서', '모던', '따뜻함']);
  await expect(cards.nth(1)).toContainText('"보고서 디자인으로 만들어 줘" 처럼 말하면 돼요');
  const thumbs = cards.locator('.dz-thumb img');
  await expect(thumbs).toHaveCount(4, { timeout: 15_000 });
  for (const img of await thumbs.all()) await expect(img).toHaveAttribute('src', /^data:image\/png;base64,/);
  expect(await separatorsOnScreen(win)).toEqual([]);
  await win.getByRole('heading', { name: '문서 디자인' }).scrollIntoViewIfNeeded();
  await win.screenshot({ path: shot('desktop-skills-designs'), animations: 'disabled' });
});

test('대화: 스킬 사용 카드 → 답 · 단계 = 스킬: 비교표 만들기 → 답 쓰기', async () => {
  const before = await usedOf('compare-table');
  await openMenu(win, NAV, CHAT);
  // 상태 줄 글이 바뀐 순서를 모은다 ([fake:slow] = 조각마다 250ms → 단계마다 글이 보인다)
  await win.evaluate(() => {
    const texts: string[] = [];
    (window as any).__texts = texts;
    new MutationObserver(() => {
      const t = [...document.querySelectorAll('.msg.agent .trace-line .trace-txt')].pop()?.textContent ?? '';
      if (t && texts.at(-1) !== t) texts.push(t);
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await win.getByRole('textbox', { name: '요청 입력' }).fill('[fake:slow] 노트북 두 개 비교해 줘 [fake:skill compare-table]');
  await win.getByRole('button', { name: '보내기', exact: true }).click();
  const answer = win.locator('.msg.agent:not(.fail)').last();
  const line = answer.locator('.trace-line');
  // 상태 줄: 스킬을 펼치는 중 → 답을 다듬는 중
  await expect(line).toHaveAttribute('data-step', /^(skill:compare-table|writing|done)$/, { timeout: 15_000 });
  await expect(answer).toContainText("스킬 '비교표 만들기' 지침을 따랐어요.", { timeout: 30_000 });
  await expect(line).toHaveAttribute('data-step', 'done');
  await expect(line.locator('.trace-txt .seg')).toHaveText(['스킬 사용 1회', /^\d+(\.\d)?초$/]); // 칸 나눔 (가운뎃점 없음)
  await expect(line).toHaveAttribute('data-glyph', 'tool'); // 생각 없이 도구만 = 렌치
  const texts = (await win.evaluate(() => (window as any).__texts)) as string[];
  expect(texts).toContain("'비교표 만들기' 스킬을 펼치는 중");
  expect(texts).toContain('답을 다듬는 중');
  expect(texts.indexOf("'비교표 만들기' 스킬을 펼치는 중")).toBeLessThan(texts.indexOf('답을 다듬는 중'));
  await line.click(); // 패널 펼치기 = 스킬 카드
  const panel = answer.getByRole('region', { name: '생각과 도구 사용 과정' });
  await expect(panel.locator('.tp-tool b')).toHaveText(['스킬 사용']);
  const skill = panel.getByRole('group', { name: '스킬 사용' });
  await expect(skill).toHaveAttribute('data-tool', 'use_skill');
  await expect(skill.locator('.th b')).toHaveText('스킬 사용');
  await expect(skill.locator('dl')).toContainText('스킬비교표 만들기');
  await expect(skill.locator('dl')).toContainText(/결과지침 불러옴 \(\d+줄\)/);
  await expect(skill.locator('dl')).not.toContainText('하지 않는 것'); // 지침 본문은 모델만 본다
  await win.screenshot({ path: shot('desktop-chat-skill-tool'), animations: 'disabled' });
  expect(await usedOf('compare-table')).toBe(before + 1);

  // 다시 열어도 (서버 기록) 같은 카드 — 지침 본문 없이
  const runs = await api.get<{ thread_id: string; steps: { name: string; label: string }[] }[]>('/api/runs');
  expect(runs[0].steps.map((s) => s.label)).toEqual(['스킬: 비교표 만들기', '답 쓰기']);
  const thread = await api.get<{ messages: { parts?: { name?: string; result?: Record<string, unknown> }[] }[] }>(`/api/threads/${runs[0].thread_id}`);
  const card = thread.messages[1].parts?.[0];
  expect(card?.name).toBe('use_skill');
  expect(card?.result).not.toHaveProperty('instructions');
});

test('스킬 메뉴의 사용 횟수가 올라간다', async () => {
  await openSettings(win, SKILLS);
  await expect(skillRow(win, 'compare-table').locator('.used')).toHaveText(/^\d+번 사용$/);
  await expect(skillRow(win, 'summarize').locator('.used')).toHaveText(/^(아직 안 씀|\d+번 사용)$/);
});
