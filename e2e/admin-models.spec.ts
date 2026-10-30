import { test, expect, type Page, type Route } from '@playwright/test';
import { adminApi, userApi, type Client } from './auth';
import { ADMIN_URL, GATEWAY, GATEWAY_KEY } from './env';
import { overflowX, shot } from './helpers';

// 관리자 '모델' = conductor /api/admin/models (mock 게이트웨이 /model_group/info 를 동기화한 model_exposure, ADR-0006)
// 모델 등록은 LiteLLM 에서만. 여기서 바꾸는 것 = 노출 · 표시 이름 · 순서 · 기본 모델. 회사(provider)별로 묶어 보인다.
// 처음 상태(E2E conductor = 메모리 DB): fake-chat-small(OpenAI) · fake-chat-large(Anthropic) 노출, fake-embed(OpenAI, 임베딩) 숨김.
// 바꾼 값은 테스트마다 되돌린다 (desktop 스펙도 같은 conductor 를 쓴다). 새 모델(P2-2) 테스트는 '사라짐' 줄을 남겨서 맨 끝에 둔다.
const COLS = ['선택', '순서', '모델', '상태', '노출', '기본', '연결', '정보'];
const table = (page: Page) => page.getByRole('table', { name: '모델 목록' });
const rowsOf = (page: Page) => table(page).locator('tbody tr[data-model]'); // 회사 머리줄(tr.grp) 빼고
const row = (page: Page, id: string) => table(page).locator(`tbody tr[data-model="${id}"]`);
const group = (page: Page, provider: string) => table(page).locator(`tbody[data-group="${provider}"] tr.grp`);
const mcard = (page: Page, k: string) => page.locator(`.mstat[data-card="${k}"]`);
const drawer = (page: Page) => page.locator('dialog.mdrawer');
const exposeSwitch = (page: Page, label: string) => page.getByRole('switch', { name: `노출 — ${label}` });
const filters = (page: Page) => page.getByRole('toolbar', { name: '회사별 보기' });

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

test('mock 게이트웨이 모델이 표에 뜬다 (채팅 = 노출 · 순서, 임베딩 = 숨김) · 회사 아이콘 · 회사별 개수', async ({ page }) => {
  await page.goto('/#/models');
  await expect(table(page).getByRole('columnheader')).toHaveText(COLS);
  const rows = rowsOf(page);
  await expect(rows).toHaveCount(3);
  // 회사별 묶음 = 처음 나온 회사 순서 (사용자 앱 메뉴와 같은 규칙): OpenAI(1 · 3) → Anthropic(2)
  expect(await rows.evaluateAll((trs) => trs.map((tr) => tr.getAttribute('data-model')))).toEqual(['fake-chat-small', 'fake-embed', 'fake-chat-large']);
  await expect(table(page).locator('tr.grp')).toHaveText([/OpenAI\s*모델 2 · 노출 1/, /Anthropic\s*모델 1 · 노출 1/]);

  const small = row(page, 'fake-chat-small');
  await expect(small.locator('td.ord')).toContainText('1');
  await expect(small.locator('.ncell b')).toHaveText('fake-chat-small');
  await expect(small.locator('.ncell code')).toHaveText('fake-chat-small');
  await expect(group(page, 'openai').locator('.prov svg')).toHaveAttribute('data-provider', 'openai');
  await expect(small.locator('.src')).toHaveText('config.yaml'); // 등록한 곳 (LiteLLM /v1/model/info db_model)
  await expect(small.locator('.chip')).toHaveText('노출');
  await expect(small.locator('.dflt')).toHaveText('기본');
  await expect(exposeSwitch(page, 'fake-chat-small')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radio', { name: '기본 모델 — fake-chat-small' })).toBeChecked();
  await expect(small.locator('.ginfo')).toContainText('컨텍스트 128K · 도구 · 이미지');
  await expect(small.locator('.ginfo .price')).toHaveText('$0.15 / $0.60');

  // 순서 숫자 = 회사 묶음 안 자리 (전체 sort_order 1 · 3 · 2 가 아니라 OpenAI 1 · 2 / Anthropic 1)
  await expect(row(page, 'fake-embed').locator('td.ord .num')).toHaveText('2');
  const large = row(page, 'fake-chat-large');
  await expect(large.locator('td.ord .num')).toHaveText('1');
  await expect(group(page, 'anthropic').locator('.prov svg')).toHaveAttribute('data-provider', 'anthropic');
  await expect(large.locator('.src')).toHaveText('LiteLLM UI');
  await expect(large.locator('.chip')).toHaveText('노출');
  await expect(large.locator('.ginfo')).toContainText('생각');

  const embed = row(page, 'fake-embed');
  await expect(embed.locator('.chip')).toHaveText('숨김');
  await expect(exposeSwitch(page, 'fake-embed')).toBeDisabled(); // 대화 모델이 아니라 노출 못 함
  await expect(page.getByRole('radio', { name: '기본 모델 — fake-embed' })).toBeDisabled();
  await expect(embed.locator('.ginfo')).toContainText('임베딩 · 대화에 안 씀');

  // 요약 카드 = 노출 · 후보 · 숨김 · 문제 있음
  await expect(mcard(page, 'exposed').locator('.v')).toHaveText('2');
  await expect(mcard(page, 'candidate').locator('.v')).toHaveText('0');
  await expect(mcard(page, 'hidden').locator('.v')).toHaveText('1');
  await expect(mcard(page, 'problem').locator('.v')).toHaveText(/^\d+$/); // 앞 스펙의 대화 실패가 남아 있을 수 있다
  await expect(mcard(page, 'exposed')).toContainText('사용자 앱에 보임');
  // 회사별 = 아이콘 · 개수 · 노출 수 · 칩 순서 = 목록 묶음 순서 (OpenAI → Anthropic)
  await expect(filters(page).getByRole('button')).toHaveText(['전체 3', 'OpenAI2노출 1', 'Anthropic1노출 1']);
  await expect(filters(page).locator('svg[data-provider]')).toHaveCount(2);
  await page.screenshot({ path: shot('admin-models-live'), fullPage: true });
});

test('회사별 보기: 누르면 그 회사 모델만 · 전체로 돌아온다', async ({ page }) => {
  await page.goto('/#/models');
  const rows = rowsOf(page);
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
    await expect(mcard(page, 'exposed').locator('.v')).toHaveText('1');
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
  const ids = () => rowsOf(page).evaluateAll((trs) => trs.map((tr) => tr.getAttribute('data-model')));
  try {
    // ↑↓ = 같은 회사 안에서 옮긴다 (small ↔ embed). 회사 묶음 순서는 처음 나온 회사 순서를 따른다
    await expect(page.getByRole('button', { name: '위로 — fake-chat-small' })).toBeDisabled(); // 묶음 맨 위
    await page.getByRole('button', { name: '아래로 — fake-chat-small' }).click(); // small 3번 → large(1) 가 맨 앞 회사
    await expect.poll(ids).toEqual(['fake-chat-large', 'fake-embed', 'fake-chat-small']);
    await expect(row(page, 'fake-chat-large').locator('td.ord')).toContainText('1');
    await page.getByRole('button', { name: '위로 — fake-chat-small' }).click();
    await expect.poll(ids).toEqual(['fake-chat-large', 'fake-chat-small', 'fake-embed']);

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
  await expect(page.locator('.note')).toContainText('모델은 게이트웨이(LiteLLM)에서만 등록돼요');
  // 서버: 가격 · 회사 같은 칸은 PATCH 로 못 바꾼다 (422) · 임베딩은 노출 못 함 (409)
  const bad = await admin.raw('PATCH', '/api/admin/models/fake-chat-small', { input_cost_per_token: 0 });
  expect(bad.status).toBe(422);
  const embed = await admin.raw('PATCH', '/api/admin/models/fake-embed', { exposed: true });
  expect(embed.status).toBe(409);
});

test('conductor 가 꺼져 있으면 안내 → 다시 시도로 회복', async ({ page }) => {
  await page.route(conductorCall, conductorDown);
  await page.goto('/#/models');
  await expect(page.getByRole('alert')).toContainText('conductor 에 연결할 수 없어요');
  await expect(page.getByRole('button', { name: 'LiteLLM 에서 추가' })).toBeDisabled(); // 주소를 모르면 못 누른다
  await page.unroute(conductorCall);
  await page.getByRole('button', { name: '다시 시도' }).click();
  await expect(rowsOf(page)).toHaveCount(3);
});

test('게이트웨이가 꺼져 있으면 (conductor 503) 게이트웨이 안내', async ({ page }) => {
  await page.route(MODELS_API, (r) =>
    r.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"gateway_unreachable"}' }));
  await page.goto('/#/models');
  await expect(page.getByRole('alert')).toContainText('게이트웨이에 연결할 수 없어요');
  await expect(mcard(page, 'exposed').locator('.v')).toHaveText('—'); // 오류일 땐 0 이 아니라 —
  await expect(mcard(page, 'problem').locator('.v')).toHaveText('—');
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
  await expect(gatewayCard(page).locator('.sub')).toHaveText('LiteLLM · 모델 3개 · 회사 2곳');
  await expect(exposedCard(page).locator('.v')).toHaveText('2');
  await expect(exposedCard(page).locator('.sub')).toHaveText('후보 0 · 숨김 1');
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

test('연결 시험: 정상 · 키 없음(마지막 오류 + 고치는 곳) · 대화 실패도 그 줄에 남는다', async ({ page }) => {
  await page.goto('/#/models');
  const small = row(page, 'fake-chat-small');
  const large = row(page, 'fake-chat-large');
  await expect(small.locator('.conn')).toBeVisible();
  try {
    await page.getByRole('button', { name: '연결 시험 — fake-chat-small' }).click();
    await expect(page.getByRole('status')).toContainText(/fake-chat-small · 연결 정상 \(\d+\.\d초\)/);
    await expect(small.locator('.hl')).toHaveAttribute('data-health', 'ok');
    await expect(small.locator('.hl')).toContainText('정상 · 방금');

    // LiteLLM 에서 이 모델의 Credential 이 빠진 것 (mock: 이 모델의 모든 호출 = 401 Missing Anthropic API Key)
    await fakeCatalog({ broken: { 'fake-chat-large': '401' } });
    await page.getByRole('button', { name: '연결 시험 — fake-chat-large' }).click();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('fake-chat-large · 연결 실패: 키 없음 — LiteLLM 관리 화면 › Models › 이 모델의 Credential 키 확인');
    await expect(large.locator('.hl')).toHaveAttribute('data-health', 'error');
    await expect(large.locator('.hl')).toContainText('키 없음 · 방금');
    await expect(large.locator('.hl')).toHaveAttribute('title', /Credential 키 확인/); // 고치는 곳 = 툴팁 · 서랍 (줄은 한 줄)
    await expect(alert).not.toContainText('Missing'); // provider 문구는 conductor 로그에만
    await expect(mcard(page, 'problem').locator('.v')).toHaveText('1');
    await expect(mcard(page, 'problem').locator('.v')).toHaveClass(/bad/);
    await expect(mcard(page, 'problem').locator('.sub')).toHaveText('최근 실패 · 눌러서 보기');
    await page.screenshot({ path: shot('admin-models-health'), fullPage: true });
    // 문제 있음 카드 = 그 줄만
    await mcard(page, 'problem').click();
    await expect(mcard(page, 'problem')).toHaveAttribute('aria-pressed', 'true');
    await expect(rowsOf(page)).toHaveCount(1);
    await expect(page.getByRole('radiogroup', { name: '상태' }).getByRole('radio', { name: '문제 있음' })).toHaveAttribute('aria-checked', 'true');
    await mcard(page, 'problem').click();
    await expect(rowsOf(page)).toHaveCount(3);
    // 서랍: 고치는 곳 한 줄 + 연결 시험
    await page.getByRole('button', { name: '자세히 — fake-chat-large' }).click();
    await expect(drawer(page)).toBeVisible();
    await expect(drawer(page).locator('.hhint')).toContainText('Credential 키 확인');
    // 관리 화면에서 넣은 모델 = LiteLLM 에서 고친다 → 서랍에서 바로 간다
    await expect(drawer(page).getByRole('link', { name: 'LiteLLM 에서 고치기' })).toHaveAttribute('href', /^https?:\/\//);
    await expect(drawer(page).getByRole('link', { name: 'LiteLLM 에서 고치기' })).toHaveAttribute('target', '_blank');
    await page.keyboard.press('Escape');
    await expect(drawer(page)).toBeHidden();

    // 다시 읽어도 남는다 (SQLite model_health) — 다른 모델은 그대로 정상
    await page.reload();
    await expect(row(page, 'fake-chat-large').locator('.hl')).toHaveAttribute('data-health', 'error');
    await expect(row(page, 'fake-chat-small').locator('.hl')).toHaveAttribute('data-health', 'ok');
    // 임베딩 모델 = 대화 모델이 아니라 시험 버튼 없음
    await expect(page.getByRole('button', { name: '연결 시험 — fake-embed' })).toHaveCount(0);

    // 고치면 (Credential 다시 넣음) 다시 시험 → 정상
    await fakeCatalog({ broken: {} });
    await page.getByRole('button', { name: '연결 시험 — fake-chat-large' }).click();
    await expect(page.getByRole('status')).toContainText('fake-chat-large · 연결 정상');
    await expect(row(page, 'fake-chat-large').locator('.hl')).toHaveAttribute('data-health', 'ok');
  } finally {
    await fakeCatalog({ broken: {} });
  }
});

test('모두 시험 · 고른 줄 시험: 아직 안 써 본 키 없는 모델도 문제 있음에 잡힌다 · config.yaml 모델은 .env 키 이름으로', async ({ page }) => {
  await page.goto('/#/models');
  try {
    // config.yaml 의 OpenAI 모델 키가 빠졌다 (아무도 안 써 봤다 = 대화 실패 기록 없음)
    await fakeCatalog({ broken: { 'fake-chat-small': 'openai-missing' } });
    await page.getByRole('button', { name: '모두 시험' }).click();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('2개 시험 · 정상 1 · 실패 1: fake-chat-small (키 없음)');
    await expect(mcard(page, 'problem').locator('.v')).toHaveText('1');
    await expect(row(page, 'fake-chat-small').locator('.hl')).toHaveAttribute('data-health', 'error');
    await expect(row(page, 'fake-chat-large').locator('.hl')).toHaveAttribute('data-health', 'ok');
    // 서랍: 등록한 곳 · 회사로 고치는 곳을 좁힌다 (config.yaml + OpenAI = .env 의 OPENAI_API_KEY) · LiteLLM 화면 링크 없음
    await page.getByRole('button', { name: '자세히 — fake-chat-small' }).click();
    await expect(drawer(page).locator('.hhint')).toHaveText('config.yaml 모델 — .env 의 OPENAI_API_KEY 확인 뒤 게이트웨이 다시 켜기 (npm run gateway)');
    await expect(drawer(page).getByRole('link', { name: 'LiteLLM 에서 고치기' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // 고른 줄만 시험 (임베딩은 건너뛴다)
    await fakeCatalog({ broken: {} });
    await page.getByRole('checkbox', { name: '선택 — fake-chat-small' }).check();
    await page.getByRole('checkbox', { name: '선택 — fake-embed' }).check();
    await page.getByRole('toolbar', { name: '고른 모델' }).getByRole('button', { name: '연결 시험' }).click();
    await expect(page.getByRole('status')).toContainText('1개 시험 · 모두 정상');
    await expect(row(page, 'fake-chat-small').locator('.hl')).toHaveAttribute('data-health', 'ok');
    await expect(mcard(page, 'problem').locator('.v')).toHaveText('0');
    await expect(mcard(page, 'problem').locator('.sub')).toHaveText('최근 실패 없음');
  } finally {
    await fakeCatalog({ broken: {} });
    await admin.raw('POST', '/api/admin/models/fake-chat-small/test');
  }
});

test('검색 · 상태 필터 · 요약 카드가 같은 필터를 쓴다', async ({ page }) => {
  await page.goto('/#/models');
  const search = page.getByRole('searchbox', { name: '모델 검색' });
  await expect(search).toHaveAttribute('placeholder', '이름 · ID 로 찾기');
  await search.fill('LARGE');
  await expect(rowsOf(page)).toHaveCount(1);
  await expect(row(page, 'fake-chat-large')).toHaveCount(1);
  await search.fill('없는 모델');
  await expect(table(page)).toContainText('조건에 맞는 모델이 없어요');
  await table(page).getByRole('button', { name: '필터 지우기' }).click();
  await expect(search).toHaveValue('');
  await expect(rowsOf(page)).toHaveCount(3);
  // 상태 = 분할 버튼 (←→) · 카드와 같은 값
  const seg = page.getByRole('radiogroup', { name: '상태' });
  await seg.getByRole('radio', { name: '숨김' }).click();
  await expect(rowsOf(page)).toHaveCount(1);
  await expect(row(page, 'fake-embed')).toHaveCount(1);
  await expect(mcard(page, 'hidden')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(seg.getByRole('radio', { name: '문제 있음' })).toHaveAttribute('aria-checked', 'true');
  await mcard(page, 'exposed').click();
  await expect(seg.getByRole('radio', { name: '노출' })).toHaveAttribute('aria-checked', 'true');
  await expect(rowsOf(page)).toHaveCount(2);
  // 전체 보기가 아니면 끌기 손잡이를 숨긴다 (↑↓ 는 그대로)
  await expect(table(page).locator('.grip')).toHaveCount(0);
  await expect(row(page, 'fake-chat-small').locator('td.ord')).toHaveAttribute('title', '전체 보기에서 순서를 바꿀 수 있어요');
  await mcard(page, 'exposed').click(); // 다시 누르면 전체
  await expect(rowsOf(page)).toHaveCount(3);
  await expect(table(page).locator('.grip')).toHaveCount(3); // 게이트웨이에 있는 줄마다 (사라짐 줄 빼고)
  // 회사 묶음 접기
  await group(page, 'openai').getByRole('button').click();
  await expect(group(page, 'openai').getByRole('button')).toHaveAttribute('aria-expanded', 'false');
  await expect(rowsOf(page)).toHaveCount(1);
  await group(page, 'openai').getByRole('button').click();
  await expect(rowsOf(page)).toHaveCount(3);
});

test('서랍: 줄을 누르면 자세히 → 이름 바꾸기 · 노출 · 기본 · 순서 · 연결 시험 (게이트웨이 값은 읽기 전용)', async ({ page }) => {
  await page.goto('/#/models');
  try {
    await row(page, 'fake-chat-large').locator('td.ginfo').click(); // 줄의 빈 곳
    const d = drawer(page);
    await expect(d).toBeVisible();
    await expect(d.getByRole('heading', { level: 2 })).toHaveText('fake-chat-large');
    await expect(d).toContainText('LiteLLM 관리 화면 (DB)');
    await expect(d).toContainText('$3 / $15 (100만 토큰당 입력 / 출력)');
    await expect(d.getByRole('textbox')).toHaveCount(0); // 이름을 바꾸기 전엔 입력칸 없음 (가격 · 회사 입력칸은 없다)
    await page.screenshot({ path: shot('admin-models-drawer'), animations: 'disabled' });

    // 이름
    await d.getByRole('button', { name: '이름 바꾸기' }).click();
    const input = d.getByRole('textbox', { name: '표시 이름' });
    await input.fill('큰 모델');
    await input.press('Enter');
    await expect(d.getByRole('heading', { level: 2 })).toHaveText('큰 모델');
    await expect(d).toBeVisible(); // Enter 는 서랍을 닫지 않는다
    await expect(row(page, 'fake-chat-large').locator('.ncell b')).toHaveText('큰 모델');

    // 기본 · 순서
    await d.getByRole('button', { name: '기본 모델로 정하기' }).click();
    await expect(page.getByRole('status')).toContainText('기본 모델을 바꿨어요 · 큰 모델');
    await expect(d.getByRole('button', { name: '기본 모델이에요' })).toBeDisabled();
    expect((await userModels())[0].id).toBe('fake-chat-large');
    await expect(d.getByRole('button', { name: '위로 옮기기' })).toBeDisabled(); // Anthropic 묶음에 하나뿐

    // 연결 시험
    await d.getByRole('button', { name: '연결 시험', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('큰 모델 · 연결 정상');
    await expect(d.locator('.hl')).toHaveAttribute('data-health', 'ok');

    // 노출 끄기 = 기본도 풀린다
    const sw = d.getByRole('switch', { name: '사용자 앱에 노출' });
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    expect((await userModels()).map((m) => m.id)).toEqual(['fake-chat-small']);
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await d.getByRole('button', { name: '닫기' }).click();
    await expect(d).toBeHidden();
    await expect(page.getByRole('button', { name: '자세히 — 큰 모델' })).toBeFocused(); // 포커스는 그 줄로
  } finally {
    await patch('fake-chat-large', { display_name: null, exposed: true });
    await patch('fake-chat-small', { order: 1, is_default: true });
  }
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
    await expect(drawer(page).locator('.dwarn')).toContainText('한쪽이 숨김이라 지금은 사용자 앱에서 겹치지 않아요');
    await page.keyboard.press('Escape');
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
    await expect(filters(page)).toHaveCount(0); // 고르는 동안 필터 자리에 일괄 버튼
    await bulk.getByRole('button', { name: '숨기기' }).click();
    await expect(page.getByRole('status')).toContainText('1개 숨김 · 1개는 이미 숨김');
    await expect(exposeSwitch(page, 'fake-chat-large')).toHaveAttribute('aria-checked', 'false');
    await expect(bulk).toHaveCount(0); // 끝나면 선택이 풀린다

    await page.getByRole('checkbox', { name: '선택 — fake-chat-large' }).check();
    await page.getByRole('checkbox', { name: '선택 — fake-embed' }).check();
    await bulk.getByRole('button', { name: '노출' }).click();
    await expect(page.getByRole('status')).toContainText('1개 노출 · 1개는 대화 모델이 아니라 건너뜀');
    await expect(exposeSwitch(page, 'fake-chat-large')).toHaveAttribute('aria-checked', 'true');
    await expect(exposeSwitch(page, 'fake-embed')).toHaveAttribute('aria-checked', 'false');

    await page.getByRole('checkbox', { name: '선택 — fake-chat-small' }).check();
    await bulk.getByRole('button', { name: '선택 해제' }).click();
    await expect(bulk).toHaveCount(0);
    await expect(filters(page)).toBeVisible();
  } finally {
    await patch('fake-chat-large', { exposed: true });
  }
});

test.describe('폭 960 · 390', () => {
  for (const width of [960, 390]) {
    test(`${width}px: 가로 스크롤 없음 · 카드와 동기화 버튼이 줄을 바꾼다`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/#/models');
      await expect(rowsOf(page)).toHaveCount(3);
      await expect.poll(() => overflowX(page)).toBeLessThanOrEqual(0);
      await page.screenshot({ path: shot(`admin-models-${width}`), fullPage: true });
    });
  }
});

// ↓ 맨 끝: 게이트웨이 카탈로그를 바꾼다 (끝나면 fake-chat-late 가 '사라짐' 줄로 남는다)
test('P2-2 LiteLLM 에 모델이 추가되면 후보 · 숨김으로만 뜬다 → 노출하면 사용자 앱에 → 게이트웨이에서 빠지면 사라짐', async ({ page }) => {
  await page.goto('/#/models');
  await expect(rowsOf(page)).toHaveCount(3);
  try {
    await fakeCatalog({ late: true }); // LiteLLM Admin UI 에서 gemini 모델을 하나 추가한 것
    await page.getByRole('button', { name: '동기화' }).click();
    await expect(page.getByRole('status')).toContainText('새 모델 1개 (후보 · 숨김)');
    const late = row(page, 'fake-chat-late');
    await expect(late.locator('.chip')).toHaveText('후보');
    await expect(group(page, 'google')).toContainText('Google');
    await expect(group(page, 'google').locator('.prov svg')).toHaveAttribute('data-provider', 'google');
    await expect(exposeSwitch(page, 'fake-chat-late')).toHaveAttribute('aria-checked', 'false'); // 기본 숨김
    await expect(mcard(page, 'candidate').locator('.v')).toHaveText('1');
    await expect(mcard(page, 'candidate').locator('.v')).toHaveClass(/info/);
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
    await expect(mcard(page, 'hidden')).toContainText('사라짐 1');
  } finally {
    await fakeCatalog({ reset: true });
  }
});
