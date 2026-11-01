import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchDesktop } from './auth';
import { separatorsOnScreen } from './copy-rule';
import { expectHeading, goHash } from './helpers';

// UI 문구 규칙 (AGENTS.md): 가운뎃점(·) 구분자 없음 — 칸 나눔(여백) 또는 쉼표.
// 데스크톱 주요 화면에 그려진 글 · 속성을 훑는다: 홈 · 모델 메뉴 · 생각과 도구를 펼친 대화 · 메뉴 화면들. 문구 파일 검사 = admin-copy.spec.ts
const HOME_H1 = '무엇을 맡길까요?';
const ui = (win: Page) => ({
  box: win.getByRole('textbox', { name: '요청 입력' }),
  send: win.getByRole('button', { name: '보내기', exact: true }),
  last: win.locator('.msg.agent:not(.fail)').last(),
  model: win.locator('.composer .mpick-btn'),
  menu: win.getByRole('dialog', { name: '모델과 생각 깊이' }),
});
const clean = async (win: Page, where: string) => expect(await separatorsOnScreen(win), where).toEqual([]);

test.describe('데스크톱: 가운뎃점 없음', () => {
  test.describe.configure({ mode: 'serial' });
  let app: ElectronApplication;
  let win: Page;
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    ({ app, win } = await launchDesktop());
    await expectHeading(win, HOME_H1);
  });
  test.afterAll(async () => app?.close());

  test('홈 · 모델 메뉴', async () => {
    await clean(win, 'home');
    await ui(win).model.click();
    await expect(ui(win).menu.locator('[role="option"]').first()).toBeVisible();
    await clean(win, 'picker');
    await win.keyboard.press('Escape');
    await expect(ui(win).menu).toBeHidden();
  });

  test('대화: 생각 → 스킬 → 답, 펼친 과정 · 답 아래 줄', async () => {
    await ui(win).box.fill('[fake:think] 이 대화를 요약해 줘\n[fake:skill summarize]');
    await ui(win).send.click();
    const answer = ui(win).last;
    await expect(answer).toContainText("스킬 '요약' 지침을 따랐어요", { timeout: 20_000 });
    await expect(answer).toHaveAttribute('aria-busy', 'false');
    await answer.locator('.trace-line').click();
    await expect(answer.getByRole('region', { name: '생각과 도구 사용 과정' }).locator('[data-kind="tool"]')).toBeVisible();
    await clean(win, 'thread');
  });

  test('메뉴 화면: 진행 상황 · 예약 작업 · 스킬 · 연결된 앱 · 설정', async () => {
    const screens = [['activity', '진행 상황'], ['scheduled', '예약 작업'], ['skills', '스킬'], ['connections', '연결된 앱'], ['settings', '설정']];
    for (const [id, h1] of screens) {
      await goHash(win, `#/${id}`);
      await expectHeading(win, h1);
      await expect(win.locator('.rows-state').filter({ hasText: '불러오는 중' })).toHaveCount(0);
      await clean(win, id);
    }
  });
});
