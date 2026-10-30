import { test, expect, chromium, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { adminApi, adminSignIn, launchDesktop, type Client } from './auth';
import { ADMIN_URL, GATEWAY, GATEWAY_KEY } from './env';
import { expectHeading, shot } from './helpers';

// 대화 관통 2 (모델 통신): 멀티턴 · 생각(추론) · 도구 카드 · 상태 줄 · 모델 고르기 · 기록 다시 열기 · 진행 상황 · 멈추기
// + P2-1 (관리자가 숨기면 사용자 모델 메뉴에서 빠진다). 서버 = config.webServer (mock 게이트웨이 · conductor · 관리자 preview)
// mock 표시(마지막 질문에): [fake:think] 생각 조각 · [fake:calc] <수식> 계산기 (줄 끝까지가 수식 → 마지막 줄에) · [fake:slow] 조각마다 250ms
const HOME_H1 = '무엇을 맡길까요?';
const browserChannel = process.platform === 'darwin' ? 'chrome' : process.platform === 'win32' ? 'msedge' : undefined;

async function launch() {
  const { app, win } = await launchDesktop();
  await expectHeading(win, HOME_H1);
  return { app, win };
}

const ui = (win: Page) => ({
  box: win.getByRole('textbox', { name: '요청 입력' }),
  send: win.getByRole('button', { name: '보내기', exact: true }),
  stop: win.getByRole('button', { name: '멈추기', exact: true }),
  log: win.getByRole('log', { name: '대화 내용' }),
  model: win.locator('.composer .mpick-btn'),
  menu: win.getByRole('dialog', { name: '모델과 생각 깊이' }),
  last: win.locator('.msg.agent:not(.fail)').last(),
  status: win.locator('.msg.agent .trace-line').last(), // 생각 · 도구 상태 줄 (유리 알약)
  recent: win.getByRole('list', { name: '최근' }),
});
// 모델 줄 = 회사별 묶음 쪽 (최근 사용 묶음에도 같은 모델이 있을 수 있다)
const opt = (menu: Locator, id: string) => menu.locator(`[role="option"][data-sec="all"][data-model="${id}"]`);
const depth = (menu: Locator, name: string) => menu.getByRole('radiogroup', { name: '생각 깊이' }).getByRole('radio', { name, exact: true });

async function ask(win: Page, text: string) {
  await ui(win).box.fill(text);
  await ui(win).send.click();
}

async function openPicker(win: Page) {
  const { model, menu } = ui(win);
  if ((await model.getAttribute('aria-expanded')) !== 'true') await model.click();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('option').first()).toBeVisible();
  return menu;
}

async function closePicker(win: Page) {
  if (await ui(win).menu.count()) await win.keyboard.press('Escape');
  await expect(ui(win).menu).toHaveCount(0);
}

// 상태 줄(.trace-line)의 단계(data-step)와 글이 바뀐 순서를 모은다 (같은 값이 이어지면 하나로). 첫 칸 = 시작 전 값 (읽을 때 뺀다)
async function recordSteps(win: Page) {
  await win.evaluate(() => {
    const steps: string[] = [];
    const texts: string[] = [];
    (window as any).__rec = { steps, texts };
    const note = () => {
      const act = [...document.querySelectorAll('.msg.agent .trace-line')].pop();
      const v = act?.getAttribute('data-step') ?? '';
      const t = act?.querySelector('.trace-txt')?.textContent ?? '';
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

  test('모델 메뉴: 검색칸 · 회사별 묶음 · 기능 칩 · 자세히 · 생각 깊이 (지원 안 하는 모델은 못 고름)', async () => {
    await expect(ui(win).model).toHaveText('fake-chat-small');
    await expect(ui(win).model.locator('svg[data-provider="openai"]')).toHaveCount(1); // 버튼에도 회사 아이콘
    await expect(ui(win).model).toHaveAttribute('aria-haspopup', 'dialog');
    const menu = await openPicker(win);
    // 열면 검색칸에 바로 입력 (combobox) · 강조 = 고른 모델
    const search = menu.getByRole('combobox', { name: '모델 검색' });
    await expect(search).toBeFocused();
    await expect(search).toHaveAttribute('placeholder', '이름 또는 ID로 찾기');
    const small = opt(menu, 'fake-chat-small');
    await expect(search).toHaveAttribute('aria-activedescendant', (await small.getAttribute('id'))!);
    // 기본 모델(OpenAI)이 맨 위 묶음 → Anthropic
    await expect(menu.locator('h6')).toHaveText(['OpenAI', 'Anthropic', '생각 깊이']);
    await expect(menu.locator('h6 svg[data-provider]')).toHaveCount(2);
    await expect(menu.locator('h6').nth(0).locator('svg')).toHaveAttribute('data-provider', 'openai');
    await expect(menu.locator('h6').nth(1).locator('svg')).toHaveAttribute('data-provider', 'anthropic');
    await expect(menu.getByRole('listbox', { name: '모델' }).getByRole('option')).toHaveCount(2);
    await expect(small).toHaveAttribute('aria-selected', 'true');
    await expect(small).toHaveAccessibleName('fake-chat-small');
    await expect(small).toContainText('기본');
    await expect(small.locator('.cap')).toHaveText(['도구', '이미지']);
    await expect(small.locator('.mopt-ctx')).toHaveText('128K');
    await expect(opt(menu, 'fake-chat-large').locator('.cap')).toHaveText(['생각', '도구', '이미지']);
    await expect(menu.getByRole('option', { name: /fake-embed/ })).toHaveCount(0); // 임베딩 = 대화 모델 아님
    // 자세히 (넓은 창 = 오른쪽 칸): 출처 = LiteLLM model_info.db_model (mock: small = config.yaml)
    const detail = menu.locator('.mdetail');
    await expect(detail).toContainText('fake-chat-small');
    await expect(detail).toContainText('컨텍스트128K');
    await expect(detail).toContainText('출처config.yaml');
    await expect(detail).toContainText('상태확인 전');
    // fake-chat-small 은 생각을 지원하지 않는다 → 생각 깊이 셋 다 못 고름 (끄기에 고정)
    await expect(menu.getByRole('radiogroup', { name: '생각 깊이' })).toHaveAttribute('aria-disabled', 'true');
    for (const name of ['끄기', '보통', '깊게']) await expect(depth(menu, name)).toHaveAttribute('aria-disabled', 'true');
    await expect(depth(menu, '끄기')).toHaveAttribute('aria-checked', 'true');
    await expect(menu).toContainText('이 모델은 생각 깊이를 고를 수 없어요');
    await expect(menu).toContainText('허용된 모델만 보여요');
    await win.screenshot({ path: shot('desktop-model-menu'), animations: 'disabled' }); // 메뉴 fade(.14s) 끝난 모습
    await closePicker(win);
    await expect(ui(win).model).toBeFocused(); // Esc = 닫고 버튼으로
  });

  test('검색: 이름 · ID · 회사로 거른다 · 맞는 게 없으면 안내 · Esc 는 검색부터 지운다', async () => {
    const menu = await openPicker(win);
    const search = menu.getByRole('combobox', { name: '모델 검색' });
    await search.fill('anthro'); // 회사 이름
    await expect(menu.getByRole('option')).toHaveCount(1);
    await expect(opt(menu, 'fake-chat-large')).toHaveAttribute('data-active', 'true'); // 첫 줄로 강조가 옮겨 간다
    await search.fill('LARGE'); // 대소문자 무시
    await expect(opt(menu, 'fake-chat-large').locator('.hit').first()).toHaveText('large');
    await search.fill('없는모델');
    await expect(menu.getByRole('option')).toHaveCount(0);
    await expect(menu).toContainText("'없는모델'에 맞는 모델이 없어요");
    await menu.getByRole('button', { name: '검색 지우기' }).click();
    await expect(search).toHaveValue('');
    await expect(menu.getByRole('option')).toHaveCount(2);
    await search.fill('small');
    await win.keyboard.press('Escape'); // 1) 검색만 지운다
    await expect(search).toHaveValue('');
    await expect(menu).toBeVisible();
    await win.keyboard.press('Escape'); // 2) 닫고 버튼으로
    await expect(menu).toHaveCount(0);
    await expect(ui(win).model).toBeFocused();
  });

  test('키보드로 모델 고르기 (↓ 열기 · ↓ 이동 · Enter 고르고 닫기 · Tab → 생각 깊이 ←→)', async () => {
    await ui(win).model.focus();
    await win.keyboard.press('ArrowDown');
    const menu = ui(win).menu;
    const search = menu.getByRole('combobox', { name: '모델 검색' });
    await expect(search).toBeFocused();
    await expect(opt(menu, 'fake-chat-small')).toHaveAttribute('data-active', 'true');
    await win.keyboard.press('ArrowDown');
    const large = opt(menu, 'fake-chat-large');
    await expect(large).toHaveAttribute('data-active', 'true');
    await expect(search).toHaveAttribute('aria-activedescendant', (await large.getAttribute('id'))!);
    await expect(menu.locator('.mdetail')).toContainText('출처LiteLLM 관리 화면'); // 자세히 = 강조한 줄
    await win.keyboard.press('ArrowDown'); // 끝에서 처음으로
    await expect(opt(menu, 'fake-chat-small')).toHaveAttribute('data-active', 'true');
    await win.keyboard.press('End');
    await expect(large).toHaveAttribute('data-active', 'true');
    await win.keyboard.press('Enter');
    await expect(menu).toHaveCount(0);
    await expect(ui(win).model).toBeFocused();
    await expect(ui(win).model).toHaveText('fake-chat-large');
    await expect(ui(win).model.locator('svg[data-provider="anthropic"]')).toHaveCount(1);

    // 다시 열기: 최근 사용 = 방금 고른 모델 · 생각 깊이를 고를 수 있다 (Tab → ←→)
    await win.keyboard.press('ArrowDown');
    await expect(menu.locator('.mh').first()).toHaveText('최근 사용');
    await expect(menu.locator('[role="option"][data-sec="recent"]')).toHaveCount(1);
    await expect(menu.getByRole('radiogroup', { name: '생각 깊이' })).not.toHaveAttribute('aria-disabled', 'true');
    await win.keyboard.press('Tab');
    await expect(depth(menu, '끄기')).toBeFocused();
    await win.keyboard.press('ArrowRight');
    await expect(depth(menu, '보통')).toHaveAttribute('aria-checked', 'true');
    await expect(depth(menu, '보통')).toBeFocused();
    await expect(menu.locator('.msub')).toHaveText('필요할 때 생각하고 답해요');
    await win.keyboard.press('ArrowLeft');
    await expect(depth(menu, '끄기')).toHaveAttribute('aria-checked', 'true');
    await win.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(ui(win).model).toHaveText('fake-chat-large');
  });

  test('고른 모델로 답한다 (요청에 model 이 실린다) · 생각 · 도구가 없으면 상태 줄 없이 답한 모델만', async () => {
    await ask(win, '어느 모델이 답하나요');
    await expectHeading(win, '어느 모델이 답하나요');
    await expect(ui(win).last).toContainText('가짜 게이트웨이(fake-chat-large)가 답해요', { timeout: 15_000 });
    const by = ui(win).last.locator('.by');
    await expect(by).toContainText(/fake-chat-large\s*·\s*\d/);
    await expect(by.locator('svg')).toHaveAttribute('data-provider', 'anthropic');
    await expect(ui(win).last).toHaveAttribute('aria-busy', 'false');
    await expect(ui(win).last.locator('.trace-line')).toHaveCount(0); // 끝났고 한 일이 없다 = 줄 없음
  });

  test('멀티턴: 두 번째 질문의 답이 첫 질문을 안다 (서버 기록)', async () => {
    await ask(win, '이어서 두 번째 질문');
    await expect(ui(win).log.locator('.msg.user')).toHaveText(['어느 모델이 답하나요', '이어서 두 번째 질문']);
    await expect(ui(win).last).toContainText('받은 질문: 이어서 두 번째 질문 · 이전 질문: 어느 모델이 답하나요', { timeout: 15_000 });
    await expect(ui(win).log.locator('.msg.agent .trace-line')).toHaveCount(0);
    await expect(ui(win).log.locator('.msg.agent').first().locator('.by')).toContainText(/fake-chat-large\s*·\s*\d/);
  });

  test('생각 깊이 = 깊게 → 유리 상태 줄이 "질문을 살펴보는 중" → 끝나면 "n초 동안 생각함" · 생각 글은 눌러야 보인다', async () => {
    const menu = await openPicker(win);
    await depth(menu, '깊게').click();
    await expect(depth(menu, '깊게')).toHaveAttribute('aria-checked', 'true');
    await closePicker(win);
    await expect(ui(win).model).toHaveText(/^fake-chat-large\s*· 깊게$/);

    await ask(win, '[fake:slow] 천천히 생각해서 답해 줘');
    const line = ui(win).last.locator('.trace-line');
    const panel = ui(win).last.getByRole('region', { name: '생각과 도구 사용 과정', includeHidden: true });
    // 흐르는 중 = 접힘 (색 점 없음 · 반짝이는 글) + '질문을 살펴보는 중'
    await expect(line).toHaveAttribute('data-step', 'thinking', { timeout: 10_000 });
    await expect(line).toHaveAttribute('data-phase', 'live');
    await expect(line.locator('.trace-txt')).toHaveText('질문을 살펴보는 중');
    await expect(line.locator('.trace-txt')).toHaveClass(/run/);
    await expect(line).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toBeHidden();
    await expect(ui(win).last.locator('.d, .dot')).toHaveCount(0);
    await win.screenshot({ path: shot('desktop-trace-live'), animations: 'disabled' });
    // 누르면 흐르는 생각이 보인다 (Anthropic thinking = LiteLLM reasoning_content + thinking_blocks 모양)
    await line.click();
    await expect(line).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.tp-think .tp-body')).toContainText('질문을 살펴보는 중이에요');
    // 끝나면 요약 한 줄 · 사용자가 연 패널은 그대로
    await expect(line).toHaveAttribute('data-step', 'done', { timeout: 20_000 });
    await expect(line).toHaveAttribute('data-phase', 'done');
    await expect(line.locator('.trace-txt')).toHaveText(/^\d+(\.\d)?초 동안 생각함$/);
    await expect(line.locator('.trace-txt')).not.toHaveClass(/run/);
    await expect(panel).toBeVisible();
    await expect(panel.locator('.tp-think .tp-body')).toContainText('필요한 도구가 있는지 확인해요');
    await expect(panel.locator('.tp-foot')).toContainText(/요청 1회 · 토큰 입력 \d+ \/ 출력 \d+ · 생각 토큰 \d+/);
    await expect(ui(win).last.locator('.by')).toContainText('생각 깊게');
    await win.screenshot({ path: shot('desktop-chat-reasoning') });
    // Esc = 패널 접고 줄로
    await panel.locator('.tp-body').focus();
    await win.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(line).toBeFocused();
  });

  test('모델이 생각 글을 안 보내면 (display omitted) 패널에 그렇게 말한다', async () => {
    await ask(win, '[fake:omitted] 생각만 하고 글은 숨겨');
    const line = ui(win).last.locator('.trace-line');
    await expect(line).toHaveAttribute('data-step', 'done', { timeout: 15_000 });
    // 생각 토큰은 있지만 생각 글 · 생각 단계가 없다 = 생각한 시간을 모른다 → 전체 시간을 생각 시간이라 하지 않는다
    await expect(line.locator('.trace-txt')).toHaveText('생각함');
    await expect(line).toHaveAttribute('data-glyph', 'think');
    await line.click();
    await expect(ui(win).last.getByRole('region', { name: '생각과 도구 사용 과정' })).toContainText('모델이 생각 내용을 보내지 않았어요');
  });

  test('생각 깊이를 켰는데 모델이 생각을 건너뛰면 (adaptive) "생각 없이 바로 답함" — 고장이 아니라 모델의 선택', async () => {
    await ask(win, '[fake:nothink] 쉬운 질문이라 바로 답해');
    const line = ui(win).last.locator('.trace-line');
    await expect(line).toHaveAttribute('data-step', 'done', { timeout: 15_000 });
    await expect(line.locator('.trace-txt')).toHaveText(/^생각 없이 바로 답함 · \d+(\.\d)?초$/);
    await expect(line).toHaveAttribute('data-glyph', 'done'); // 생각 말풍선이 아니다
    await expect(line).toHaveAccessibleName(/^생각 없이 바로 답함/); // 버튼 이름 = 보이는 글 (시간 빼고 · 늦지 않게)
  });

  test('도구: 상태 줄이 생각 → 계산하는 중 → 답을 다듬는 중 → "생각함 · 계산기 1회" · 패널에 계산기 카드', async () => {
    await recordSteps(win);
    await ask(win, '[fake:slow] 2의 10제곱에 1을 더하면?\n[fake:calc] 2**10 + 1');
    const line = ui(win).last.locator('.trace-line');
    await expect(line).toHaveAttribute('data-step', 'tool:calculator', { timeout: 10_000 });
    await expect(line.locator('.trace-txt')).toHaveText(/계산하는 중|결과를 살펴보는 중/);
    await line.click(); // 흐르는 중에 펼치면 흐르는 대로 보인다
    const card = ui(win).last.getByRole('group', { name: '계산기 도구' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('완료', { timeout: 15_000 });
    await expect(card.locator('dl')).toContainText('수식2**10 + 1');
    await expect(card.locator('dl')).toContainText('결과1025');
    await expect(ui(win).last).toContainText('계산 결과는 1025예요. (수식 2**10 + 1)', { timeout: 15_000 });
    await expect(line).toHaveAttribute('data-step', 'done');
    await expect(line.locator('.trace-txt')).toHaveText(/^\d+(\.\d)?초 동안 생각함 · 계산기 1회$/);
    await expect(line).toHaveAccessibleName(/^\d+(\.\d)?초 동안 생각함 · 계산기 1회$/);
    await expect(line).toHaveAttribute('data-glyph', 'think');
    await expect(ui(win).last.locator('.trace > .sr[aria-live]')).toHaveText(/초 동안 생각함 · 계산기 1회$/); // 끝나면 바로 알린다 (2초 묶음 없이)
    const rec = await recorded(win);
    expect(rec.steps).toEqual(['thinking', 'tool:calculator', 'writing', 'done']);
    // 화면 글: 질문을 살펴보는 중 → 계산하는 중 → (결과를 살펴보는 중) → 답을 다듬는 중 → 요약
    const texts = rec.texts.filter((x) => x !== '결과를 살펴보는 중');
    expect(texts.slice(0, -1)).toEqual(['질문을 살펴보는 중', '계산하는 중', '답을 다듬는 중']);
    expect(texts.at(-1)).toMatch(/초 동안 생각함 · 계산기 1회$/);
    // 패널 = 나온 순서대로 (생각 → 도구) · 글 사이에 카드가 끼지 않는다
    const panel = ui(win).last.getByRole('region', { name: '생각과 도구 사용 과정' });
    await expect(panel.locator('.tp-think, .tp-tool')).toHaveCount(2);
    await expect(panel.locator('.tp-tool b')).toHaveText(['계산기']);
    await expect(panel.locator('.tp-foot')).toContainText('요청 2회');
    await expect(ui(win).last.locator('> .tp-tool, > .tcard')).toHaveCount(0);
    await win.screenshot({ path: shot('desktop-chat-tool') });
  });

  test('멈추기: 답을 쓰는 중 멈추면 받은 글은 남고 "중간에 멈춤" + 다시 시도', async () => {
    // 생각 없이 빠르게 (끄기) — 그래도 [fake:slow] 라 몇 초 걸린다
    const menu = await openPicker(win);
    await depth(menu, '끄기').click();
    await closePicker(win);
    await expect(ui(win).model).toHaveText('fake-chat-large');
    await ask(win, '[fake:slow] 길게 답해 줘');
    const line = ui(win).last.locator('.trace-line');
    await expect(line).toHaveAttribute('data-step', 'writing', { timeout: 10_000 });
    await expect(line.locator('.trace-txt')).toHaveText('답을 다듬는 중');
    await ui(win).stop.click();
    await expect(line).toHaveAttribute('data-step', 'stopped');
    await expect(line).toHaveAttribute('data-phase', 'stopped');
    await expect(line.locator('.trace-txt')).toHaveText(/^중간에 멈춤 · \d/);
    await expect(ui(win).last).toContainText('안녕하세요!');
    await expect(ui(win).send).toBeVisible(); // 멈추면 다시 보내기 버튼
    // 멈춘 바로 뒤 = 서버가 아직 끊김을 모를 수 있다 (409 thread_busy) → 화면은 잠깐 기다렸다 다시 보낸다
    await ui(win).last.getByRole('button', { name: '다시 시도' }).click();
    await expect(ui(win).last).toContainText('받은 질문: [fake:slow] 길게 답해 줘', { timeout: 20_000 });
    await expect(ui(win).last).toHaveAttribute('aria-busy', 'false', { timeout: 20_000 });
    await expect(ui(win).last.locator('.trace-line')).toHaveCount(0);
    await expect(ui(win).log.getByRole('alert')).toHaveCount(0);
    await expect(ui(win).log.locator('.msg.user')).toHaveCount(7); // 다시 시도가 질문을 늘리지 않는다
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
    await expect(log.locator('.msg.user')).toHaveCount(7); // 멈춘 실행은 기록에 없고, 다시 시도한 답만 남는다
    // 기록의 답: 생각 · 도구가 있던 답만 상태 줄 (시간 없이 요약) · 접힘. 없던 답은 줄 없음
    const lines = log.locator('.trace-line');
    await expect(lines).toHaveCount(4);
    await expect(lines.nth(0)).toHaveAttribute('aria-expanded', 'false');
    await expect(lines.nth(0).locator('.trace-txt')).toHaveText('생각함');
    const calc = log.locator('.msg.agent').filter({ hasText: '계산 결과는 1025예요' });
    await expect(calc.locator('.trace-txt')).toHaveText('생각함 · 계산기 1회');
    // 생각을 건너뛴 답도 기록에서 그대로 (시간 없이)
    await expect(log.locator('.msg.agent').filter({ hasText: '[fake:nothink]' }).locator('.trace-txt')).toHaveText('생각 없이 바로 답함');
    await calc.locator('.trace-line').click();
    await expect(calc.getByRole('group', { name: '계산기 도구' })).toContainText('결과1025');
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
    await expect(live.locator('.doing')).toHaveText(/질문을 살펴보는 중|생각을 정리하는 중|답을 다듬는 중/);
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
  let api: Client; // 관리자 API (쿠키 + CSRF)
  let close: () => Promise<void>;
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    ({ app, win } = await launch());
    api = await adminApi();
    const browser = await chromium.launch({ channel: browserChannel });
    admin = await browser.newPage();
    close = () => browser.close();
    await adminSignIn(admin);
  });
  test.afterAll(async () => {
    // 다른 스펙이 기대하는 노출 상태로 되돌린다 (fake-chat-large = 노출)
    await api?.raw('PATCH', '/api/admin/models/fake-chat-large', { exposed: true }).catch(() => {});
    await close?.();
    await app?.close();
  });

  const exposeSwitch = () => admin.getByRole('switch', { name: '노출 — fake-chat-large' });
  const adminPatch = (id: string, body: object) => api.raw('PATCH', `/api/admin/models/${id}`, body);
  const fakeCatalog = (body: object) =>
    fetch(`${GATEWAY}/__fake/catalog`, {
      method: 'POST', headers: { authorization: `Bearer ${GATEWAY_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
  const probe = (id: string) => api.raw('POST', `/api/admin/models/${id}/test`);

  test('이름이 겹치면 ID 를 함께 보여 준다 · 최근 연결에 실패한 모델 = 경고 점 + 이유 (그래도 고를 수 있다)', async () => {
    try {
      // 관리자가 small 의 표시 이름을 large 와 같게 (config.yaml 모델과 관리 화면 모델 이름이 같은 경우와 같은 모양)
      expect((await adminPatch('fake-chat-small', { display_name: 'fake-chat-large' })).ok).toBe(true);
      // large 의 키가 빠졌다 → 관리자 연결 시험 실패 (mock: 401 Missing Anthropic API Key)
      expect((await fakeCatalog({ broken: { 'fake-chat-large': '401' } })).ok).toBe(true);
      expect((await (await probe('fake-chat-large')).json()).ok).toBe(false);

      const menu = await openPicker(win);
      const small = opt(menu, 'fake-chat-small');
      const large = opt(menu, 'fake-chat-large');
      // 화면 읽기도 둘을 가른다 (id · 등록한 곳) · 실패도 이름에
      await expect(small).toHaveAccessibleName('fake-chat-large (fake-chat-small · config.yaml)');
      await expect(large).toHaveAccessibleName('fake-chat-large (fake-chat-large · LiteLLM 관리 화면) · 최근 연결 실패 (키 없음)');
      await expect(small.locator('.l2')).toHaveClass(/dup/);
      await expect(small.locator('.l2')).toHaveText('fake-chat-smallconfig.yaml'); // 줄마다 id + 등록한 곳 (키 없는 쪽을 피한다)
      await expect(large.locator('.l2 .src')).toHaveText('LiteLLM 관리 화면');
      await expect(large.locator('.wdot')).toHaveCount(1);
      await expect(small.locator('.wdot')).toHaveCount(0);
      await expect(large).toHaveAttribute('title', /최근 연결 실패 \(키 없음\)/);
      await large.hover();
      const detail = menu.locator('.mdetail');
      await expect(detail).toContainText('상태⚠ 키 없음');
      await expect(detail).toContainText('고를 수는 있지만 답이 실패할 수 있어요');
      await expect(detail).toContainText('같은 이름의 모델이 더 있어요');
      await win.screenshot({ path: shot('desktop-model-menu-dup-warn'), animations: 'disabled' });
      await large.click(); // 고를 수 있다
      await expect(menu).toHaveCount(0);
      await expect(ui(win).model.locator('.wdot')).toHaveCount(1);
      // 버튼: 이름이 겹치니 id 도 · 툴팁에 id + 실패 이유
      await expect(ui(win).model.locator('.mid')).toHaveText('fake-chat-large');
      await expect(ui(win).model).toHaveAttribute('title', 'fake-chat-large · Anthropic · 최근 연결에 실패했어요 · 키 없음');
    } finally {
      await adminPatch('fake-chat-small', { display_name: null });
      await fakeCatalog({ broken: {} });
      await probe('fake-chat-large'); // 정상으로 되돌린다
    }
    const menu = await openPicker(win);
    await expect(opt(menu, 'fake-chat-large').locator('.wdot')).toHaveCount(0);
    await expect(opt(menu, 'fake-chat-small')).toHaveAccessibleName('fake-chat-small');
    await closePicker(win);
    await expect(ui(win).model.locator('.mid')).toHaveCount(0); // 이름이 안 겹치면 id 를 안 붙인다
  });

  test('관리자 콘솔에서 숨김 → 데스크톱 메뉴에서 사라짐 → 다시 노출 → 돌아옴 (코드 변경 0)', async () => {
    let menu = await openPicker(win);
    await opt(menu, 'fake-chat-large').click(); // 고른 모델이 숨겨지는 경우까지 (누르면 고르고 닫힌다)
    await closePicker(win);
    await expect(ui(win).model).toHaveText('fake-chat-large');

    await admin.goto(`${ADMIN_URL}/#/models`);
    await expect(exposeSwitch()).toHaveAttribute('aria-checked', 'true');
    await exposeSwitch().click();
    await expect(exposeSwitch()).toHaveAttribute('aria-checked', 'false');
    await expect(admin.locator('tr[data-model="fake-chat-large"]')).toHaveAttribute('data-state', 'hidden');

    // 메뉴를 열면 다시 읽는다 → 숨긴 모델 없음 · 고른 모델은 기본으로 + 안내
    menu = await openPicker(win);
    await expect(menu.locator('[role="option"][data-model="fake-chat-large"]')).toHaveCount(0); // 최근 사용에서도 빠진다
    await expect(menu.locator('h6')).toHaveText(['OpenAI', '생각 깊이']);
    await expect(ui(win).model).toHaveText('fake-chat-small');
    await expect(win.getByRole('status').filter({ hasText: '기본 모델로 바꿨어요' })).toBeVisible();
    await closePicker(win);

    await exposeSwitch().click();
    await expect(exposeSwitch()).toHaveAttribute('aria-checked', 'true');
    menu = await openPicker(win);
    await expect(opt(menu, 'fake-chat-large')).toHaveCount(1);
    await closePicker(win);
  });

  test('메뉴를 다시 열기 전에 숨겨져도 보내면 안내 → 목록을 새로 읽고 기본 모델로 다시 시도', async () => {
    const menu = await openPicker(win);
    await opt(menu, 'fake-chat-large').click();
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
