import { test, expect, type Page } from '@playwright/test';
import { API, GATEWAY, GATEWAY_KEY } from './env';
import { shot } from './helpers';

// 관리자 '모델' = conductor /api/admin/models (mock 게이트웨이 /model_group/info 를 동기화한 model_exposure, ADR-0006)
// 모델 등록은 LiteLLM 에서만. 여기서 바꾸는 것 = 노출 · 표시 이름 · 순서 · 기본 모델. 회사(provider)별로 묶어 보인다.
// 처음 상태(E2E conductor = 메모리 DB): fake-chat-small(OpenAI) · fake-chat-large(Anthropic) 노출, fake-embed(OpenAI, 임베딩) 숨김.
// 바꾼 값은 테스트마다 되돌린다 (desktop 스펙도 같은 conductor 를 쓴다). 새 모델(P2-2) 테스트는 '사라짐' 줄을 남겨서 맨 끝에 둔다.
const COLS = ['순서', '모델', '회사', '상태', '노출', '기본', '게이트웨이 값'];
const table = (page: Page) => page.getByRole('table', { name: '모델 목록' });
const row = (page: Page, id: string) => table(page).locator(`tbody tr[data-model="${id}"]`);
const exposeSwitch = (page: Page, label: string) => page.getByRole('switch', { name: `노출 — ${label}` });
const filters = (page: Page) => page.getByRole('toolbar', { name: '회사별 보기' });

async function userModels(): Promise<{ id: string; label: string; provider: string; is_default: boolean }[]> {
  return (await fetch(`${API}/api/models`)).json();
}
async function patch(id: string, body: object) {
  const res = await fetch(`${API}/api/admin/models/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  expect(res.ok, `PATCH ${id} ${JSON.stringify(body)}`).toBe(true);
}
async function fakeCatalog(body: object) {
  const res = await fetch(`${GATEWAY}/__fake/catalog`, {
    method: 'POST', headers: { authorization: `Bearer ${GATEWAY_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  expect(res.ok).toBe(true);
}

test('mock 게이트웨이 모델이 표에 뜬다 (채팅 = 노출 · 순서, 임베딩 = 숨김) · 회사 아이콘 · 회사별 개수', async ({ page }) => {
  await page.goto('/#/models');
  await expect(table(page).getByRole('columnheader')).toHaveText(COLS);
  const rows = table(page).locator('tbody tr');
  await expect(rows).toHaveCount(3);
  expect(await rows.evaluateAll((trs) => trs.map((tr) => tr.getAttribute('data-model')))).toEqual(['fake-chat-small', 'fake-chat-large', 'fake-embed']);

  const small = row(page, 'fake-chat-small');
  await expect(small.locator('td.ord')).toContainText('1');
  await expect(small.locator('.ncell b')).toHaveText('fake-chat-small');
  await expect(small.locator('.ncell code')).toHaveText('fake-chat-small');
  await expect(small.locator('.prov')).toHaveText('OpenAI');
  await expect(small.locator('.prov svg')).toHaveAttribute('data-provider', 'openai');
  await expect(small.locator('.chip')).toHaveText('노출');
  await expect(small.locator('.dflt')).toHaveText('기본');
  await expect(exposeSwitch(page, 'fake-chat-small')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radio', { name: '기본 모델 — fake-chat-small' })).toBeChecked();
  await expect(small.locator('.ginfo')).toContainText('컨텍스트 128K · 도구 · 이미지');
  await expect(small.locator('.ginfo .price')).toHaveText('$0.15 / $0.60');

  const large = row(page, 'fake-chat-large');
  await expect(large.locator('td.ord')).toContainText('2');
  await expect(large.locator('.prov')).toHaveText('Anthropic');
  await expect(large.locator('.prov svg')).toHaveAttribute('data-provider', 'anthropic');
  await expect(large.locator('.chip')).toHaveText('노출');
  await expect(large.locator('.ginfo')).toContainText('생각');

  const embed = row(page, 'fake-embed');
  await expect(embed.locator('.chip')).toHaveText('숨김');
  await expect(exposeSwitch(page, 'fake-embed')).toBeDisabled(); // 대화 모델이 아니라 노출 못 함
  await expect(page.getByRole('radio', { name: '기본 모델 — fake-embed' })).toBeDisabled();
  await expect(embed.locator('.ginfo')).toContainText('임베딩 · 대화에 안 씀');

  await expect(page.locator('.legend')).toContainText('노출 2');
  await expect(page.locator('.legend')).toContainText('숨김 1');
  await expect(page.locator('.legend')).toContainText('후보 0');
  // 회사별 = 아이콘 · 개수 · 노출 수 (conductor 회사 순서: Anthropic → OpenAI)
  await expect(filters(page).getByRole('button')).toHaveText(['전체 3', 'Anthropic1노출 1', 'OpenAI2노출 1']);
  await expect(filters(page).locator('svg[data-provider]')).toHaveCount(2);
  await page.screenshot({ path: shot('admin-models-live'), fullPage: true });
});

test('회사별 보기: 누르면 그 회사 모델만 · 전체로 돌아온다', async ({ page }) => {
  await page.goto('/#/models');
  const rows = table(page).locator('tbody tr');
  await expect(rows).toHaveCount(3);
  await filters(page).getByRole('button', { name: /^OpenAI/ }).click();
  await expect(filters(page).getByRole('button', { name: /^OpenAI/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(rows).toHaveCount(2);
  await expect(row(page, 'fake-chat-large')).toHaveCount(0);
  await filters(page).getByRole('button', { name: /^Anthropic/ }).click();
  await expect(rows).toHaveCount(1);
  await expect(row(page, 'fake-chat-large')).toHaveCount(1);
  await filters(page).getByRole('button', { name: /^전체/ }).click();
  await expect(rows).toHaveCount(3);
});

test('노출 끄기 → 사용자 앱 목록(/api/models)에서 빠진다 → 켜면 돌아온다 (P2-1)', async ({ page }) => {
  await page.goto('/#/models');
  const sw = exposeSwitch(page, 'fake-chat-large');
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  try {
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await expect(row(page, 'fake-chat-large').locator('.chip')).toHaveText('숨김');
    await expect(page.locator('.legend')).toContainText('노출 1');
    await expect(filters(page).getByRole('button', { name: /^Anthropic/ })).toContainText('노출 0');
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
    await expect(row(page, 'fake-chat-large').locator('.ncell code')).toHaveText('fake-chat-large'); // 게이트웨이 ID 는 그대로
    await expect(row(page, 'fake-chat-large')).toContainText('기본 이름 fake-chat-large');
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

test('순서: 아래로 · 위로 (사용자 앱 메뉴 순서) · 기본 모델: 라디오', async ({ page }) => {
  await page.goto('/#/models');
  const ids = () => table(page).locator('tbody tr').evaluateAll((trs) => trs.map((tr) => tr.getAttribute('data-model')));
  try {
    await expect(page.getByRole('button', { name: '위로 — fake-chat-small' })).toBeDisabled(); // 맨 위
    await page.getByRole('button', { name: '아래로 — fake-chat-small' }).click();
    await expect.poll(ids).toEqual(['fake-chat-large', 'fake-chat-small', 'fake-embed']);
    await expect(row(page, 'fake-chat-large').locator('td.ord')).toContainText('1');
    await page.getByRole('button', { name: '위로 — fake-chat-small' }).click();
    await expect.poll(ids).toEqual(['fake-chat-small', 'fake-chat-large', 'fake-embed']);

    // 기본 모델 = 사용자 앱 목록 첫 항목
    await page.getByRole('radio', { name: '기본 모델 — fake-chat-large' }).check();
    await expect(page.getByRole('status')).toContainText('기본 모델을 바꿨어요 · fake-chat-large');
    await expect(row(page, 'fake-chat-large').locator('.dflt')).toHaveText('기본');
    await expect(row(page, 'fake-chat-small').locator('.dflt')).toHaveCount(0);
    const list = await userModels();
    expect(list.map((m) => [m.id, m.is_default])).toEqual([['fake-chat-large', true], ['fake-chat-small', false]]);
    await page.getByRole('radio', { name: '기본 모델 — fake-chat-small' }).check();
    await expect(row(page, 'fake-chat-small').locator('.dflt')).toHaveText('기본');
  } finally {
    await patch('fake-chat-small', { order: 1, is_default: true });
  }
  expect((await userModels())[0].id).toBe('fake-chat-small');
});

test('"LiteLLM 에서 추가" = LiteLLM Admin UI 새 탭 (등록은 거기서만) · 바꿀 수 없는 일은 서버가 막는다', async ({ page }) => {
  await page.goto('/#/models');
  const add = page.getByRole('link', { name: 'LiteLLM 에서 추가' });
  await expect(add).toHaveAttribute('href', `${GATEWAY}/ui`); // LLM_GATEWAY_UI_URL 이 비면 게이트웨이 주소 + /ui
  await expect(add).toHaveAttribute('target', '_blank');
  await expect(add).toHaveAttribute('rel', /noopener/);
  await expect(page.locator('.note')).toContainText('모델은 게이트웨이(LiteLLM)에서만 등록됩니다');
  // 서버: 가격 · 회사 같은 칸은 PATCH 로 못 바꾼다 (422) · 임베딩은 노출 못 함 (409)
  const bad = await fetch(`${API}/api/admin/models/fake-chat-small`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input_cost_per_token: 0 }),
  });
  expect(bad.status).toBe(422);
  const embed = await fetch(`${API}/api/admin/models/fake-embed`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ exposed: true }),
  });
  expect(embed.status).toBe(409);
});

test('conductor 가 꺼져 있으면 안내 → 다시 시도로 회복', async ({ page }) => {
  await page.route(`${API}/**`, (r) => r.abort('connectionrefused'));
  await page.goto('/#/models');
  await expect(page.getByRole('alert')).toContainText('conductor 에 연결할 수 없어요');
  await expect(page.getByRole('button', { name: 'LiteLLM 에서 추가' })).toBeDisabled(); // 주소를 모르면 못 누른다
  await page.unroute(`${API}/**`);
  await page.getByRole('button', { name: '다시 시도' }).click();
  await expect(table(page).locator('tbody tr')).toHaveCount(3);
});

test('게이트웨이가 꺼져 있으면 (conductor 503) 게이트웨이 안내', async ({ page }) => {
  await page.route(`${API}/api/admin/models`, (r) =>
    r.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"gateway_unreachable"}' }));
  await page.goto('/#/models');
  await expect(page.getByRole('alert')).toContainText('게이트웨이에 연결할 수 없어요');
  await expect(page.locator('.legend')).toContainText('노출 —'); // 오류일 땐 0 이 아니라 —
});

test('게이트웨이가 떠 있는데 오류를 내면 (conductor 502) "꺼짐" 이 아니라 오류 안내', async ({ page }) => {
  await page.route(`${API}/api/admin/models`, (r) =>
    r.fulfill({ status: 502, contentType: 'application/json', body: '{"detail":"gateway_error"}' }));
  await page.goto('/#/models');
  await expect(page.getByRole('alert')).toContainText('게이트웨이가 오류를 냈어요');
  await page.goto('/#/overview');
  await expect(gatewayCard(page).locator('.v')).toHaveText('오류');
});

test('게이트웨이에 모델이 0개면 빈 표 안내', async ({ page }) => {
  await page.route(`${API}/api/admin/models`, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto('/#/models');
  await expect(table(page)).toContainText('게이트웨이에 모델이 없어요');
});

test('PATCH 가 실패하면 줄은 그대로 + 이유 한 줄', async ({ page }) => {
  await page.goto('/#/models');
  await page.route(`${API}/api/admin/models/fake-chat-large`, (r) =>
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
  await expect(gatewayCard(page).locator('.sub')).toHaveText('LiteLLM · 모델 3개 · 회사 2곳');
  await expect(exposedCard(page).locator('.v')).toHaveText('2');
  await expect(exposedCard(page).locator('.sub')).toHaveText('후보 0 · 숨김 1');
  await page.screenshot({ path: shot('admin-overview-live'), fullPage: true });
});

test('개요: conductor · 게이트웨이가 꺼지면 카드가 그렇게 말한다', async ({ page }) => {
  await page.route(`${API}/**`, (r) => r.abort('connectionrefused'));
  await page.goto('/#/overview');
  await expect(gatewayCard(page)).toHaveAttribute('data-state', 'error');
  await expect(gatewayCard(page).locator('.v')).toHaveText('conductor 꺼짐');
  await page.unroute(`${API}/**`);
  await page.route(`${API}/api/admin/models`, (r) =>
    r.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"gateway_unreachable"}' }));
  await page.reload();
  await expect(gatewayCard(page).locator('.v')).toHaveText('꺼짐');
  await expect(gatewayCard(page).locator('.sub')).toContainText('npm run gateway');
  await expect(exposedCard(page).locator('.v')).toHaveText('—');
});

// ↓ 맨 끝: 게이트웨이 카탈로그를 바꾼다 (끝나면 fake-chat-late 가 '사라짐' 줄로 남는다)
test('P2-2 LiteLLM 에 모델이 추가되면 후보 · 숨김으로만 뜬다 → 노출하면 사용자 앱에 → 게이트웨이에서 빠지면 사라짐', async ({ page }) => {
  await page.goto('/#/models');
  await expect(table(page).locator('tbody tr')).toHaveCount(3);
  try {
    await fakeCatalog({ late: true }); // LiteLLM Admin UI 에서 gemini 모델을 하나 추가한 것
    await page.getByRole('button', { name: '동기화' }).click();
    await expect(page.getByRole('status')).toContainText('새 모델 1개 (후보 · 숨김)');
    const late = row(page, 'fake-chat-late');
    await expect(late.locator('.chip')).toHaveText('후보');
    await expect(late.locator('.prov')).toHaveText('Google');
    await expect(late.locator('.prov svg')).toHaveAttribute('data-provider', 'google');
    await expect(exposeSwitch(page, 'fake-chat-late')).toHaveAttribute('aria-checked', 'false'); // 기본 숨김
    await expect(page.locator('.legend')).toContainText('후보 1');
    await expect(page.locator('.cand')).toContainText('새 모델 1개가 후보로 들어왔어요');
    await expect(filters(page).getByRole('button', { name: /^Google/ })).toHaveText('Google1노출 0');
    expect((await userModels()).map((m) => m.id)).not.toContain('fake-chat-late');
    await page.screenshot({ path: shot('admin-models-candidate'), fullPage: true });

    await exposeSwitch(page, 'fake-chat-late').click();
    await expect(late.locator('.chip')).toHaveText('노출');
    await expect(page.locator('.cand')).toHaveCount(0);
    const shown = (await userModels()).find((m) => m.id === 'fake-chat-late');
    expect(shown?.provider).toBe('google');
    await exposeSwitch(page, 'fake-chat-late').click();
    await expect(late.locator('.chip')).toHaveText('숨김'); // 한 번 본 모델 = 후보 딱지 없음

    await fakeCatalog({ reset: true }); // LiteLLM 에서 지움
    await page.getByRole('button', { name: '동기화' }).click();
    await expect(page.getByRole('status')).toContainText('사라진 모델 1개 (자동 숨김)');
    await expect(late.locator('.chip')).toHaveText('게이트웨이에서 사라짐');
    await expect(exposeSwitch(page, 'fake-chat-late')).toBeDisabled();
    await expect(late.locator('td.ord')).toHaveText('—');
    await expect(page.locator('.legend')).toContainText('사라짐 1');
  } finally {
    await fakeCatalog({ reset: true });
  }
});
