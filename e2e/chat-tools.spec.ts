import { test, expect, type ElectronApplication, type Page, type Request } from '@playwright/test';
import { launchDesktop } from './auth';
import { expectHeading, shot } from './helpers';

// 도구 실행 흐름: 새 대화 홈의 '도구 시험' 제안 (누르면 바로 보냄) · 병렬 도구(한 응답에 여럿 = 동시에) 묶음 · 여러 단계 · 보내기 전환.
// mock 표시: [fake:parallel] → 현재 시각(서울 · 뉴욕) + 단위 변환을 한 응답에 · [fake:chain] → 현재 시각 → 날짜 계산 → 회의 준비 스킬 → 답
//   · [fake:slow] = 조각마다 250ms (도는 중 모습). 진짜 모델에선 제안 글만으로 도구를 부른다 (표시 없음)
const HOME_H1 = '무엇을 맡길까요?';
const PARALLEL_STARTER = '서울이랑 뉴욕 지금 몇 시인지 알려 주고 시차도 계산해 줘';

const ui = (win: Page) => ({
  box: win.getByRole('textbox', { name: '요청 입력' }),
  send: win.getByRole('button', { name: '보내기', exact: true }),
  log: win.getByRole('log', { name: '대화 내용' }),
  composer: win.locator('.composer').first(),
  last: win.locator('.msg.agent:not(.fail)').last(),
  tryList: win.getByRole('list', { name: '도구 시험' }),
});

async function home(win: Page) {
  await win.getByRole('button', { name: '새 대화' }).click();
  await expectHeading(win, HOME_H1);
}
const idle = (win: Page) => expect(ui(win).last).toHaveAttribute('aria-busy', 'false', { timeout: 20_000 });
async function openTrace(win: Page) {
  const line = ui(win).last.locator('.trace-line');
  if ((await line.getAttribute('aria-expanded')) !== 'true') await line.click();
  return ui(win).last.locator('.trace-panel');
}

test.describe.configure({ mode: 'serial' });
let app: ElectronApplication;
let win: Page;
test.beforeAll(async () => {
  test.setTimeout(120_000);
  ({ app, win } = await launchDesktop());
  await expectHeading(win, HOME_H1);
});
test.afterAll(async () => app?.close());

test('홈: 제안 아래 "도구 시험" 묶음 (동시 실행 · 여러 단계 꼬리표)', async () => {
  const list = ui(win).tryList;
  await expect(list.getByRole('button')).toHaveCount(3);
  await expect(list.locator('.need')).toHaveText(['동시 실행', '동시 실행', '여러 단계']);
  await expect(list.getByRole('button').first()).toHaveAttribute('data-prompt', PARALLEL_STARTER);
  await win.screenshot({ path: shot('desktop-tools-home'), animations: 'disabled' });
});

test('제안을 누르면 입력창에 넣지 않고 바로 보낸다 (요청에 그 글) · 입력창은 제자리 · 홈 복제본은 사라진다', async () => {
  const { box, composer, log } = ui(win);
  const before = await composer.boundingBox();
  const sent = win.waitForRequest((r) => r.url().endsWith('/api/chat') && r.method() === 'POST');
  await ui(win).tryList.getByRole('button').first().click();
  const body = (await sent).postDataJSON() as { messages: { role: string; content: unknown }[] };
  expect(body.messages.at(-1)).toMatchObject({ role: 'user', content: PARALLEL_STARTER });
  await expect(log.locator('.msg.user')).toHaveText([PARALLEL_STARTER]);
  await expect(box).toHaveValue('');
  await expect(win.locator('.home-ghost')).toHaveCount(0, { timeout: 2000 }); // 빠지는 홈 = 잠깐의 그림 (남지 않는다)
  // 움직임이 다 끝난 뒤: 입력창이 같은 자리 (홈 → 대화 화면에서 튀지 않는다) · 말풍선은 제자리
  await expect.poll(() => win.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)).toBe(0);
  const after = await composer.boundingBox();
  expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(2);
  await idle(win);
});

test('병렬 도구: 한 응답의 도구 3개 = "동시에 3개" 묶음 · 카드마다 상태와 시간 · 실행 시간 vs 하나씩이면', async () => {
  const { box, send } = ui(win);
  await box.fill('[fake:parallel] [fake:slow] 서울 뉴욕 시각이랑 68F 섭씨로');
  await send.click();
  const panel = await openTrace(win);
  const group = panel.locator('[data-kind="parallel"]');
  // 도는 중: 상태 줄 = 동시에 쓰는 중 · 묶음 머리 = n개 실행 중 · 카드는 각자 실행 중
  await expect(ui(win).last.locator('.trace-line')).toHaveAttribute('aria-label', /^도구 [23]개를 동시에 쓰는 중$/, { timeout: 15_000 });
  await expect(group.locator('.tp-par-meta')).toContainText('실행 중');
  await win.screenshot({ path: shot('desktop-tools-parallel-running'), animations: 'disabled' });
  await idle(win);
  await expect(group).toHaveCount(1);
  await expect(group).toHaveAttribute('aria-label', '동시에 3개');
  const cards = group.locator('[data-kind="tool"]');
  await expect(cards).toHaveCount(3);
  await expect(cards.locator('.th b')).toHaveText(['현재 시각', '현재 시각', '단위 변환']);
  for (const i of [0, 1, 2]) {
    await expect(cards.nth(i)).toHaveAttribute('data-state', 'done');
    await expect(cards.nth(i).locator('.tst .tm')).toHaveText(/^\d+(\.\d)?(초|ms)$/); // 묶음 안 카드 = 실행 시간 (머리 줄과 같은 뜻)
  }
  await expect(cards.nth(1).locator('dd').first()).toHaveText('America/New_York');
  await expect(group.locator('.tp-par-meta .ui-meta-item')).toHaveText([/^실행 \d/, /^ ?하나씩이면 \d/]);
  // 머리 줄 '하나씩이면' = 카드 시간의 합 (같은 뜻 · 반올림 차이만)
  const ms = (t: string) => (t.endsWith('ms') ? Number(t.slice(0, -2)) : Number(t.replace('초', '')) * 1000);
  const sum = (await cards.locator('.tst .tm').allTextContents()).reduce((n, t) => n + ms(t), 0);
  const serial = ms((await group.locator('.tp-par-meta .ui-meta-item').nth(1).textContent())!.replace(/^ ?하나씩이면 /, ''));
  expect(Math.abs(sum - serial)).toBeLessThanOrEqual(Math.max(3, serial * 0.1));
  // 내장 도구는 몇 ms 만에 끝난다 → 실행 칸이 안 보이는 시간 막대는 그리지 않는다
  await expect(group.locator('.tp-lane')).toHaveCount(0);
  await expect(ui(win).last.locator('.txt')).toContainText('68 °F = 20 °C');
  await win.screenshot({ path: shot('desktop-tools-parallel-done'), animations: 'disabled' });
});

test('여러 단계: 현재 시각 → 날짜 계산 → 회의 준비 스킬 → 답 (차례대로 = 묶음 없음)', async () => {
  await home(win);
  const { box, send } = ui(win);
  await box.fill('[fake:chain] 크리스마스까지 세고 송년회 준비');
  await send.click();
  await idle(win);
  const panel = await openTrace(win);
  await expect(panel.locator('[data-kind="parallel"]')).toHaveCount(0);
  await expect(panel.locator('[data-kind="tool"] .th b')).toHaveText(['현재 시각', '날짜 계산', '스킬 사용']);
  await expect(ui(win).last.locator('.txt')).toContainText("스킬 '회의 준비' 지침을 따랐어요");
  await win.screenshot({ path: shot('desktop-tools-chain'), animations: 'disabled' });
});

test('기록에서 다시 열어도 같은 묶음 (새 창 = 서버 기록 · 시간 막대 없이)', async () => {
  const fresh = await launchDesktop();
  try {
    await expectHeading(fresh.win, HOME_H1);
    // 제안으로 시작한 대화 (둘째 턴 = 병렬)
    await fresh.win.getByRole('list', { name: '최근' }).getByRole('button', { name: /^서울이랑 뉴욕 지금 몇 시인지/ }).first().click();
    await expect(ui(fresh.win).log.locator('.msg.user')).toHaveCount(2);
    const panel = await openTrace(fresh.win);
    const group = panel.locator('[data-kind="parallel"]');
    await expect(group).toHaveAttribute('aria-label', '동시에 3개');
    await expect(group.locator('[data-kind="tool"]')).toHaveCount(3);
    await expect(group.locator('.tp-lane')).toHaveCount(0); // 기록엔 시간이 없다
  } finally {
    await fresh.app.close();
  }
});

test('움직임 줄이기: 홈 복제본 · 말풍선 이동 없이 바로 끝 모양', async () => {
  await win.emulateMedia({ reducedMotion: 'reduce' });
  await home(win);
  const ghosts = win.evaluate(() => new Promise<number>((resolve) => {
    let n = 0;
    const o = new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((x) => { if (x instanceof HTMLElement && x.classList.contains('home-ghost')) n++; })));
    o.observe(document.body, { childList: true });
    setTimeout(() => { o.disconnect(); resolve(n); }, 800);
  }));
  await ui(win).tryList.getByRole('button').nth(1).click();
  await expect(ui(win).log.locator('.msg.user')).toHaveCount(1);
  expect(await ghosts).toBe(0);
  expect(await ui(win).log.locator('.msg.user .bubble').evaluate((el) => el.getAnimations().length)).toBe(0);
  await idle(win);
  await win.emulateMedia({ reducedMotion: 'no-preference' });
});

test('이어서 보내면 새 말풍선이 아래에서 떠오른다 (가벼운 전환)', async () => {
  const { box, send, log } = ui(win);
  await box.fill('하나 더');
  await send.click();
  const bubble = log.locator('.msg.user').last();
  await expect(bubble).toHaveText('하나 더');
  expect(await bubble.evaluate((el) => getComputedStyle(el).animationName)).toBe('bubble-in');
  await idle(win);
});

test('제안을 두 번 눌러도 한 번만 보낸다 (보낸 뒤엔 홈이 사라지고 도는 중엔 막힌다)', async () => {
  await home(win);
  const posts: string[] = [];
  const onReq = (r: Request) => {
    if (r.url().endsWith('/api/chat') && r.method() === 'POST') posts.push(r.url());
  };
  win.on('request', onReq);
  try {
    await ui(win).tryList.getByRole('button').nth(1).dblclick();
    await expect(ui(win).log.locator('.msg.user')).toHaveCount(1);
    await idle(win);
    expect(posts).toHaveLength(1);
    await expect(ui(win).log.locator('.msg.user')).toHaveCount(1);
  } finally {
    win.off('request', onReq);
  }
});
