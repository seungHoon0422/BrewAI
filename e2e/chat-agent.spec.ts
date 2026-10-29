import { test, expect, chromium, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ADMIN_URL, API } from './env';
import { expectHeading, shot } from './helpers';

// 대화 관통 2 (모델 통신): 멀티턴 · 생각(추론) · 도구 카드 · 상태 줄 · 모델 고르기 · 기록 다시 열기 · 진행 상황 · 멈추기
// + P2-1 (관리자가 숨기면 사용자 모델 메뉴에서 빠진다). 서버 = config.webServer (mock 게이트웨이 · conductor · 관리자 preview)
// mock 표시(마지막 질문에): [fake:think] 생각 조각 · [fake:calc] <수식> 계산기 (줄 끝까지가 수식 → 마지막 줄에) · [fake:slow] 조각마다 250ms
const APP = path.join(__dirname, '..', 'apps', 'desktop');
const HOME_H1 = '무엇을 맡길까요?';
const browserChannel = process.platform === 'darwin' ? 'chrome' : process.platform === 'win32' ? 'msedge' : undefined;

async function launch() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'brewai-e2e-'));
  const app = await electron.launch({ args: [APP], env: { ...process.env, BREWAI_API_URL: API, BREWAI_USER_DATA: userData } });
  const win = await app.firstWindow();
  await expectHeading(win, HOME_H1);
  return { app, win };
}

const ui = (win: Page) => ({
  box: win.getByRole('textbox', { name: '요청 입력' }),
  send: win.getByRole('button', { name: '보내기', exact: true }),
  stop: win.getByRole('button', { name: '멈추기', exact: true }),
  log: win.getByRole('log', { name: '대화 내용' }),
  model: win.locator('.composer .model'),
  menu: win.getByRole('menu', { name: '모델과 생각 깊이' }),
  last: win.locator('.msg.agent:not(.fail)').last(),
  status: win.locator('.msg.agent .act').last(),
  recent: win.getByRole('list', { name: '최근' }),
});

async function ask(win: Page, text: string) {
  await ui(win).box.fill(text);
  await ui(win).send.click();
}

async function openPicker(win: Page) {
  const { model, menu } = ui(win);
  if ((await model.getAttribute('aria-expanded')) !== 'true') await model.click();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitemradio').first()).toBeVisible();
  return menu;
}

async function closePicker(win: Page) {
  await win.keyboard.press('Escape');
  await expect(ui(win).menu).toHaveCount(0);
}

// 상태 줄(.act)의 단계(data-step)와 글이 바뀐 순서를 모은다 (같은 값이 이어지면 하나로). 첫 칸 = 시작 전 값 (읽을 때 뺀다)
async function recordSteps(win: Page) {
  await win.evaluate(() => {
    const steps: string[] = [];
    const texts: string[] = [];
    (window as any).__rec = { steps, texts };
    const note = () => {
      const act = [...document.querySelectorAll('.msg.agent .act')].pop();
      const v = act?.getAttribute('data-step') ?? '';
      const t = act?.querySelector('.txt')?.textContent ?? '';
      if (steps.at(-1) !== v) steps.push(v);
      if (texts.at(-1) !== t) texts.push(t);
    };
    note();
    (window as any).__recObserver?.disconnect();
    const o = new MutationObserver(note);
    o.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-step'] });
    (window as any).__recObserver = o;
  });
}
const recorded = (win: Page) =>
  win.evaluate(() => {
    const r = (window as any).__rec as { steps: string[]; texts: string[] };
    return { steps: r.steps.slice(1).filter((s) => s !== 'waiting'), texts: r.texts.slice(1) };
  });

test.describe('모델 · 생각 · 도구 · 상태 줄', () => {
  test.describe.configure({ mode: 'serial' });
  let app: ElectronApplication;
  let win: Page;
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    ({ app, win } = await launch());
  });
  test.afterAll(async () => app?.close());

  test('모델 메뉴: 회사별 묶음 · 기본 표시 · 생각 깊이 (지원 안 하는 모델은 못 고름)', async () => {
    await expect(ui(win).model).toHaveText('fake-chat-small');
    await expect(ui(win).model.locator('svg[data-provider="openai"]')).toHaveCount(1); // 버튼에도 회사 아이콘
    const menu = await openPicker(win);
    // 기본 모델(OpenAI)이 맨 위 묶음 → Anthropic
    await expect(menu.locator('h6')).toHaveText(['OpenAI', 'Anthropic', '생각 깊이']);
    await expect(menu.locator('h6 svg[data-provider]')).toHaveCount(2);
    await expect(menu.locator('h6').nth(0).locator('svg')).toHaveAttribute('data-provider', 'openai');
    await expect(menu.locator('h6').nth(1).locator('svg')).toHaveAttribute('data-provider', 'anthropic');
    const small = menu.getByRole('menuitemradio', { name: /^fake-chat-small/ });
    await expect(small).toHaveAttribute('aria-checked', 'true');
    await expect(small).toContainText('기본');
    await expect(small).toBeFocused(); // 열면 고른 항목에 포커스
    await expect(menu.getByRole('menuitemradio', { name: /fake-embed/ })).toHaveCount(0); // 임베딩 = 대화 모델 아님
    // fake-chat-small 은 생각을 지원하지 않는다 → 생각 깊이 셋 다 못 고름
    for (const name of [/^끄기/, /^보통/, /^깊게/]) {
      await expect(menu.getByRole('menuitemradio', { name })).toHaveAttribute('aria-disabled', 'true');
    }
    await expect(menu).toContainText('이 모델은 생각 깊이를 고를 수 없어요');
    await expect(menu).toContainText('허용된 모델만 보여요');
    await win.screenshot({ path: shot('desktop-model-menu'), animations: 'disabled' }); // 메뉴 fade(.14s) 끝난 모습
    await closePicker(win);
    await expect(ui(win).model).toBeFocused(); // Esc = 닫고 버튼으로
  });

  test('키보드로 모델 고르기 (↓ 열기 · ↓ 이동 · Enter 고르기 · Esc 닫기)', async () => {
    await ui(win).model.focus();
    await win.keyboard.press('ArrowDown');
    const menu = ui(win).menu;
    await expect(menu.getByRole('menuitemradio', { name: /^fake-chat-small/ })).toBeFocused();
    await win.keyboard.press('ArrowDown');
    const large = menu.getByRole('menuitemradio', { name: /^fake-chat-large/ });
    await expect(large).toBeFocused();
    await win.keyboard.press('Enter');
    await expect(large).toHaveAttribute('aria-checked', 'true');
    // 생각을 지원하는 모델 → 생각 깊이도 고를 수 있다 (못 고르는 항목은 화살표가 건너뛴다)
    await expect(menu.getByRole('menuitemradio', { name: /^깊게/ })).not.toHaveAttribute('aria-disabled', 'true');
    await win.keyboard.press('End');
    await expect(menu.getByRole('menuitemradio', { name: /^깊게/ })).toBeFocused();
    await win.keyboard.press('Home');
    await expect(menu.getByRole('menuitemradio', { name: /^fake-chat-small/ })).toBeFocused();
    await win.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(ui(win).model).toBeFocused();
    await expect(ui(win).model).toHaveText('fake-chat-large');
    await expect(ui(win).model.locator('svg[data-provider="anthropic"]')).toHaveCount(1);
  });

  test('고른 모델로 답한다 (요청에 model 이 실린다) · 답 아래에 답한 모델', async () => {
    await ask(win, '어느 모델이 답하나요');
    await expectHeading(win, '어느 모델이 답하나요');
    await expect(ui(win).last).toContainText('가짜 게이트웨이(fake-chat-large)가 답해요', { timeout: 15_000 });
    const by = ui(win).last.locator('.by');
    await expect(by).toContainText('fake-chat-large');
    await expect(by.locator('svg')).toHaveAttribute('data-provider', 'anthropic');
    await expect(ui(win).status).toHaveAttribute('data-step', 'done');
    await expect(ui(win).status).toContainText('완료');
  });

  test('멀티턴: 두 번째 질문의 답이 첫 질문을 안다 (서버 기록)', async () => {
    await ask(win, '이어서 두 번째 질문');
    await expect(ui(win).log.locator('.msg.user')).toHaveText(['어느 모델이 답하나요', '이어서 두 번째 질문']);
    await expect(ui(win).last).toContainText('받은 질문: 이어서 두 번째 질문 · 이전 질문: 어느 모델이 답하나요', { timeout: 15_000 });
    // 지난 답의 상태 줄은 접고 모델 · 걸린 시간만 남긴다 (상태 줄 = 마지막 답에만)
    await expect(ui(win).log.locator('.msg.agent .act')).toHaveCount(1);
    await expect(ui(win).log.locator('.msg.agent').first().locator('.by')).toContainText(/fake-chat-large\s*·\s*\d/);
  });

  test('생각 깊이 = 깊게 → 생각 블록이 흐르다가 끝나면 접힌다 · 다시 펼칠 수 있다', async () => {
    const menu = await openPicker(win);
    await menu.getByRole('menuitemradio', { name: /^깊게/ }).click();
    await expect(menu.getByRole('menuitemradio', { name: /^깊게/ })).toHaveAttribute('aria-checked', 'true');
    await closePicker(win);
    await expect(ui(win).model).toHaveText(/^fake-chat-large\s*· 깊게$/);

    await ask(win, '[fake:slow] 천천히 생각해서 답해 줘');
    const think = ui(win).last.locator('.think');
    const head = think.getByRole('button');
    // 흐르는 중 = 펼침 + '생각하는 중'
    await expect(head).toContainText('생각하는 중', { timeout: 10_000 });
    await expect(head).toHaveAttribute('aria-expanded', 'true');
    await expect(think.locator('.think-body')).toBeVisible();
    await expect(think.locator('.think-body')).toContainText('질문을 살펴보는 중이에요');
    await expect(ui(win).status).toHaveAttribute('data-step', 'thinking');
    await expect(ui(win).status).toContainText('생각하는 중');
    // 끝나면 접힘 + '생각 · 1.2초'
    await expect(ui(win).status).toHaveAttribute('data-step', 'done', { timeout: 20_000 });
    await expect(head).toHaveAttribute('aria-expanded', 'false');
    await expect(head).toHaveText(/^생각\s*\d+(\.\d)?초/);
    await expect(think.locator('.think-body')).toBeHidden();
    await head.click();
    await expect(think.locator('.think-body')).toBeVisible();
    await expect(think.locator('.think-body')).toContainText('필요한 도구가 있는지 확인해요');
    await expect(ui(win).last.locator('.by')).toContainText('생각 깊게');
    await win.screenshot({ path: shot('desktop-chat-reasoning') });
  });

  test('도구: 계산기 카드(수식 · 결과 · 완료) + 상태 줄이 생각 → 계산기 → 답 쓰기 → 완료 순서로', async () => {
    await recordSteps(win);
    await ask(win, '[fake:slow] 2의 10제곱에 1을 더하면?\n[fake:calc] 2**10 + 1');
    const card = ui(win).last.getByRole('group', { name: '계산기 도구' });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText('실행 중');
    await expect(card).toContainText('완료', { timeout: 15_000 });
    await expect(card.locator('dl')).toContainText('수식2**10 + 1');
    await expect(card.locator('dl')).toContainText('결과1025');
    await expect(ui(win).last).toContainText('계산 결과는 1025예요. (수식 2**10 + 1)', { timeout: 15_000 });
    await expect(ui(win).status).toHaveAttribute('data-step', 'done');
    await expect(ui(win).status).toContainText(/완료\s*\d+(\.\d)?초\s*· 도구 1번/);
    const rec = await recorded(win);
    expect(rec.steps).toEqual(['thinking', 'tool:calculator', 'writing', 'done']);
    // 화면 글: 생각하는 중 → 계산기 실행 중 → (결과 살펴보는 중) → 답 쓰는 중 → 완료
    expect(rec.texts.filter((x) => x !== '결과 살펴보는 중' && x !== '응답 기다리는 중')).toEqual(['생각하는 중', '계산기 실행 중', '답 쓰는 중', '완료']);
    // 상태 줄을 누르면 단계별 걸린 시간
    await ui(win).status.click();
    const list = ui(win).last.getByRole('list', { name: '진행 과정' });
    await expect(list.locator('li .nm')).toHaveText(['생각', '계산기', '답 쓰기']);
    await win.screenshot({ path: shot('desktop-chat-tool') });
  });

  test('멈추기: 답을 쓰는 중 멈추면 받은 글은 남고 "멈춤" + 다시 시도', async () => {
    // 생각 없이 빠르게 (끄기) — 그래도 [fake:slow] 라 몇 초 걸린다
    const menu = await openPicker(win);
    await menu.getByRole('menuitemradio', { name: /^끄기/ }).click();
    await closePicker(win);
    await expect(ui(win).model).toHaveText('fake-chat-large');
    await ask(win, '[fake:slow] 길게 답해 줘');
    await expect(ui(win).status).toHaveAttribute('data-step', 'writing', { timeout: 10_000 });
    await ui(win).stop.click();
    await expect(ui(win).status).toHaveAttribute('data-step', 'stopped');
    await expect(ui(win).status).toContainText('멈춤');
    await expect(ui(win).last).toContainText('안녕하세요!');
    await expect(ui(win).send).toBeVisible(); // 멈추면 다시 보내기 버튼
    // 멈춘 바로 뒤 = 서버가 아직 끊김을 모를 수 있다 (409 thread_busy) → 화면은 잠깐 기다렸다 다시 보낸다
    await ui(win).last.getByRole('button', { name: '다시 시도' }).click();
    await expect(ui(win).last).toContainText('받은 질문: [fake:slow] 길게 답해 줘', { timeout: 20_000 });
    await expect(ui(win).status).toHaveAttribute('data-step', 'done', { timeout: 20_000 });
    await expect(ui(win).log.getByRole('alert')).toHaveCount(0);
    await expect(ui(win).log.locator('.msg.user')).toHaveCount(5); // 다시 시도가 질문을 늘리지 않는다
  });
});

test.describe('기록 · 진행 상황', () => {
  test.describe.configure({ mode: 'serial' });
  let app: ElectronApplication;
  let win: Page;
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    ({ app, win } = await launch());
  });
  test.afterAll(async () => app?.close());

  test('최근 = 서버 대화 기록 → 누르면 기록을 불러와 이어서 묻는다 (생각 · 도구 카드도 그대로)', async () => {
    // 앞 describe 의 창이 남긴 대화 = 새 창(메모리 없음)에서 서버 기록으로만 보인다
    const item = ui(win).recent.getByRole('button', { name: '어느 모델이 답하나요' });
    await expect(item).toBeVisible();
    await item.click();
    await expectHeading(win, '어느 모델이 답하나요');
    await expect(item).toHaveAttribute('aria-current', 'true');
    const { log } = ui(win);
    await expect(log.locator('.msg.user').nth(0)).toHaveText('어느 모델이 답하나요');
    await expect(log.locator('.msg.user')).toHaveCount(5); // 멈춘 실행은 기록에 없고, 다시 시도한 답만 남는다
    await expect(log.getByRole('group', { name: '계산기 도구' })).toContainText('결과1025');
    const think = log.locator('.think').first();
    await expect(think.getByRole('button')).toHaveAttribute('aria-expanded', 'false'); // 기록의 생각 = 접힘
    await expect(log.locator('.msg.agent').first().locator('.by svg')).toHaveAttribute('data-provider', 'anthropic');
    // 이어서 묻기 = 같은 thread (서버가 앞 기록을 모델에 준다)
    await ask(win, '기록 다음 질문');
    await expect(ui(win).last).toContainText('이전 질문: [fake:slow] 길게 답해 줘', { timeout: 15_000 });
    await win.screenshot({ path: shot('desktop-chat-history') });
  });

  test('새 대화 → 다른 메뉴로 가도 답은 계속 받는다 · 진행 상황에 지금 하는 일이 실시간으로', async () => {
    await win.getByRole('button', { name: '새 대화' }).click();
    await expectHeading(win, HOME_H1);
    await ask(win, '[fake:slow] [fake:think] 진행 상황 확인');
    // 사이드바 최근에 바로 뜬다 (진행 중 표시)
    const item = ui(win).recent.getByRole('button', { name: /진행 상황 확인/ });
    await expect(item.getByRole('img', { name: '답 쓰는 중' })).toBeVisible();
    await win.getByRole('navigation', { name: '메뉴' }).getByRole('link', { name: '진행 상황' }).click();
    await expectHeading(win, '진행 상황');
    const live = win.locator('.run-live');
    await expect(live).toHaveCount(1);
    await expect(live).toContainText('[fake:slow] [fake:think] 진행 상황 확인');
    await expect(live.locator('.doing')).toHaveText(/생각하는 중|답 쓰는 중/);
    await expect(live.locator('.mtag svg')).toHaveAttribute('data-provider', 'openai');
    await win.screenshot({ path: shot('desktop-activity-live') });
    // 끝나면 최근 실행으로 (완료 · 단계 줄)
    await expect(live).toHaveCount(0, { timeout: 20_000 });
    const runs = win.getByRole('list', { name: '최근 실행' });
    const first = runs.locator('li.row').first();
    await expect(first).toContainText('[fake:slow] [fake:think] 진행 상황 확인');
    await expect(first).toHaveAttribute('data-status', 'done');
    await expect(first.locator('.chain')).toContainText('생각');
    await expect(first.locator('.chain')).toContainText('답 쓰기');
    // 멈춘 실행 = '중간에 멈춤'
    await expect(runs.locator('li.row[data-status="cancelled"]').first()).toContainText('중간에 멈춤');
    await win.screenshot({ path: shot('desktop-activity') });
    // 대화로 돌아가면 답이 끝까지 와 있다
    await first.getByRole('button').first().click();
    await expectHeading(win, '[fake:slow] [fake:think] 진행 상황 확인');
    await expect(ui(win).last).toContainText('받은 질문: [fake:slow] [fake:think] 진행 상황 확인');
  });
});

test.describe('P2-1 관리자가 숨기면 사용자 모델 메뉴에서 빠진다', () => {
  test.describe.configure({ mode: 'serial' });
  let app: ElectronApplication;
  let win: Page;
  let admin: Page;
  let close: () => Promise<void>;
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    ({ app, win } = await launch());
    const browser = await chromium.launch({ channel: browserChannel });
    admin = await browser.newPage();
    close = () => browser.close();
  });
  test.afterAll(async () => {
    // 다른 스펙이 기대하는 노출 상태로 되돌린다 (fake-chat-large = 노출)
    await fetch(`${API}/api/admin/models/fake-chat-large`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ exposed: true }),
    }).catch(() => {});
    await close?.();
    await app?.close();
  });

  const exposeSwitch = () => admin.getByRole('switch', { name: '노출 — fake-chat-large' });

  test('관리자 콘솔에서 숨김 → 데스크톱 메뉴에서 사라짐 → 다시 노출 → 돌아옴 (코드 변경 0)', async () => {
    let menu = await openPicker(win);
    await menu.getByRole('menuitemradio', { name: /^fake-chat-large/ }).click(); // 고른 모델이 숨겨지는 경우까지
    await closePicker(win);
    await expect(ui(win).model).toHaveText('fake-chat-large');

    await admin.goto(`${ADMIN_URL}/#/models`);
    await expect(exposeSwitch()).toHaveAttribute('aria-checked', 'true');
    await exposeSwitch().click();
    await expect(exposeSwitch()).toHaveAttribute('aria-checked', 'false');
    await expect(admin.locator('tr[data-model="fake-chat-large"] .chip')).toHaveText('숨김');

    // 메뉴를 열면 다시 읽는다 → 숨긴 모델 없음 · 고른 모델은 기본으로 + 안내
    menu = await openPicker(win);
    await expect(menu.getByRole('menuitemradio', { name: /^fake-chat-large/ })).toHaveCount(0);
    await expect(menu.locator('h6')).toHaveText(['OpenAI', '생각 깊이']);
    await expect(ui(win).model).toHaveText('fake-chat-small');
    await expect(win.getByRole('status').filter({ hasText: '기본 모델로 바꿨어요' })).toBeVisible();
    await closePicker(win);

    await exposeSwitch().click();
    await expect(exposeSwitch()).toHaveAttribute('aria-checked', 'true');
    menu = await openPicker(win);
    await expect(menu.getByRole('menuitemradio', { name: /^fake-chat-large/ })).toHaveCount(1);
    await closePicker(win);
  });

  test('메뉴를 다시 열기 전에 숨겨져도 보내면 안내 → 목록을 새로 읽고 기본 모델로 다시 시도', async () => {
    const menu = await openPicker(win);
    await menu.getByRole('menuitemradio', { name: /^fake-chat-large/ }).click();
    await closePicker(win);
    await exposeSwitch().click();
    await expect(exposeSwitch()).toHaveAttribute('aria-checked', 'false');

    await ask(win, '숨겨진 모델로 질문');
    const alert = ui(win).log.getByRole('alert');
    await expect(alert).toContainText('고른 모델을 더 이상 쓸 수 없어요');
    await expect(ui(win).model).toHaveText('fake-chat-small'); // 목록을 새로 읽어 기본으로
    await alert.getByRole('button', { name: '다시 시도' }).click();
    await expect(ui(win).last).toContainText('가짜 게이트웨이(fake-chat-small)가 답해요', { timeout: 15_000 });
    await win.screenshot({ path: shot('desktop-model-hidden') });
  });
});
