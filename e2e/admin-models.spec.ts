import { test, expect, type Page, type Route } from '@playwright/test';
import { adminApi, userApi, type Client } from './auth';
import { ADMIN_URL, GATEWAY, GATEWAY_KEY } from './env';
import { optionsOf, overflowX, pickOption, pickedText, shot } from './helpers';

// 관리자 '모델' = conductor /api/admin/models (mock 게이트웨이 /model_group/info 를 동기화한 model_exposure, ADR-0006)
// 모델 등록은 LiteLLM 에서만. 여기서 바꾸는 것 = 노출 · 표시 이름 · 순서 · 기본 모델. 표 한 장 · 제공사(provider) = 칸 · 순서 = 전체 하나 (= 사용자 앱 메뉴 순서).
// 화면 = 탭 둘: 모델 목록(#/models) · 모델 추가(#/models/add = 등록 순서 안내 · 동기화 · 후보 확인) + 모델 자세히 페이지(#/models/<id>).
// 처음 상태(E2E conductor = 메모리 DB): fake-chat-small(OpenAI) · fake-chat-large(Anthropic) 노출, fake-embed(OpenAI, 임베딩) 숨김.
// 바꾼 값은 테스트마다 되돌린다 (desktop 스펙도 같은 conductor 를 쓴다). 새 모델(P2-2) 테스트는 '사라짐' 줄을 남겨서 맨 끝에 둔다.
// 상태 칸 없음 (후보 · 사라짐만 이름 옆 딱지) · 여기서 정하는 것(노출 · 기본)과 연결 = 맨 오른쪽
const COLS = ['선택', '순서', '제공사', '모델', '컨텍스트', '입력 비용', '출력 비용', '기능', '노출', '기본', '연결'];
const table = (page: Page) => page.getByRole('table', { name: '모델 목록' });
const rowsOf = (page: Page) => table(page).locator('tbody tr[data-model]');
const row = (page: Page, id: string) => table(page).locator(`tbody tr[data-model="${id}"]`);
const cell = (page: Page, id: string, col: string) => row(page, id).locator(`td[data-col="${col}"]`);
const caps = (page: Page, id: string) => cell(page, id, 'caps').locator('.mcap').evaluateAll((els) => els.map((e) => e.getAttribute('data-cap')));
// 자세히 페이지 (#/models/<id>): 머리 = .mhead (h1 = 보이는 이름) · 카드 = section (이름 = 카드 제목)
const detail = (page: Page) => page.locator('.mpage');
const part = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const h1 = (page: Page) => page.getByRole('heading', { level: 1 });
const testBtn = (page: Page, label: string) => page.getByRole('button', { name: `연결 테스트 — ${label}` });
const exposeSwitch = (page: Page, label: string) => page.getByRole('switch', { name: `노출 — ${label}` });
const tabs = (page: Page) => page.getByRole('tablist', { name: '모델 화면 탭' });
const providerFilter = (page: Page) => page.getByRole('combobox', { name: '제공사 필터' }); // 공용 고르기 상자 (@brewai/ui Select)
// 제공사 고르기 상자를 열어 줄 글을 읽고 닫는다 (줄 = 이름 + 오른쪽 옅은 글)
async function providerOptions(page: Page) {
  await providerFilter(page).click();
  const texts = (await (await optionsOf(providerFilter(page))).allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
  await page.keyboard.press('Escape');
  await expect(providerFilter(page)).toHaveAttribute('aria-expanded', 'false');
  return texts;
}
const stateSeg = (page: Page) => page.getByRole('radiogroup', { name: '상태' });
const stateCount = (page: Page, label: string) => stateSeg(page).getByRole('radio', { name: label }).locator('.mseg-n');
const candList = (page: Page) => page.getByRole('list', { name: '확인할 후보' });

// 화면 밖 확인 · 되돌리기 = 진짜 로그인한 API (사용자 = Bearer · 관리자 = 쿠키 + CSRF)
let admin: Client;
test.beforeAll(async () => {
  admin = await adminApi();
});
async function userModels(): Promise<{ id: string; label: string; provider: string; is_default: boolean }[]> {
  return (await userApi()).get('/api/models');
}
async function patch(id: string, body: object) {
  const res = await admin.raw('PATCH', `/api/admin/models/${id}`, body);
  expect(res.ok, `PATCH ${id} ${JSON.stringify(body)}`).toBe(true);
}
// 콘솔은 /api 를 같은 출처(preview proxy)로 부른다. conductor 가 꺼지면 proxy 가 502 conductor_unreachable (apps/admin/vite.config.ts).
// 로그인 확인(/api/admin/auth/*)은 그대로 둔다 — 콘솔을 보는 중에 conductor 가 꺼진 경우
const MODELS_API = `${ADMIN_URL}/api/admin/models`;
const conductorCall = (url: URL) => url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/admin/auth/');
const conductorDown = (r: Route) => r.fulfill({ status: 502, contentType: 'application/json', body: '{"detail":"conductor_unreachable"}' });
async function fakeCatalog(body: object) {
  const res = await fetch(`${GATEWAY}/__fake/catalog`, {
    method: 'POST', headers: { authorization: `Bearer ${GATEWAY_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  expect(res.ok).toBe(true);
}

test('mock 게이트웨이 모델이 표에 뜬다 (채팅 = 노출 · 순서, 임베딩 = 숨김) · 제공사 칸 · 이름 두 줄 · 비용 · 기능 아이콘', async ({ page }) => {
  await page.goto('/#/models');
  await expect(tabs(page).getByRole('tab')).toHaveText(['모델 목록', '모델 추가']);
  await expect(tabs(page).getByRole('tab', { name: '모델 목록' })).toHaveAttribute('aria-selected', 'true');
  await expect(table(page).getByRole('columnheader')).toHaveText(COLS);
  const rows = rowsOf(page);
  await expect(rows).toHaveCount(3);
  // 표 한 장 (묶음 머리줄 없음) · 줄 순서 = 전체 순서 하나 (제공사로 묶지 않음 = 사용자 앱 메뉴 순서) · 순서 숫자 = 1 … N
  expect(await rows.evaluateAll((trs) => trs.map((tr) => tr.getAttribute('data-model')))).toEqual(['fake-chat-small', 'fake-chat-large', 'fake-embed']);
  await expect(rows.locator('td[data-col="order"] .num')).toHaveText(['1', '2', '3']);
  await expect(table(page).locator('tr.grp, tr[data-group-start]')).toHaveCount(0);
  await expect(table(page).getByRole('button', { name: /^(위로|아래로)/ })).toHaveCount(0); // ↑↓ 없음 (끌기 · 한 칸씩 = 자세히 페이지)
  // 머리 · 칸 모두 왼쪽 맞춤 (숫자 · 비용도)
  const aligns = await table(page).locator('th, td').evaluateAll((els) => [...new Set(els.map((e) => getComputedStyle(e).textAlign))]);
  expect(aligns.every((a) => a === 'left' || a === 'start'), aligns.join()).toBe(true);

  const small = row(page, 'fake-chat-small');
  await expect(cell(page, 'fake-chat-small', 'order')).toContainText('1');
  await expect(cell(page, 'fake-chat-small', 'provider').locator('svg')).toHaveAttribute('data-provider', 'openai');
  // 1280 = 제공사 이름이 보인다 · 좁은 창(≤1160)에선 눈에만 숨고 아이콘만 (화면 낭독기 · 툴팁엔 이름)
  await expect(cell(page, 'fake-chat-small', 'provider').getByText('OpenAI', { exact: true })).toBeVisible();
  // 모델 칸 = 데스크톱 모델 메뉴처럼 두 줄: 보이는 이름 / 실제 모델 이름
  await expect(small.locator('.ncell b')).toHaveText('fake-chat-small');
  await expect(small.locator('.ncell .mid')).toHaveText('fake-chat-small');
  await expect(small.locator('.chip')).toHaveCount(0); // 상태 딱지 = 후보 · 사라짐만 (노출 · 숨김은 스위치가 말한다)
  await expect(small).toHaveAttribute('data-state', 'exposed');
  await expect(small.locator('.dflt')).toHaveText('기본');
  await expect(exposeSwitch(page, 'fake-chat-small')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radio', { name: '기본 모델 — fake-chat-small' })).toBeChecked();
  // 게이트웨이 값 = 칸마다 숫자 하나 (단위 = 머리 글 툴팁: 100만 토큰당 달러)
  await expect(cell(page, 'fake-chat-small', 'context')).toHaveText('128K');
  await expect(cell(page, 'fake-chat-small', 'input')).toHaveText('$0.15');
  await expect(cell(page, 'fake-chat-small', 'output')).toHaveText('$0.60');
  await expect(table(page).getByRole('columnheader', { name: '입력 비용' })).toHaveAttribute('title', /100만 토큰당 달러/);
  // 기능 = 아이콘만 (글 목록 없음) · 이름 = 화면 읽기 · 툴팁
  expect(await caps(page, 'fake-chat-small')).toEqual(['text', 'image', 'tools']);
  await expect(cell(page, 'fake-chat-small', 'caps')).toHaveText('');
  await expect(cell(page, 'fake-chat-small', 'caps').getByRole('img', { name: '이미지 입력' })).toBeVisible();
  await expect(cell(page, 'fake-chat-small', 'caps').locator('.mcap[data-cap="tools"]')).toHaveAttribute('title', /도구 호출/);

  const large = row(page, 'fake-chat-large');
  await expect(cell(page, 'fake-chat-large', 'order').locator('.num')).toHaveText('2'); // 순서 = 전체 자리 (제공사 안 자리가 아니라)
  await expect(cell(page, 'fake-chat-large', 'provider').locator('svg')).toHaveAttribute('data-provider', 'anthropic');
  await expect(large.locator('.chip')).toHaveCount(0);
  await expect(cell(page, 'fake-chat-large', 'input')).toHaveText('$3');
  await expect(cell(page, 'fake-chat-large', 'output')).toHaveText('$15');
  expect(await caps(page, 'fake-chat-large')).toEqual(['text', 'image', 'tools', 'reasoning']);
  await expect(cell(page, 'fake-chat-large', 'caps').getByRole('img', { name: '생각' })).toBeVisible();

  const embed = row(page, 'fake-embed');
  await expect(cell(page, 'fake-embed', 'order').locator('.num')).toHaveText('3');
  await expect(embed.locator('.chip')).toHaveCount(0);
  await expect(embed).toHaveAttribute('data-state', 'hidden');
  await expect(exposeSwitch(page, 'fake-embed')).toBeDisabled(); // 대화 모델이 아니라 노출 못 함
  await expect(page.getByRole('radio', { name: '기본 모델 — fake-embed' })).toBeDisabled();
  expect(await caps(page, 'fake-embed')).toEqual(['embedding']);
  await expect(cell(page, 'fake-embed', 'caps').locator('.mcap')).toHaveAttribute('title', '임베딩 모델, 대화에 안 씀');
  // 연결 칸 = 점 + 결과 + 보이는 글 버튼 [테스트] (대화 모델만)
  await expect(testBtn(page, 'fake-chat-small')).toHaveText('테스트');
  await expect(cell(page, 'fake-embed', 'health').getByRole('button')).toHaveCount(0);

  // 요약 카드 대신 = 상태 거르개 옆 개수 · 제공사 고르기 상자 (줄 = 아이콘 + 제공사 · 오른쪽 = 노출 수 / 개수, 순서 = 표에서 처음 나온 순서)
  await expect(page.locator('.mstat')).toHaveCount(0);
  await expect(stateCount(page, '전체')).toHaveText('3');
  await expect(stateCount(page, '노출')).toHaveText('2');
  await expect(stateCount(page, '후보')).toHaveText('0');
  await expect(stateCount(page, '숨김')).toHaveText('1');
  await expect(stateCount(page, '문제 있음')).toHaveText(/^\d+$/); // 앞 스펙의 대화 실패가 남아 있을 수 있다
  await expect(providerFilter(page)).toHaveAttribute('data-value', 'all');
  await expect(pickedText(providerFilter(page))).toHaveText('전체 제공사');
  await expect(page.locator('select')).toHaveCount(0); // 브라우저 기본 고르기 상자 없음 (공용 Select)
  await providerFilter(page).click();
  const opts = await optionsOf(providerFilter(page));
  await expect(opts).toHaveText(['전체 제공사 3개', 'OpenAI 노출 1/2', 'Anthropic 노출 1/1']);
  await expect(opts.nth(1).locator('svg[data-provider]')).toHaveAttribute('data-provider', 'openai');
  await expect(opts.first()).toHaveAttribute('aria-selected', 'true');
  await page.screenshot({ path: shot('admin-models-provider-select') });
  await page.keyboard.press('Escape');
  await expect(opts).toHaveCount(0);
  await expect(tabs(page).getByRole('tab', { name: '모델 추가' }).locator('.ui-tab-count')).toHaveCount(0); // 확인할 후보 없음
  await page.screenshot({ path: shot('admin-models-live'), fullPage: true });
});

test('제공사 필터 (공용 고르기 상자): 고르면 그 제공사 모델만 · 전체로 돌아온다 · 키보드 (↓ · End · Enter · Esc · 글자)', async ({ page }) => {
  await page.goto('/#/models');
  const rows = rowsOf(page);
  const filter = providerFilter(page);
  await expect(rows).toHaveCount(3);
  await pickOption(filter, { value: 'openai' });
  await expect(rows).toHaveCount(2);
  await expect(row(page, 'fake-chat-large')).toHaveCount(0);
  await expect(pickedText(filter)).toHaveText('OpenAI');
  await pickOption(filter, { label: 'Anthropic' });
  await expect(rows).toHaveCount(1);
  await expect(row(page, 'fake-chat-large')).toHaveCount(1);
  await pickOption(filter, { value: 'all' });
  await expect(rows).toHaveCount(3);
  // 바깥을 누르면 닫힌다 (값 그대로)
  await filter.click();
  await expect(filter).toHaveAttribute('aria-expanded', 'true');
  await page.locator('.ui-page-title, h1').first().click();
  await expect(filter).toHaveAttribute('aria-expanded', 'false');

  // 키보드: 포커스는 늘 단추에 · 가리키는 줄 = aria-activedescendant
  await filter.focus();
  await page.keyboard.press('ArrowDown');
  await expect(filter).toHaveAttribute('aria-expanded', 'true');
  const opts = await optionsOf(filter);
  await expect(opts.first()).toHaveAttribute('data-active', '');
  await page.keyboard.press('End');
  await expect(filter).toHaveAttribute('aria-activedescendant', (await opts.last().getAttribute('id'))!);
  await page.keyboard.press('Enter');
  await expect(filter).toHaveAttribute('data-value', 'anthropic');
  await expect(filter).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Home');
  await page.keyboard.press('Escape'); // 닫기만
  await expect(filter).toHaveAttribute('aria-expanded', 'false');
  await expect(filter).toHaveAttribute('data-value', 'anthropic');
  await page.keyboard.press('o'); // 글자 = 그 글자로 시작하는 줄 (열면서 가리킨다)
  await expect(filter).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Enter');
  await expect(filter).toHaveAttribute('data-value', 'openai');
  await expect(rows).toHaveCount(2);
  await pickOption(filter, { value: 'all' });
});

test('탭 = 주소(#/models · #/models/add): 뒤로 · 앞으로 · 화살표 키 · 탭을 옮겨도 거르개는 그대로', async ({ page }) => {
  await page.goto('/#/models');
  await expect(rowsOf(page)).toHaveCount(3);
  await pickOption(providerFilter(page), { value: 'openai' });
  await expect(rowsOf(page)).toHaveCount(2);
  const tab = (name: string) => tabs(page).getByRole('tab', { name });
  await tab('모델 추가').click();
  await expect(page).toHaveURL(/#\/models\/add$/);
  await expect(tab('모델 추가')).toHaveAttribute('aria-selected', 'true');
  await page.goBack();
  await expect(page).toHaveURL(/#\/models$/);
  await expect(tab('모델 목록')).toHaveAttribute('aria-selected', 'true');
  await expect(providerFilter(page)).toHaveAttribute('data-value', 'openai'); // 거르개는 탭 밖 (ModelsScreen) 에 있다
  await expect(rowsOf(page)).toHaveCount(2);
  await page.goForward();
  await expect(tab('모델 추가')).toHaveAttribute('aria-selected', 'true');
  // 키보드: ← → 로 옆 탭 (주소도 같이)
  await tab('모델 추가').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page).toHaveURL(/#\/models$/);
  await expect(tab('모델 목록')).toHaveAttribute('aria-selected', 'true');
  await expect(tab('모델 목록')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/#\/models\/add$/);
  await expect(tab('모델 추가')).toHaveAttribute('aria-selected', 'true');
});

test('노출 끄기 → 사용자 앱 목록(/api/models)에서 빠진다 → 켜면 돌아온다 (P2-1)', async ({ page }) => {
  await page.goto('/#/models');
  const sw = exposeSwitch(page, 'fake-chat-large');
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  try {
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await expect(row(page, 'fake-chat-large')).toHaveAttribute('data-state', 'hidden');
    await expect(stateCount(page, '노출')).toHaveText('1');
    expect(await providerOptions(page)).toContain('Anthropic 노출 0/1');
    expect((await userModels()).map((m) => m.id)).toEqual(['fake-chat-small']);
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    expect((await userModels()).map((m) => m.id)).toEqual(['fake-chat-small', 'fake-chat-large']);
  } finally {
    await patch('fake-chat-large', { exposed: true });
  }
});

test('표시 이름: 연필 → 입력 → Enter 저장 (사용자 앱 이름도 바뀜) · Esc 취소 · 되돌리기', async ({ page }) => {
  await page.goto('/#/models');
  try {
    await page.getByRole('button', { name: '표시 이름 바꾸기 — fake-chat-large' }).click();
    const input = page.getByRole('textbox', { name: '표시 이름 — fake-chat-large' });
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute('maxlength', '60');
    await input.fill('  큰   모델  ');
    await input.press('Escape'); // 취소
    await expect(input).toHaveCount(0);
    await expect(row(page, 'fake-chat-large').locator('.ncell b')).toHaveText('fake-chat-large');

    await page.getByRole('button', { name: '표시 이름 바꾸기 — fake-chat-large' }).click();
    await input.fill('  큰   모델  ');
    await input.press('Enter');
    await expect(input).toHaveCount(0);
    const name = row(page, 'fake-chat-large').locator('.ncell b');
    await expect(name).toHaveText('큰 모델'); // 공백 정리
    await expect(row(page, 'fake-chat-large').locator('.ncell .mid')).toHaveText('fake-chat-large'); // 아래 줄 = 실제 모델 이름 (그대로)
    await expect(row(page, 'fake-chat-large').getByRole('button', { name: '되돌리기' })).toHaveAttribute('title', '기본 이름(fake-chat-large)으로 되돌리기');
    expect((await userModels()).find((m) => m.id === 'fake-chat-large')?.label).toBe('큰 모델');
    await expect(page.getByRole('button', { name: '표시 이름 바꾸기 — 큰 모델' })).toBeFocused(); // 저장 뒤 포커스는 연필로

    await row(page, 'fake-chat-large').getByRole('button', { name: '되돌리기' }).click();
    await expect(name).toHaveText('fake-chat-large');
    await expect(page.getByRole('status')).toContainText('기본 이름으로 되돌렸어요');
    expect((await userModels()).find((m) => m.id === 'fake-chat-large')?.label).toBe('fake-chat-large');
  } finally {
    await patch('fake-chat-large', { display_name: null });
  }
});

test('순서: 손잡이를 끌어 옮긴다 (전체 순서 하나 · 제공사를 건너도 = 사용자 앱 메뉴 순서) · 기본 모델: 라디오 (메뉴에서 제자리)', async ({ page }) => {
  await page.goto('/#/models');
  const ids = () => rowsOf(page).evaluateAll((trs) => trs.map((tr) => tr.getAttribute('data-model')));
  const nums = rowsOf(page).locator('td[data-col="order"] .num');
  try {
    await expect.poll(ids).toEqual(['fake-chat-small', 'fake-chat-large', 'fake-embed']);
    await expect(cell(page, 'fake-chat-large', 'order')).toHaveAttribute('title', '전체 2번째. 사용자 앱 메뉴는 노출한 모델만 이 순서로 보여요. 손잡이를 끌어 옮겨요');
    // embed(OpenAI) 를 맨 위 줄에 놓는다 → 그 자리로 · 숫자는 다시 1 … N
    await row(page, 'fake-embed').locator('.grip').dragTo(row(page, 'fake-chat-small'));
    await expect.poll(ids).toEqual(['fake-embed', 'fake-chat-small', 'fake-chat-large']);
    await expect(page.getByRole('status')).toContainText('순서를 바꿨어요: fake-embed → 1번');
    await expect(nums).toHaveText(['1', '2', '3']);
    // 아래로 끌면 놓은 줄 뒤로 (small → large 위에 놓음 = large 다음)
    await row(page, 'fake-chat-small').locator('.grip').dragTo(row(page, 'fake-chat-large'));
    await expect.poll(ids).toEqual(['fake-embed', 'fake-chat-large', 'fake-chat-small']);
    // 사용자 앱 메뉴 = 노출한 모델을 같은 순서로 · 기본(small)은 표시만 (맨 위로 안 간다)
    expect((await userModels()).map((m) => [m.id, m.is_default])).toEqual([['fake-chat-large', false], ['fake-chat-small', true]]);

    await page.getByRole('radio', { name: '기본 모델 — fake-chat-large' }).check();
    await expect(page.getByRole('status')).toContainText('기본 모델을 바꿨어요: fake-chat-large');
    await expect(row(page, 'fake-chat-large').locator('.dflt')).toHaveText('기본');
    await expect(row(page, 'fake-chat-small').locator('.dflt')).toHaveCount(0);
    expect((await userModels()).map((m) => [m.id, m.is_default])).toEqual([['fake-chat-large', true], ['fake-chat-small', false]]);
    await page.getByRole('radio', { name: '기본 모델 — fake-chat-small' }).check();
    await expect(row(page, 'fake-chat-small').locator('.dflt')).toHaveText('기본');
    await expect.poll(ids).toEqual(['fake-embed', 'fake-chat-large', 'fake-chat-small']); // 기본이 돼도 표 자리 그대로
  } finally {
    await patch('fake-chat-small', { order: 1, is_default: true });
    await patch('fake-embed', { order: 3 });
  }
  expect((await userModels()).map((m) => m.id)).toEqual(['fake-chat-small', 'fake-chat-large']);
});

test('모델 추가 탭: 등록 순서 안내 · "LiteLLM 에서 추가" = LiteLLM Admin UI 새 탭 (등록은 거기서만) · 바꿀 수 없는 일은 서버가 막는다', async ({ page }) => {
  await page.goto('/#/models');
  await tabs(page).getByRole('tab', { name: '모델 추가' }).click();
  await expect(page).toHaveURL(/#\/models\/add$/);
  await expect(tabs(page).getByRole('tab', { name: '모델 추가' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: '모델을 추가하는 순서' })).toBeVisible();
  await expect(page.locator('.mstep b')).toHaveText(['LiteLLM 에 등록', '동기화', '확인하고 노출']);
  await expect(page.getByRole('textbox')).toHaveCount(0); // 입력칸 없음 (제공사 · 가격 · 컨텍스트는 게이트웨이 값)
  await expect(page.getByText('확인할 후보가 없어요')).toBeVisible();
  await page.screenshot({ path: shot('admin-models-add'), fullPage: true });
  const add = page.getByRole('link', { name: 'LiteLLM 에서 추가' });
  await expect(add).toHaveAttribute('href', `${GATEWAY}/ui`); // LLM_GATEWAY_UI_URL 이 비면 게이트웨이 주소 + /ui
  await expect(add).toHaveAttribute('target', '_blank');
  await expect(add).toHaveAttribute('rel', /noopener/);
  await expect(page.locator('.note')).toContainText('모델은 게이트웨이(LiteLLM)에서만 등록돼요');
  // 서버: 가격 · 회사 같은 칸은 PATCH 로 못 바꾼다 (422) · 임베딩은 노출 못 함 (409)
  const bad = await admin.raw('PATCH', '/api/admin/models/fake-chat-small', { input_cost_per_token: 0 });
  expect(bad.status).toBe(422);
  const embed = await admin.raw('PATCH', '/api/admin/models/fake-embed', { exposed: true });
  expect(embed.status).toBe(409);
});

test('conductor 가 꺼져 있으면 안내 → 다시 시도로 회복', async ({ page }) => {
  await page.route(conductorCall, conductorDown);
  await page.goto('/#/models/add');
  await expect(page.getByRole('alert')).toContainText('conductor 에 연결할 수 없어요');
  await expect(page.getByRole('button', { name: 'LiteLLM 에서 추가' })).toBeDisabled(); // 주소를 모르면 못 누른다
  await tabs(page).getByRole('tab', { name: '모델 목록' }).click();
  await expect(page).toHaveURL(/#\/models$/);
  await expect(page.getByRole('alert')).toContainText('conductor 에 연결할 수 없어요');
  await page.unroute(conductorCall);
  await page.getByRole('button', { name: '다시 시도' }).click();
  await expect(rowsOf(page)).toHaveCount(3);
});

test('게이트웨이가 꺼져 있으면 (conductor 503) 게이트웨이 안내', async ({ page }) => {
  await page.route(MODELS_API, (r) =>
    r.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"gateway_unreachable"}' }));
  await page.goto('/#/models');
  await expect(page.getByRole('alert')).toContainText('게이트웨이에 연결할 수 없어요');
  await expect(stateSeg(page)).toHaveCount(0); // 오류일 땐 개수(0)를 보이지 않는다 — 거르개 줄째 없음
  await expect(tabs(page).getByRole('tab', { name: '모델 추가' }).locator('.ui-tab-count')).toHaveCount(0);
});

test('게이트웨이가 떠 있는데 오류를 내면 (conductor 502) "꺼짐" 이 아니라 오류 안내', async ({ page }) => {
  await page.route(MODELS_API, (r) =>
    r.fulfill({ status: 502, contentType: 'application/json', body: '{"detail":"gateway_error"}' }));
  await page.goto('/#/models');
  await expect(page.getByRole('alert')).toContainText('게이트웨이가 오류를 냈어요');
  await page.goto('/#/overview');
  await expect(gatewayCard(page).locator('.v')).toHaveText('오류');
});

test('게이트웨이에 모델이 0개면 빈 표 안내', async ({ page }) => {
  await page.route(MODELS_API, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto('/#/models');
  await expect(table(page)).toContainText('게이트웨이에 모델이 없어요');
  await expect(table(page).getByRole('link', { name: '추가하는 법 보기' })).toHaveAttribute('href', '#/models/add');
});

test('PATCH 가 실패하면 줄은 그대로 + 이유 한 줄', async ({ page }) => {
  await page.goto('/#/models');
  await page.route(`${MODELS_API}/fake-chat-large`, (r) =>
    r.fulfill({ status: 409, contentType: 'application/json', body: '{"detail":"model_missing"}' }));
  await exposeSwitch(page, 'fake-chat-large').click();
  await expect(page.getByRole('alert')).toContainText('게이트웨이에서 사라진 모델이라 노출할 수 없어요');
  await expect(exposeSwitch(page, 'fake-chat-large')).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: '안내 닫기' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

// 개요 '게이트웨이' 카드 = 같은 API 의 실제 결과
const card = (page: Page, label: string) => page.locator('.stat').filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) });
const gatewayCard = (page: Page) => card(page, '게이트웨이');
const exposedCard = (page: Page) => card(page, '노출 모델');

test('개요: 게이트웨이 연결됨 · 노출 모델 수', async ({ page }) => {
  await page.goto('/#/overview');
  await expect(gatewayCard(page)).toHaveAttribute('data-state', 'ok');
  await expect(gatewayCard(page).locator('.v')).toHaveText('연결됨');
  await expect(gatewayCard(page).locator('.sub')).toHaveText('LiteLLM, 모델 3개, 회사 2곳');
  await expect(exposedCard(page).locator('.v')).toHaveText('2');
  await expect(exposedCard(page).locator('.sub')).toHaveText('후보 0, 숨김 1');
  await page.screenshot({ path: shot('admin-overview-live'), fullPage: true });
});

test('개요: conductor · 게이트웨이가 꺼지면 카드가 그렇게 말한다', async ({ page }) => {
  await page.route(conductorCall, conductorDown);
  await page.goto('/#/overview');
  await expect(gatewayCard(page)).toHaveAttribute('data-state', 'error');
  await expect(gatewayCard(page).locator('.v')).toHaveText('conductor 꺼짐');
  await page.unroute(conductorCall);
  await page.route(MODELS_API, (r) =>
    r.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"gateway_unreachable"}' }));
  await page.reload();
  await expect(gatewayCard(page).locator('.v')).toHaveText('꺼짐');
  await expect(gatewayCard(page).locator('.sub')).toContainText('npm run gateway');
  await expect(exposedCard(page).locator('.v')).toHaveText('—');
});

test('연결 테스트: 그 자리에서 돌림표 → 정상 · 응답 시간 | 키 없음 + 고치는 곳 · 다시 읽어도 남는다', async ({ page }) => {
  await page.goto('/#/models');
  const small = row(page, 'fake-chat-small');
  const large = row(page, 'fake-chat-large');
  await expect(small.locator('.conn')).toBeVisible();
  try {
    // 도는 동안 = 돌림표 + '테스트 중…' · 버튼은 잠깐 못 누름 (응답을 붙잡아 둔다)
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    await page.route(`${MODELS_API}/fake-chat-small/test`, async (r) => { await held; await r.continue(); });
    await testBtn(page, 'fake-chat-small').click();
    await expect(small.locator('.hl')).toHaveAttribute('data-health', 'running');
    await expect(small.locator('.hl')).toHaveText('테스트 중…');
    await expect(small.locator('.hl .ui-spinner')).toBeVisible();
    await expect(testBtn(page, 'fake-chat-small')).toBeDisabled();
    await expect(testBtn(page, 'fake-chat-small')).toBeFocused(); // aria-disabled → 포커스가 버튼에 남는다
    await expect(exposeSwitch(page, 'fake-chat-small')).toBeEnabled(); // 줄은 잠그지 않는다
    release();
    await expect(small.locator('.hl')).toHaveAttribute('data-health', 'ok');
    await expect(small.locator('.hl')).toHaveText(/^정상 \d+ms$/); // 응답 시간 = conductor 가 잰 왕복 (duration_ms) · 칸 나눔 = 여백
    await expect(small.locator('.hl')).toHaveAttribute('title', '마지막 정상: 방금');
    await expect(page.locator('.flash')).toHaveCount(0); // 결과는 그 자리에만 (위 알림 줄 없음)
    await page.unroute(`${MODELS_API}/fake-chat-small/test`);

    // LiteLLM 에서 이 모델의 Credential 이 빠진 것 (mock: 이 모델의 모든 호출 = 401 Missing Anthropic API Key)
    await fakeCatalog({ broken: { 'fake-chat-large': '401' } });
    await testBtn(page, 'fake-chat-large').click();
    await expect(large.locator('.hl')).toHaveAttribute('data-health', 'error');
    await expect(large.locator('.hl')).toHaveText('키 없음 방금');
    // 고치는 곳 = 그 줄 둘째 줄 (두 줄까지 · 전체는 툴팁)
    await expect(large.locator('.hfix')).toHaveText('LiteLLM 관리 화면 › Models › 이 모델의 Credential 키 확인'); // 관리 화면에서 넣은 모델 = LiteLLM 에서
    await expect(large.locator('.conn')).not.toContainText('Missing'); // provider 문구는 conductor 로그에만
    await expect(page.locator('.flash')).toHaveCount(0);
    await expect(stateCount(page, '문제 있음')).toHaveText('1');
    await expect(stateCount(page, '문제 있음')).toHaveClass(/bad/);
    await page.screenshot({ path: shot('admin-models-health'), fullPage: true });
    // 문제 있음 = 그 줄만
    await stateSeg(page).getByRole('radio', { name: '문제 있음' }).click();
    await expect(stateSeg(page).getByRole('radio', { name: '문제 있음' })).toHaveAttribute('aria-checked', 'true');
    await expect(rowsOf(page)).toHaveCount(1);
    await stateSeg(page).getByRole('radio', { name: '전체' }).click();
    await expect(rowsOf(page)).toHaveCount(3);
    // 자세히 페이지 '연결' 카드: 마지막 결과 · 고치는 곳 + LiteLLM 에서 고치기 (관리 화면에서 넣은 모델 = LiteLLM 에서 고친다)
    await page.getByRole('link', { name: '자세히 — fake-chat-large' }).click();
    await expect(page).toHaveURL(/#\/models\/fake-chat-large$/);
    const conn = part(page, '연결');
    await expect(conn.locator('.hl')).toHaveAttribute('data-health', 'error');
    await expect(conn.locator('.dfix')).toContainText('Credential 키 확인');
    await expect(conn.getByRole('link', { name: 'LiteLLM 에서 고치기' })).toHaveAttribute('href', /^https?:\/\//);
    await expect(conn.getByRole('link', { name: 'LiteLLM 에서 고치기' })).toHaveAttribute('target', '_blank');
    await page.goBack();
    await expect(page).toHaveURL(/#\/models$/);

    // 다시 읽어도 남는다 (SQLite model_health) — 다른 모델은 그대로 정상 (응답 시간은 이 화면에서 테스트한 때만)
    await page.reload();
    await expect(row(page, 'fake-chat-large').locator('.hl')).toHaveAttribute('data-health', 'error');
    await expect(row(page, 'fake-chat-small').locator('.hl')).toHaveAttribute('data-health', 'ok');
    await expect(row(page, 'fake-chat-small').locator('.hl')).toHaveText('정상 방금');
    // 임베딩 모델 = 대화 모델이 아니라 테스트 버튼 없음
    await expect(testBtn(page, 'fake-embed')).toHaveCount(0);

    // 고치면 (Credential 다시 넣음) 다시 테스트 → 정상 · 고치는 곳 줄은 사라진다
    await fakeCatalog({ broken: {} });
    await testBtn(page, 'fake-chat-large').click();
    await expect(row(page, 'fake-chat-large').locator('.hl')).toHaveAttribute('data-health', 'ok');
    await expect(row(page, 'fake-chat-large').locator('.hfix')).toHaveCount(0);
  } finally {
    await fakeCatalog({ broken: {} });
  }
});

test('연결 테스트가 못 돌면 (conductor 꺼짐) 그 자리에 "conductor 꺼짐" · 마지막 결과는 그대로', async ({ page }) => {
  await page.goto('/#/models');
  await page.route(`${MODELS_API}/fake-chat-small/test`, conductorDown);
  await testBtn(page, 'fake-chat-small').click();
  const hl = row(page, 'fake-chat-small').locator('.hl');
  await expect(hl).toHaveText('conductor 꺼짐');
  await expect(hl).toHaveAttribute('title', 'fake-chat-small: conductor 에 연결할 수 없어요');
  await page.unroute(`${MODELS_API}/fake-chat-small/test`);
  // conductor 가 돌아와 새 줄을 읽으면 (동기화 · 30초마다 다시 읽기) '꺼짐' 은 지우고 서버의 마지막 결과로
  await page.getByRole('button', { name: '동기화' }).click();
  await expect(page.locator('.flash')).toBeVisible();
  await expect(hl).not.toHaveText('conductor 꺼짐');
  await testBtn(page, 'fake-chat-small').click();
  await expect(hl).toHaveAttribute('data-health', 'ok');
});

test('모두 테스트 · 고른 줄 테스트: 아직 안 써 본 키 없는 모델도 문제 있음에 잡힌다 · config.yaml 모델은 .env 키 이름으로', async ({ page }) => {
  await page.goto('/#/models');
  try {
    // config.yaml 의 OpenAI 모델 키가 빠졌다 (아무도 안 써 봤다 = 대화 실패 기록 없음)
    await fakeCatalog({ broken: { 'fake-chat-small': 'openai-missing' } });
    await page.getByRole('button', { name: '모두 테스트' }).click();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('2개 테스트, 정상 1, 실패 1: fake-chat-small (키 없음)');
    await expect(stateCount(page, '문제 있음')).toHaveText('1');
    await expect(row(page, 'fake-chat-small').locator('.hl')).toHaveAttribute('data-health', 'error');
    await expect(row(page, 'fake-chat-large').locator('.hl')).toHaveText(/^정상 \d+ms$/); // 줄마다 그 자리에
    // 등록한 곳 · 회사로 고치는 곳을 좁힌다 (config.yaml + OpenAI = .env 의 OPENAI_API_KEY) · LiteLLM 화면 링크 없음
    const fix = 'config.yaml 모델 — .env 의 OPENAI_API_KEY 확인 뒤 게이트웨이 다시 켜기 (npm run gateway)';
    await expect(row(page, 'fake-chat-small').locator('.hfix')).toHaveText(fix);
    await page.getByRole('link', { name: '자세히 — fake-chat-small' }).click();
    await expect(detail(page).locator('.mhead .src')).toHaveText('config.yaml'); // 등록한 곳 (LiteLLM /v1/model/info db_model)
    await expect(part(page, '연결').locator('.dfix .hhint')).toHaveText(fix);
    await expect(part(page, '연결').getByRole('link', { name: 'LiteLLM 에서 고치기' })).toHaveCount(0);
    await page.goBack();

    // 고른 줄만 테스트 (임베딩은 건너뛴다)
    await fakeCatalog({ broken: {} });
    await page.getByRole('checkbox', { name: '선택 — fake-chat-small' }).check();
    await page.getByRole('checkbox', { name: '선택 — fake-embed' }).check();
    await page.getByRole('toolbar', { name: '고른 모델' }).getByRole('button', { name: '연결 테스트' }).click();
    await expect(page.getByRole('status')).toContainText('1개 테스트, 모두 정상');
    await expect(row(page, 'fake-chat-small').locator('.hl')).toHaveAttribute('data-health', 'ok');
    await expect(stateCount(page, '문제 있음')).toHaveText('0');
    await expect(stateCount(page, '문제 있음')).not.toHaveClass(/bad/);
  } finally {
    await fakeCatalog({ broken: {} });
    await admin.raw('POST', '/api/admin/models/fake-chat-small/test');
  }
});

test('검색 · 상태 필터 · 제공사 필터를 함께 쓴다 · 필터 지우기', async ({ page }) => {
  await page.goto('/#/models');
  const search = page.getByRole('searchbox', { name: '모델 검색' });
  await expect(search).toHaveAttribute('placeholder', '이름이나 ID 로 찾기');
  await search.fill('LARGE');
  await expect(rowsOf(page)).toHaveCount(1);
  await expect(row(page, 'fake-chat-large')).toHaveCount(1);
  await search.fill('없는 모델');
  await expect(table(page)).toContainText('조건에 맞는 모델이 없어요');
  await table(page).getByRole('button', { name: '필터 지우기' }).click();
  await expect(search).toHaveValue('');
  await expect(rowsOf(page)).toHaveCount(3);
  // 상태 = 분할 버튼 (←→)
  const seg = stateSeg(page);
  await seg.getByRole('radio', { name: '숨김' }).click();
  await expect(rowsOf(page)).toHaveCount(1);
  await expect(row(page, 'fake-embed')).toHaveCount(1);
  await page.keyboard.press('ArrowRight');
  await expect(seg.getByRole('radio', { name: '문제 있음' })).toHaveAttribute('aria-checked', 'true');
  await seg.getByRole('radio', { name: '노출' }).click();
  await expect(rowsOf(page)).toHaveCount(2);
  // 전체 보기가 아니면 끌기 손잡이를 숨긴다
  await expect(table(page).locator('.grip')).toHaveCount(0);
  await expect(cell(page, 'fake-chat-small', 'order')).toHaveAttribute('title', '전체 보기에서 순서를 바꿀 수 있어요');
  // 제공사 필터와 겹친다: 노출 + OpenAI = small 하나 · 필터 지우기 = 셋 다 처음으로
  await pickOption(providerFilter(page), { value: 'openai' });
  await expect(rowsOf(page)).toHaveCount(1);
  await search.fill('nothing');
  await table(page).getByRole('button', { name: '필터 지우기' }).click();
  await expect(providerFilter(page)).toHaveAttribute('data-value', 'all');
  await expect(seg.getByRole('radio', { name: '전체' })).toHaveAttribute('aria-checked', 'true');
  await expect(rowsOf(page)).toHaveCount(3);
  await expect(table(page).locator('.grip')).toHaveCount(3); // 게이트웨이에 있는 줄마다 (사라짐 줄 빼고)
});

test('자세히 페이지: 줄을 누르면 #/models/<id> → 머리(이름 h1 · 실제 이름 · 노출 · 기본 · 연결 테스트) · 사용자 앱 · 연결 · 게이트웨이 값(읽기 전용) → 바꾼 값이 목록에', async ({ page }) => {
  await page.goto('/#/models');
  try {
    // 줄의 고르기 칸 · 스위치 · 버튼은 제 일만 한다 (페이지로 가지 않는다)
    await page.getByRole('checkbox', { name: '선택 — fake-chat-large' }).check();
    await expect(page).toHaveURL(/#\/models$/);
    await page.getByRole('checkbox', { name: '선택 — fake-chat-large' }).uncheck();
    await testBtn(page, 'fake-chat-large').click();
    await expect(row(page, 'fake-chat-large').locator('.hl')).toHaveAttribute('data-health', 'ok');
    await expect(page).toHaveURL(/#\/models$/);

    await cell(page, 'fake-chat-large', 'context').click(); // 줄의 빈 곳
    await expect(page).toHaveURL(/#\/models\/fake-chat-large$/);
    await expect(table(page)).toHaveCount(0); // 서랍이 아니라 페이지
    await expect(page.locator('dialog')).toHaveCount(0);
    // 위 줄 = ← 모델 목록 (메뉴는 그대로 '모델') · h1 = 보이는 이름 하나 (포커스)
    await expect(page.getByRole('link', { name: '모델 목록', exact: true })).toHaveAttribute('href', '#/models');
    await expect(page.getByRole('navigation', { name: '관리 메뉴' }).getByRole('link', { name: '모델', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(h1(page)).toHaveText(['fake-chat-large']);
    await expect(h1(page)).toBeFocused();
    const head = detail(page).locator('.mhead');
    await expect(head.locator('.ui-tile svg')).toHaveAttribute('data-provider', 'anthropic');
    await expect(head.locator('.ui-page-desc .mid')).toHaveText('fake-chat-large'); // 실제 모델 이름
    await expect(head.locator('.src')).toHaveText('LiteLLM UI');
    // 몸 = 카드 셋 (사용자 앱 · 연결 · 게이트웨이 값)
    await expect(detail(page).locator('section.mcard .ui-card-title')).toHaveText(['사용자 앱', '연결', '게이트웨이 값']);
    const app = part(page, '사용자 앱');
    // 넓은 창(≥1100) = 두 칸: 왼쪽 사용자 앱 · 연결 / 오른쪽 게이트웨이 값
    const [ab, cb, gb] = await Promise.all([app.boundingBox(), part(page, '연결').boundingBox(), part(page, '게이트웨이 값').boundingBox()]);
    expect(gb!.x).toBeGreaterThan(ab!.x + ab!.width - 1);
    expect(cb!.y).toBeGreaterThan(ab!.y + ab!.height - 1);
    await expect(app.locator('.dlab')).toHaveText(['표시 이름', '노출', '기본', '순서']);
    await expect(app).toContainText('사용자 앱 모델 메뉴에 보여요');
    const gw = part(page, '게이트웨이 값');
    await expect(gw).toContainText('읽기 전용, 값은 LiteLLM 에서 바꿔요');
    const kv = gw.locator('.dkv');
    await expect(kv.locator('dt')).toHaveText(['제공사', '컨텍스트', '출력 한도', '입력 비용', '출력 비용', '기능', '등록한 곳', '처음 본 때', '마지막 본 때']);
    await expect(kv.locator('.ui-kv-row').filter({ hasText: '제공사' }).locator('dd svg')).toHaveAttribute('data-provider', 'anthropic');
    await expect(kv.locator('.ui-kv-row').filter({ hasText: '제공사' }).locator('dd')).toContainText('Anthropic');
    await expect(kv.locator('.ui-kv-row').filter({ hasText: '컨텍스트' }).locator('dd')).toHaveText('200K 토큰');
    await expect(kv.locator('.ui-kv-row').filter({ hasText: '출력 한도' }).locator('dd')).toHaveText('64K 토큰');
    await expect(kv.locator('.ui-kv-row').filter({ hasText: '입력 비용' }).locator('dd')).toHaveText('$3 / 100만 토큰');
    await expect(kv.locator('.ui-kv-row').filter({ hasText: '출력 비용' }).locator('dd')).toHaveText('$15 / 100만 토큰');
    await expect(kv.locator('.mcap')).toHaveText(['텍스트', '이미지 입력', '도구 호출', '생각']); // 아이콘 + 이름
    await expect(gw).toContainText('LiteLLM 관리 화면 (DB)');
    // 입력칸 없음 (이름을 바꾸기 전엔) · 가격 · 제공사 · 컨텍스트를 바꾸는 칸 · 고르기 상자 없음
    for (const role of ['textbox', 'spinbutton', 'combobox', 'slider'] as const) await expect(page.getByRole(role)).toHaveCount(0);
    await page.screenshot({ path: shot('admin-models-detail'), fullPage: true, animations: 'disabled' });

    // 이름
    await app.getByRole('button', { name: '이름 바꾸기' }).click();
    const input = app.getByRole('textbox', { name: '표시 이름' });
    await expect(input).toBeFocused();
    await input.fill('큰 모델');
    await input.press('Enter');
    await expect(h1(page)).toHaveText(['큰 모델']);
    await expect(head.locator('.ui-page-desc .mid')).toHaveText('fake-chat-large');
    await expect(app.getByRole('button', { name: '기본 이름(fake-chat-large)으로' })).toBeVisible();

    // 기본 (머리) · 순서
    await head.getByRole('button', { name: '기본 모델로 정하기' }).click();
    await expect(page.getByRole('status')).toContainText('기본 모델을 바꿨어요: 큰 모델');
    await expect(head.getByRole('button', { name: '기본 모델이에요' })).toBeDisabled();
    await expect(head.locator('.dflt')).toHaveText('기본');
    await expect(app).toContainText('기본 모델, 새 대화가 이 모델로 시작해요');
    // 기본은 표시만 · 메뉴에서 제자리 (순서 = 전체 순서)
    expect((await userModels()).map((m) => [m.id, m.is_default])).toEqual([['fake-chat-small', false], ['fake-chat-large', true]]);
    const ord = app.locator('.dord');
    await expect(ord).toContainText('2 / 3'); // 전체 자리 (제공사와 상관없이)
    await expect(app.getByRole('button', { name: '위로 옮기기' })).toBeEnabled();
    await app.getByRole('button', { name: '아래로 옮기기' }).click();
    await expect(ord).toContainText('3 / 3');
    await expect(app.getByRole('button', { name: '아래로 옮기기' })).toBeDisabled(); // 맨 끝

    // 연결 테스트 (머리) → 결과는 머리 · 연결 카드 둘 다
    await head.getByRole('button', { name: '연결 테스트', exact: true }).click();
    await expect(head.locator('.hl')).toHaveText(/^정상 \d+ms$/);
    await expect(part(page, '연결').locator('.ui-kv-row').filter({ hasText: '응답 시간' }).locator('dd')).toHaveText(/^\d+ms$/);
    await expect(part(page, '연결').locator('.ui-kv-row').filter({ hasText: '마지막 정상' }).locator('dd')).toHaveText('방금');

    // 노출 끄기 (머리 스위치) = 사용자 앱에서 빠진다 · 기본도 풀린다
    const sw = head.getByRole('switch', { name: '노출' });
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await expect(app).toContainText('숨김, 사용자 앱에 안 보여요');
    expect((await userModels()).map((m) => m.id)).toEqual(['fake-chat-small']);
    await expect(head.getByRole('button', { name: '기본 모델로 정하기' })).toBeDisabled(); // 노출한 모델만 기본
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'true');

    // ← 모델 목록: 바꾼 값이 표에 · 포커스는 그 줄 이름 링크로
    await page.getByRole('link', { name: '모델 목록', exact: true }).click();
    await expect(page).toHaveURL(/#\/models$/);
    await expect(row(page, 'fake-chat-large').locator('.ncell b')).toHaveText('큰 모델');
    await expect(exposeSwitch(page, '큰 모델')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('link', { name: '자세히 — 큰 모델' })).toBeFocused();
  } finally {
    await patch('fake-chat-large', { display_name: null, exposed: true, order: 2 });
    await patch('fake-chat-small', { order: 1, is_default: true });
  }
});

test('자세히 페이지 = 주소: 링크로 바로 열기 · 뒤로 · 앞으로 · 없는 id = 찾을 수 없음 + 목록으로', async ({ page }) => {
  // 링크로 바로 (새로 고쳐도 그 페이지)
  await page.goto('/#/models/fake-chat-small');
  await expect(h1(page)).toHaveText(['fake-chat-small']);
  await expect(detail(page).locator('.mhead .dflt')).toHaveText('기본');
  await page.reload();
  await expect(h1(page)).toHaveText(['fake-chat-small']);

  // 목록 → 이름 링크 → 뒤로 = 목록 (거르개 그대로) → 앞으로 = 다시 페이지
  await page.goto('/#/models');
  await pickOption(providerFilter(page), { value: 'openai' });
  await expect(rowsOf(page)).toHaveCount(2);
  const link = page.getByRole('link', { name: '자세히 — fake-chat-small' });
  await expect(link).toHaveAttribute('href', '#/models/fake-chat-small');
  await link.click();
  await expect(h1(page)).toHaveText(['fake-chat-small']);
  await page.goBack();
  await expect(page).toHaveURL(/#\/models$/);
  await expect(providerFilter(page)).toHaveAttribute('data-value', 'openai');
  await expect(rowsOf(page)).toHaveCount(2);
  await page.goForward();
  await expect(page).toHaveURL(/#\/models\/fake-chat-small$/);
  await expect(h1(page)).toHaveText(['fake-chat-small']);

  // 없는 id ('/' 가 든 id 도 한 칸 — encodeURIComponent) → 안내 + 목록으로
  await page.goto(`/#/models/${encodeURIComponent('vertex_ai/없는-모델')}`);
  await expect(h1(page)).toHaveText(['모델을 찾을 수 없어요']);
  await expect(detail(page).locator('.mhead .mid')).toHaveText('vertex_ai/없는-모델');
  await expect(part(page, '사용자 앱')).toHaveCount(0);
  await page.screenshot({ path: shot('admin-models-detail-missing'), fullPage: true });
  // 손으로 친 주소 ('/' 를 그대로) 도 한 id
  await page.goto('/#/models/vertex_ai/없는-모델');
  await expect(detail(page).locator('.mhead .mid')).toHaveText('vertex_ai/없는-모델');
  await detail(page).getByRole('link', { name: '모델 목록으로' }).click();
  await expect(page).toHaveURL(/#\/models$/);
  await expect(providerFilter(page)).toHaveAttribute('data-value', 'openai'); // 같은 화면 안이라 거르개는 그대로
  await pickOption(providerFilter(page), { value: 'all' });
  await expect(rowsOf(page)).toHaveCount(3);
  // 탭 이름은 길이 아니다 ('#/models/add' = 모델 추가 탭)
  await page.goto('/#/models/add');
  await expect(tabs(page).getByRole('tab', { name: '모델 추가' })).toHaveAttribute('aria-selected', 'true');
});

test('같은 표시 이름 = "이름 겹침" 표시 (사용자 앱에서 헷갈리는 경우)', async ({ page }) => {
  try {
    await patch('fake-chat-small', { display_name: 'fake-chat-large' });
    await page.goto('/#/models');
    await expect(row(page, 'fake-chat-small').locator('.dupb')).toHaveText('이름 겹침');
    await expect(row(page, 'fake-chat-large').locator('.dupb')).toHaveText('이름 겹침');
    await expect(row(page, 'fake-embed').locator('.dupb')).toHaveCount(0);
    // 한쪽을 숨기면 사용자 앱에선 안 겹친다 → 옅은 '이름 같음' (경고 아님)
    const largeSwitch = row(page, 'fake-chat-large').getByRole('switch'); // 이름이 같아 스위치 이름으로는 못 가른다
    await largeSwitch.click();
    await expect(largeSwitch).toHaveAttribute('aria-checked', 'false');
    await expect(row(page, 'fake-chat-small').locator('.dupb')).toHaveText('이름 같음');
    await expect(row(page, 'fake-chat-small').locator('.dupb')).toHaveClass(/soft/);
    await row(page, 'fake-chat-small').locator('.nbtn').click();
    await expect(part(page, '사용자 앱').locator('.dwarn')).toContainText('한쪽이 숨김이라 지금은 사용자 앱에서 겹치지 않아요');
    await expect(detail(page).locator('.mhead .dupb')).toHaveText('이름 같음');
    await page.goBack();
  } finally {
    await patch('fake-chat-small', { display_name: null });
    await patch('fake-chat-large', { exposed: true });
  }
});

test('여러 개 고르기: 노출 · 숨기기 한 번에 (대화 모델이 아니면 건너뜀) · 선택 해제', async ({ page }) => {
  await page.goto('/#/models');
  try {
    await page.getByRole('checkbox', { name: '선택 — fake-chat-large' }).check();
    await page.getByRole('checkbox', { name: '선택 — fake-embed' }).check();
    const bulk = page.getByRole('toolbar', { name: '고른 모델' });
    await expect(bulk).toContainText('2개 선택됨');
    await expect(providerFilter(page)).toHaveCount(0); // 고르는 동안 필터 자리에 일괄 버튼
    await bulk.getByRole('button', { name: '숨기기' }).click();
    await expect(page.getByRole('status')).toContainText('1개 숨김, 1개는 이미 숨김');
    await expect(exposeSwitch(page, 'fake-chat-large')).toHaveAttribute('aria-checked', 'false');
    await expect(bulk).toHaveCount(0); // 끝나면 선택이 풀린다

    await page.getByRole('checkbox', { name: '선택 — fake-chat-large' }).check();
    await page.getByRole('checkbox', { name: '선택 — fake-embed' }).check();
    await bulk.getByRole('button', { name: '노출' }).click();
    await expect(page.getByRole('status')).toContainText('1개 노출, 1개는 대화 모델이 아니라 건너뜀');
    await expect(exposeSwitch(page, 'fake-chat-large')).toHaveAttribute('aria-checked', 'true');
    await expect(exposeSwitch(page, 'fake-embed')).toHaveAttribute('aria-checked', 'false');

    await page.getByRole('checkbox', { name: '선택 — fake-chat-small' }).check();
    await bulk.getByRole('button', { name: '선택 해제' }).click();
    await expect(bulk).toHaveCount(0);
    await expect(providerFilter(page)).toBeVisible();
  } finally {
    await patch('fake-chat-large', { exposed: true });
  }
});

test.describe('폭 960 · 390', () => {
  for (const width of [960, 390]) {
    test(`${width}px: 가로 스크롤 없음 · 덜 중요한 칸부터 숨는다 · 노출 · 기본 · 연결은 화면 안 · 두 탭 · 자세히 페이지 한 칸`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/#/models');
      await expect(rowsOf(page)).toHaveCount(3);
      await expect.poll(() => overflowX(page)).toBeLessThanOrEqual(0);
      // 960 = 기능 · 비용 · 컨텍스트는 숨고 (자세히 페이지에 있다) · 390 = 제공사 · 순서 · 고르기 칸도 숨는다
      const shown = ['모델', '노출', '기본', '연결', ...(width > 760 ? ['제공사', '순서'] : [])];
      for (const name of shown) await expect(table(page).getByRole('columnheader', { name, exact: true })).toBeVisible();
      for (const name of ['기능', '입력 비용', '출력 비용', '컨텍스트', ...(width > 760 ? [] : ['제공사', '순서'])]) {
        await expect(table(page).getByRole('columnheader', { name, exact: true })).toBeHidden();
      }
      // 맨 오른쪽 칸(노출 · 기본 · 연결)도 표 안쪽 가로 스크롤 없이 보인다
      const frame = await page.locator('.mtable').boundingBox();
      for (const name of ['노출', '기본', '연결']) {
        const box = await table(page).getByRole('columnheader', { name, exact: true }).boundingBox();
        expect(box!.x + box!.width, name).toBeLessThanOrEqual(frame!.x + frame!.width + 1);
      }
      await expect(testBtn(page, 'fake-chat-small')).toBeInViewport();
      await page.screenshot({ path: shot(`admin-models-${width}`), fullPage: true });
      await page.goto('/#/models/add');
      await expect(page.getByRole('heading', { name: '모델을 추가하는 순서' })).toBeVisible();
      await expect.poll(() => overflowX(page)).toBeLessThanOrEqual(0);
      await page.screenshot({ path: shot(`admin-models-add-${width}`), fullPage: true });
      // 자세히 페이지 = 한 칸 (사용자 앱 · 연결 · 게이트웨이 값이 위아래로)
      await page.goto('/#/models/fake-chat-large');
      await expect(h1(page)).toHaveText(['fake-chat-large']);
      await expect.poll(() => overflowX(page)).toBeLessThanOrEqual(0);
      const a = await part(page, '사용자 앱').boundingBox();
      const g = await part(page, '게이트웨이 값').boundingBox();
      expect(g!.y).toBeGreaterThan(a!.y + a!.height - 1);
      await page.screenshot({ path: shot(`admin-models-detail-${width}`), fullPage: true });
    });
  }
});

// ↓ 맨 끝: 게이트웨이 카탈로그를 바꾼다 (끝나면 fake-chat-late 가 '사라짐' 줄로 남는다)
test('P2-2 LiteLLM 에 모델이 추가되면 후보 · 숨김으로만 뜬다 → 모델 추가 탭에서 확인 · 노출 → 사용자 앱에 → 게이트웨이에서 빠지면 사라짐', async ({ page }) => {
  await page.goto('/#/models');
  await expect(rowsOf(page)).toHaveCount(3);
  try {
    await fakeCatalog({ late: true }); // LiteLLM Admin UI 에서 gemini 모델을 하나 추가한 것
    await page.getByRole('button', { name: '동기화' }).click();
    await expect(page.getByRole('status')).toContainText('새 모델 1개 (후보, 숨김)');
    const late = row(page, 'fake-chat-late');
    await expect(late.locator('.chip')).toHaveText('후보');
    await expect(cell(page, 'fake-chat-late', 'provider').locator('svg')).toHaveAttribute('data-provider', 'google');
    await expect(exposeSwitch(page, 'fake-chat-late')).toHaveAttribute('aria-checked', 'false'); // 기본 숨김
    await expect(stateCount(page, '후보')).toHaveText('1');
    await expect(page.locator('.cand')).toContainText('새 모델 1개가 후보로 들어왔어요');
    await expect(tabs(page).getByRole('tab', { name: '모델 추가' }).locator('.ui-tab-count')).toHaveText('1'); // 할 일 = 탭 옆 숫자
    expect(await providerOptions(page)).toContain('Google 노출 0/1');
    expect((await userModels()).map((m) => m.id)).not.toContain('fake-chat-late');
    await page.screenshot({ path: shot('admin-models-candidate'), fullPage: true });

    // 알림 줄 '후보 확인' → 모델 추가 탭의 후보 목록 → 노출하기
    await page.locator('.cand').getByRole('link', { name: '후보 확인' }).click();
    await expect(page).toHaveURL(/#\/models\/add$/);
    const item = candList(page).locator('li[data-model="fake-chat-late"]');
    await expect(item).toContainText('fake-chat-late');
    await expect(item.locator('.mcap')).not.toHaveCount(0);
    await expect(item.getByRole('button', { name: '연결 테스트 — fake-chat-late' })).toHaveText('테스트'); // 노출 전에 확인
    // 자세히 = 같은 자세히 페이지 (후보 딱지 · 노출 꺼짐) → 뒤로 = 모델 추가 탭
    await item.getByRole('link', { name: '자세히 — fake-chat-late' }).click();
    await expect(page).toHaveURL(/#\/models\/fake-chat-late$/);
    await expect(detail(page).locator('.mhead .chip')).toHaveText('후보');
    await expect(detail(page).locator('.mhead').getByRole('switch', { name: '노출' })).toHaveAttribute('aria-checked', 'false');
    await expect(part(page, '사용자 앱')).toContainText('후보, 확인하고 노출을 켜면 사용자 앱에 보여요');
    await page.goBack();
    await expect(page).toHaveURL(/#\/models\/add$/);
    await page.screenshot({ path: shot('admin-models-add-candidate'), fullPage: true });
    await page.getByRole('button', { name: '노출하기 — fake-chat-late' }).click();
    await expect(page.getByRole('status')).toContainText('fake-chat-late 노출했어요');
    await expect(candList(page)).toHaveCount(0);
    await expect(page.getByText('확인할 후보가 없어요')).toBeVisible();
    const shown = (await userModels()).find((m) => m.id === 'fake-chat-late');
    expect(shown?.provider).toBe('google');

    await tabs(page).getByRole('tab', { name: '모델 목록' }).click();
    await expect(late.locator('.chip')).toHaveCount(0); // 노출 = 딱지 없음 (스위치가 말한다)
    await expect(late).toHaveAttribute('data-state', 'exposed');
    await expect(page.locator('.cand')).toHaveCount(0);
    await exposeSwitch(page, 'fake-chat-late').click();
    await expect(late).toHaveAttribute('data-state', 'hidden'); // 한 번 본 모델 = 후보 딱지 없음
    await expect(late.locator('.chip')).toHaveCount(0);

    await fakeCatalog({ reset: true }); // LiteLLM 에서 지움
    await page.getByRole('button', { name: '동기화' }).click();
    await expect(page.getByRole('status')).toContainText('사라진 모델 1개 (자동 숨김)');
    await expect(late.locator('.chip')).toHaveText('게이트웨이에서 사라짐');
    await expect(exposeSwitch(page, 'fake-chat-late')).toBeDisabled();
    await expect(cell(page, 'fake-chat-late', 'order')).toHaveText('—');
    await expect(stateCount(page, '숨김')).toHaveText('2'); // 숨김 = 사라짐 포함
  } finally {
    await fakeCatalog({ reset: true });
  }
});
