import { test, expect, type Page } from '@playwright/test';
import { adminApi, userApi, type Client } from './auth';
import { overflowX, pickOption, shot } from './helpers';

// 관리자 '사용량' (usage_events · 숫자만 · 비용 분해) + 개요(작은 흐름 · 단위별 추이 + 그 단위 Top 5 → 상세보기) + 모델 자세히의 사용량 칸 + 사용자/조직/스페이스 서랍의 사용량 칸.
// 캐시 토큰 = mock 게이트웨이: Anthropic(큰 모델) = 입력의 절반 읽기 + 4분의 1 쓰기 · OpenAI(작은 모델) = 30% 읽기 (e2e/mock/gateway.mjs)
// 씨앗 = 이 스펙만의 조직 하나 (첫 관리자가 owner) · 그 조직의 공유 스페이스 하나 · 그 스페이스에서 대화 셋 (작은 모델 성공 1 · 실패 1 · 큰 모델 성공 1).
// 같은 conductor 를 다른 스펙도 쓰므로 합계는 '이 조직으로 거른 값'만 정확히 본다 (전체 합계는 이상 · 이하로만)
// 둘째 조직(ORG_B) = 생각 · 어림 씨앗: 큰 모델 [fake:think] (생각 토큰 · 생각 비용) + 작은 모델 [fake:cache-write] (쓰기 가격 모름 = 어림). 첫 조직 숫자는 그대로
const STAMP = Date.now().toString(36);
const ORG = `사용량 조직 ${STAMP}`;
const SPACE = `사용량 스페이스 ${STAMP}`;
const ORG_B = `생각 조직 ${STAMP}`; // 첫 조직 · 스페이스 이름을 앞에 품지 않게 (글자로 거르는 단언이 둘을 잡지 않게)
const SECRET = `비밀 질문 ${STAMP}`; // 관리자 화면 어디에도 나오면 안 된다 (대화 내용 0)

let admin: Client;
let orgId = '';
let spaceId = '';
let orgB = '';
let spaceB = '';
let meId = '';

async function chat(api: Client, text: string, model: string, n: number, space = spaceId) {
  const body = {
    threadId: `usage-${STAMP}-${n}`, runId: `usage-${STAMP}-r${n}`, state: {}, tools: [], context: [],
    messages: [{ id: `m-${n}`, role: 'user', content: text }], forwardedProps: { model, spaceId: space },
  };
  const res = await api.raw('POST', '/api/chat', body);
  expect(res.status).toBe(200);
  return res.text();
}

test.beforeAll(async () => {
  admin = await adminApi();
  orgId = (await admin.post<{ id: string }>('/api/admin/orgs', { name: ORG })).id; // 만든 관리자 = owner
  const me = await userApi();
  meId = me.me.id;
  spaceId = (await me.post<{ id: string }>('/api/spaces', { name: SPACE, visibility: 'private', org_id: orgId })).id;
  await chat(me, SECRET, 'fake-chat-small', 1);
  expect(await chat(me, '[fake:500] 실패', 'fake-chat-small', 2)).toContain('RUN_ERROR');
  await chat(me, '[fake:skill summarize] 요약해 줘', 'fake-chat-large', 3); // 툴 호출 1번 (내장 계산기는 없어졌다 = 스킬)
  orgB = (await admin.post<{ id: string }>('/api/admin/orgs', { name: ORG_B })).id;
  spaceB = (await me.post<{ id: string }>('/api/spaces', { name: `생각 스페이스 ${STAMP}`, visibility: 'private', org_id: orgB })).id;
  await chat(me, '[fake:think] 생각해서 답', 'fake-chat-large', 4, spaceB);
  await chat(me, '[fake:cache-write] 캐시 쓰기', 'fake-chat-small', 5, spaceB);
});

const kpi = (page: Page, key: string) => page.locator(`[data-kpi="${key}"] .ui-stat-value`);
const num = async (page: Page, key: string) => Number((await kpi(page, key).textContent())!.replace(/[^\d.]/g, ''));
const noSecret = async (page: Page) => expect(await page.locator('body').innerText()).not.toContain(SECRET);
const pct = (r: number) => `${Math.round(r * 1000) / 10}%`; // 화면 percent() 와 같은 글
const ko = (n: number) => new Intl.NumberFormat('ko-KR').format(n);
const KINDS = ['input', 'output', 'reasoning', 'cache_read', 'cache_write'] as const;
type Totals = { runs: number; tokens: number; cost_usd: number; cache_read_tokens: number; cache_write_tokens: number; input_tokens: number; cache_hit_rate: number;
  tokens_by_kind: Record<(typeof KINDS)[number], number>; cost_by_kind: Record<(typeof KINDS)[number], number> };

test('API: 조직으로 거른 합계 · 묶음 · 비용 · 대화 내용 없음', async () => {
  const q = `org=${orgId}&tz=0`;
  const u = await admin.get(`/api/admin/usage?${q}`);
  expect(u.totals).toMatchObject({ runs: 3, ok: 2, errors: 1, active_users: 1 });
  expect(u.totals.tokens).toBeGreaterThan(0);
  expect(u.totals.cost_usd).toBeGreaterThan(0); // mock 게이트웨이 가격 × 토큰
  expect(u.totals.cost_runs).toBe(2);
  expect(u.totals.tool_calls).toBeGreaterThanOrEqual(1); // [fake:skill summarize]
  const models = await admin.get(`/api/admin/usage?${q}&group=model`);
  expect(models.groups.map((g: { key: string; runs: number }) => [g.key, g.runs])).toEqual([['fake-chat-small', 2], ['fake-chat-large', 1]]);
  const spaces = await admin.get(`/api/admin/usage?${q}&group=space`);
  expect(spaces.groups.map((g: { label: string; runs: number }) => [g.label, g.runs])).toEqual([[SPACE, 3]]);
  const users = await admin.get(`/api/admin/usage?${q}&group=user`);
  expect(users.groups.map((g: { key: string }) => g.key)).toEqual([meId]);
  // 캐시 토큰 · 종류별 (겹치지 않게 나눈 합 = 토큰 · 비용)
  const t: Totals = u.totals;
  expect(t.cache_read_tokens).toBeGreaterThan(0); // 두 모델 다 캐시 읽기
  expect(t.cache_write_tokens).toBeGreaterThan(0); // 큰 모델(Anthropic)만 캐시 쓰기
  expect(KINDS.reduce((n, k) => n + t.tokens_by_kind[k], 0)).toBe(t.tokens);
  expect(Math.abs(KINDS.reduce((n, k) => n + t.cost_by_kind[k], 0) - t.cost_usd)).toBeLessThan(1e-6);
  expect(t.cache_hit_rate).toBeCloseTo(t.cache_read_tokens / t.input_tokens, 3);
  expect(t.cost_by_kind.cache_write).toBeGreaterThan(0); // mock 큰 모델 쓰기 가격 3.75e-6
  // 비용 순 묶음
  const byCost = await admin.get(`/api/admin/usage?${q}&group=model&sort=cost`);
  expect(byCost.groups.map((g: { key: string }) => g.key)).toEqual(['fake-chat-large', 'fake-chat-small']);
  const raw = await (await admin.raw('GET', `/api/admin/usage?group=user`)).text();
  expect(raw).not.toContain(SECRET);
  // 사용자 표면(Bearer)으로는 못 읽는다
  expect((await (await userApi()).raw('GET', '/api/admin/usage')).status).toBe(401);
});

test('API: 생각 토큰 · 생각 비용 · 캐시 가격 모름 = 어림 · 자른 나머지(others)의 호출 · 비용', async () => {
  const b = await admin.get(`/api/admin/usage?org=${orgB}&tz=0`);
  expect(b.totals).toMatchObject({ runs: 2, ok: 2, errors: 0 });
  const t: Totals & { reasoning_tokens: number; cost_estimated_runs: number } = b.totals;
  // 생각 = 출력 안에 들어 있다 → 종류별은 겹치지 않게 (생각 뺀 출력 + 생각 = 출력) · 생각 비용 = 출력 가격
  expect(t.reasoning_tokens).toBeGreaterThan(0);
  expect(t.tokens_by_kind.reasoning).toBe(t.reasoning_tokens);
  expect(t.cost_by_kind.reasoning).toBeGreaterThan(0);
  expect(KINDS.reduce((n, k) => n + t.tokens_by_kind[k], 0)).toBe(t.tokens);
  // 작은 모델 = 캐시 쓰기 가격이 없다 → 입력 가격으로 어림한 호출 1
  expect(t.cost_estimated_runs).toBe(1);
  const small = await admin.get(`/api/admin/usage?org=${orgB}&model=fake-chat-small&tz=0`);
  expect(small.totals.cache_write_tokens).toBeGreaterThan(0);
  expect(small.totals.cost_estimated_runs).toBe(1);
  // limit 1 = 한 줄 + 나머지 (이 스펙만 조직이 둘 → 하나는 나머지로) · 줄 + 나머지 = 합계
  const all = await admin.get('/api/admin/usage?tz=0&days=30');
  const one = await admin.get('/api/admin/usage?group=org&limit=1&tz=0&days=30');
  expect(one.groups).toHaveLength(1);
  expect(one.others.count).toBeGreaterThanOrEqual(1);
  expect(one.groups[0].runs + one.others.runs).toBe(all.totals.runs);
  expect(one.others.cost_usd).toBeGreaterThan(0);
});

test('개요: 숫자 카드(줄인 값 = 마우스로 실제 값) · 작은 호출과 비용 흐름 · 단위별 추이(단위 탭 · 기준 탭 · 선 = 다섯 + 그 밖) + 그 단위 Top 5 → 상세보기 · 비용 분해는 사용량에 · 기간 30일 · 대화 내용 없음', async ({ page }) => {
  await page.goto('/#/overview');
  await expect(kpi(page, 'runs')).toBeVisible();
  expect(await num(page, 'runs')).toBeGreaterThanOrEqual(3);
  for (const k of ['tokens', 'cost', 'users', 'errors']) await expect(kpi(page, k)).toBeVisible();
  // 흐름 = 카드 하나에 작은 차트 둘 (호출 · 추정 비용 = 척도가 달라 축 하나씩). 예전 큰 차트 둘은 없다
  const trend = page.getByRole('region', { name: '호출과 비용 추이' });
  await expect(trend.locator('.ui-chart-plot svg')).toHaveCount(2);
  await expect(page.getByRole('region', { name: '호출 추이' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '토큰 추이' })).toHaveCount(0);
  expect(Number(await trend.locator('.ui-chart-plot svg').first().getAttribute('height'))).toBeLessThanOrEqual(140);
  // 차트 = 표 보기 (같은 값)
  const runsChart = trend.locator('figure').first();
  await runsChart.getByRole('button', { name: '표로 보기' }).click();
  await expect(runsChart.getByRole('table')).toBeVisible();
  await expect(runsChart.getByRole('table').getByRole('row')).toHaveCount(8); // 머리 + 7일
  await runsChart.getByRole('button', { name: '차트로 보기' }).click();
  await expect.poll(async () => Number(await runsChart.locator('.ui-chart-plot svg').getAttribute('width'))).toBeGreaterThan(100);
  await runsChart.getByRole('group').focus();
  await expect(runsChart.locator('[aria-live]')).toContainText('호출');

  // 줄인 토큰(34.1만) = 마우스를 올리면 실제 값 (글자 안에는 안 들어간다 = data-exact)
  await expect(kpi(page, 'tokens')).toHaveAttribute('data-exact', /^[\d,]+ 토큰 \(입력 [\d,]+, 출력 [\d,]+\)$/);
  await expect(kpi(page, 'cost')).toHaveAttribute('data-exact', /^추정 \$[\d.]+$/);
  // 비용 분해는 개요에서 빠지고 사용량 메뉴에
  await expect(page.getByRole('region', { name: '비용 분해' })).toHaveCount(0);

  // 단위별 추이 = 단위 탭(모델 기본) · 기준 탭(호출 기본) · 선 = 다섯 이하 + 그 밖 · 아래 = 그 단위 Top 5 표
  const unit = page.getByRole('region', { name: '단위별 추이' });
  const units = unit.getByRole('radiogroup', { name: '단위' });
  await expect(units.getByRole('radio')).toHaveText(['모델', '조직', '사용자', '스페이스']);
  await expect(units.getByRole('radio', { name: '모델' })).toBeChecked();
  await expect(unit.getByRole('radiogroup', { name: '기준' }).getByRole('radio')).toHaveText(['호출', '토큰', '비용']);
  const lines = unit.locator('.ui-chart-plot .ui-chart-line');
  await expect.poll(() => lines.count()).toBeGreaterThanOrEqual(2); // fake-chat-small · fake-chat-large
  expect(await lines.count()).toBeLessThanOrEqual(6);
  await expect(unit.getByRole('list', { name: '범례' })).toContainText('fake-chat-small');
  // 표 보기 = 같은 값 (날짜 7 + 머리 · 모델마다 한 열)
  await unit.getByRole('button', { name: '표로 보기' }).click();
  await expect(unit.locator('figure').getByRole('table').getByRole('row')).toHaveCount(8);
  await unit.getByRole('button', { name: '차트로 보기' }).click();
  for (const [tab, name, href] of [['모델', '모델 Top 5', '#/usage?days=7&group=model'], ['조직', '조직 Top 5', '#/usage?days=7'],
    ['사용자', '사용자 Top 5', '#/usage?days=7&group=user'], ['스페이스', '스페이스 Top 5', '#/usage?days=7&group=space']] as const) {
    await units.getByRole('radio', { name: tab }).click();
    const table = unit.getByRole('table', { name });
    await expect(table).toBeVisible();
    expect(await table.locator('tbody tr').count()).toBeLessThanOrEqual(5);
    await expect(table.getByRole('columnheader')).toHaveText(['이름', '호출', '토큰', '추정 비용']);
    await expect(table.locator('tbody td').nth(1).locator('[title]')).toHaveAttribute('title', /^[\d,]+$/); // 토큰 칸 = 실제 값 풍선
    await expect(unit.getByRole('link', { name: '상세보기' })).toHaveAttribute('href', href);
  }
  await units.getByRole('radio', { name: '스페이스' }).click();
  await expect(unit.getByRole('table', { name: '스페이스 Top 5' }).getByRole('link').filter({ hasText: SPACE })).toHaveAttribute('href', `#/usage?days=7&group=user&space=${spaceId}`);
  await units.getByRole('radio', { name: '모델' }).click();
  await expect(unit.getByRole('table', { name: '모델 Top 5' }).getByRole('link').filter({ hasText: 'fake-chat-small' })).toHaveAttribute('href', '#/models/fake-chat-small');
  // 기준 = 비용 → 상세보기도 비용 · 차트 풍선 = 실제 값 ($)
  await unit.getByRole('radiogroup', { name: '기준' }).getByRole('radio', { name: '비용' }).click();
  await expect(unit).toHaveAttribute('data-metric', 'cost');
  await expect(unit.getByRole('link', { name: '상세보기' })).toHaveAttribute('href', '#/usage?days=7&group=model&metric=cost');
  await unit.locator('.ui-chart-plot').focus();
  await expect(unit.locator('.ui-chart-plot [aria-live]')).toContainText('$');
  await unit.getByRole('radiogroup', { name: '기준' }).getByRole('radio', { name: '호출' }).click();
  await noSecret(page);
  expect(await overflowX(page)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: shot('admin-overview-usage'), fullPage: true });

  // 상세보기 → 사용량이 그 묶음으로 열린다 (사용자) · 비용 분해 = 사용량 메뉴에 (토큰 종류 다섯 + 모델별 비용)
  await units.getByRole('radio', { name: '사용자' }).click();
  await unit.getByRole('link', { name: '상세보기' }).click();
  await expect(page).toHaveURL(/#\/usage\?days=7&group=user$/);
  await expect(page.getByRole('radiogroup', { name: '묶음' }).getByRole('radio', { name: '사용자' })).toBeChecked();
  await expect(page.getByRole('radiogroup', { name: '기간' }).getByRole('radio', { name: '7일' })).toBeChecked();
  await expect(page.getByRole('table', { name: '사용자별 사용량 표' }).getByRole('row').filter({ hasText: 'e2e-admin@brewai.test' })).toBeVisible();
  // 종류 이름 = 숫자 카드의 '입력'(캐시 포함) · '출력'(생각 포함)과 다른 이름 (같은 화면에서 두 값이 한 이름으로 읽히지 않게)
  const cost = page.getByRole('region', { name: '비용 분해' });
  await expect(cost.getByRole('list', { name: '토큰 종류별', exact: true }).getByRole('listitem')).toHaveText([/^캐시 아닌 입력/, /^생각 뺀 출력/, /^생각/, /^캐시 읽기/, /^캐시 쓰기/]);
  await expect(cost).toContainText('어림한 호출'); // 작은 모델 캐시 쓰기 = 가격 모름
  expect(await cost.getByRole('list', { name: '모델별', exact: true }).getByRole('listitem').count()).toBeLessThanOrEqual(5);
  await expect(cost.getByRole('list', { name: '모델별', exact: true }).getByRole('link').filter({ hasText: 'fake-chat-large' })).toHaveAttribute('href', '#/models/fake-chat-large');
  await page.screenshot({ path: shot('admin-usage-cost'), fullPage: true });

  // 조직 줄 → 사용량 (그 조직 · 스페이스 묶음)
  await page.goto('/#/overview');
  await page.getByRole('region', { name: '단위별 추이' }).getByRole('radiogroup', { name: '단위' }).getByRole('radio', { name: '조직' }).click();
  await page.getByRole('table', { name: '조직 Top 5' }).getByRole('link').filter({ hasText: ORG }).click();
  await expect(page).toHaveURL(new RegExp(`#/usage\\?days=7&group=space&org=${orgId}$`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(['사용량']);
  await expect(kpi(page, 'runs')).toHaveText('3');
  await expect(page.getByRole('table', { name: '스페이스별 사용량 표' }).getByRole('row').filter({ hasText: SPACE })).toContainText('3');

  // 기간 30일 = 주소에 · 상세보기도 30일 (기본값이라 주소에서 빠진다)
  await page.goto('/#/overview');
  await page.getByRole('radiogroup', { name: '기간' }).getByRole('radio', { name: '30일' }).click();
  await expect(page).toHaveURL(/#\/overview\?days=30$/);
  await expect(page.getByRole('region', { name: '호출과 비용 추이' }).locator('figure').first().getByRole('table').getByRole('row')).toHaveCount(31);
  await expect(page.getByRole('region', { name: '단위별 추이' }).getByRole('link', { name: '상세보기' })).toHaveAttribute('href', '#/usage?group=model');
  await expect(page.getByRole('region', { name: '단위별 추이' }).locator('figure').getByRole('table').getByRole('row')).toHaveCount(31);
});

test('개요: 사람 수 · 바로 가기 = 그 메뉴로 (아직 없는 기능은 이동만)', async ({ page }) => {
  await page.goto('/#/overview');
  const people = page.getByRole('region', { name: '사용자와 조직' });
  await expect(people.locator('[data-count="orgs"] b')).toHaveText(/\d+개/);
  await people.locator('[data-count="orgs"] a').click();
  await expect(page).toHaveURL(/#\/users\/orgs$/);
  await page.goto('/#/overview');
  await page.getByRole('region', { name: '사용자와 조직' }).locator('[data-count="spaces"] a').click();
  await expect(page).toHaveURL(/#\/users\/spaces$/);
  for (const [name, hash] of [['승인 기록', 'approvals'], ['트레이스', 'traces'], ['카탈로그', 'catalog'], ['설정', 'settings']]) {
    await page.goto('/#/overview');
    await page.getByRole('region', { name: '바로 가기' }).getByRole('link', { name: new RegExp(`^${name}`) }).click();
    await expect(page).toHaveURL(new RegExp(`#/${hash}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText([name]);
  }
  // 개발 진행(보드 · 다음에 채울 것)은 개요에 없다 = 문서 메뉴에만
  await page.goto('/#/overview');
  await expect(page.getByText('다음에 채울 것')).toHaveCount(0);
  await expect(page.locator('a[href="#/docs/board"]')).toHaveCount(0);
  await expect(page.getByRole('region', { name: '바로 가기' }).locator('a[href^="#/docs"]')).toHaveCount(0);
});

test('개요: 사용 기록이 없으면 빈 안내 (게이트웨이 · 사람 수는 그대로)', async ({ page }) => {
  const zero = { runs: 0, ok: 0, errors: 0, cancelled: 0, error_rate: 0, input_tokens: 0, output_tokens: 0, tokens: 0, reasoning_tokens: 0, requests: 0, tool_calls: 0, cost_usd: null, cost_runs: 0, active_users: 0, avg_duration_ms: null };
  await page.route((url) => url.pathname === '/api/admin/usage', (r) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ from: '2026-10-26', to: '2026-11-01', tz: 0, days: 7, group: 'day', totals: zero, previous: zero,
      series: Array.from({ length: 7 }, (_, i) => ({ ...zero, date: `2026-10-${26 + i}` })), groups: [], others: null }),
  }));
  await page.goto('/#/overview');
  await expect(page.getByText('아직 사용 기록이 없어요')).toBeVisible();
  await expect(page.getByRole('region', { name: '호출과 비용 추이' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '단위별 추이' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '비용 분해' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '게이트웨이', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '사용자와 조직' })).toBeVisible();
  await page.screenshot({ path: shot('admin-overview-empty'), fullPage: true });
});

test('사용량 메뉴: 묶음 바꾸기 · 거르개(공용 고르기 상자) · 줄을 누르면 한 칸 아래로 · 주소로 바로 열기', async ({ page }) => {
  await page.goto(`/#/usage?org=${orgId}`);
  await expect(kpi(page, 'runs')).toHaveText('3');
  await expect(kpi(page, 'errors')).toHaveText('33.3%');
  const table = (g: string) => page.getByRole('table', { name: `${g}별 사용량 표` });
  await expect(table('조직').getByRole('row').filter({ hasText: ORG })).toContainText('3');
  // 묶음 = 모델
  await page.getByRole('radiogroup', { name: '묶음' }).getByRole('radio', { name: '모델' }).click();
  await expect(page).toHaveURL(/group=model/);
  await expect(table('모델').locator('tbody tr')).toHaveCount(2);
  // 거르개: 모델 = 큰 모델 → 1
  await pickOption(page.getByRole('combobox', { name: '모델 거르기' }), { value: 'fake-chat-large' });
  await expect(page).toHaveURL(/model=fake-chat-large/);
  await expect(kpi(page, 'runs')).toHaveText('1');
  await page.getByRole('button', { name: '거르개 지우기' }).click();
  await expect(page).not.toHaveURL(/org=|model=/);
  await expect.poll(() => num(page, 'runs')).toBeGreaterThanOrEqual(3); // 새 값이 올 때까지 앞 값을 흐리게 들고 있다
  // 조직 줄 → 그 조직의 스페이스 → 그 스페이스의 사용자
  await page.goto(`/#/usage?org=${orgId}`);
  await table('조직').getByRole('row').filter({ hasText: ORG }).getByRole('button').click();
  await expect(page).toHaveURL(new RegExp(`group=space&org=${orgId}`));
  await table('스페이스').getByRole('row').filter({ hasText: SPACE }).getByRole('button').click();
  await expect(page).toHaveURL(new RegExp(`group=user&org=${orgId}&space=${spaceId}`));
  await expect(table('사용자').locator('tbody tr')).toHaveCount(1);
  await expect(page.getByText('숫자만 보여요. 질문과 답')).toBeVisible();
  await noSecret(page);
  expect(await overflowX(page)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: shot('admin-usage'), fullPage: true });
});

test('사용량 메뉴: 주소로 묶음 · 기준 · 기간 · 거르개 · 전체 표 (캐시 칸 · 비용 풍선 · 머리 정렬)', async ({ page }) => {
  await page.goto(`/#/usage?days=7&group=model&metric=cost&org=${orgId}`);
  await expect(kpi(page, 'runs')).toHaveText('3');
  await expect(page.getByRole('radiogroup', { name: '묶음' }).getByRole('radio', { name: '모델' })).toBeChecked();
  await expect(page.getByRole('radiogroup', { name: '기준' }).getByRole('radio', { name: '비용' })).toBeChecked();
  await expect(page.getByRole('radiogroup', { name: '기간' }).getByRole('radio', { name: '7일' })).toBeChecked();
  await expect(page.getByRole('region', { name: '비용 추이' })).toBeVisible();
  const table = page.getByRole('table', { name: '모델별 사용량 표' });
  await expect(table.getByRole('columnheader')).toContainText(['이름', '호출', '실패율', '토큰', '캐시 읽기', '캐시 쓰기', '도구 호출', '추정 비용', '비용 비율']);
  // 기준 = 비용 → 비용 큰 순 (큰 모델이 비싸다) · 막대도 비용
  await expect(table.locator('tbody tr').first()).toContainText('fake-chat-large');
  await expect(page.getByRole('list', { name: '모델별 사용량' }).getByRole('listitem').first()).toContainText('$');
  // 비용 칸 풍선 = 종류별 비용 (큰 모델 = 캐시 쓰기 있음)
  const api = await admin.get(`/api/admin/usage?org=${orgId}&group=model&model=fake-chat-large`);
  expect(api.groups[0].cache_write_tokens).toBeGreaterThan(0);
  await expect(table.locator('tbody tr').first().locator('.us-cost')).toHaveAttribute('title', /캐시 쓰기 \$/);
  // 머리 정렬: 호출 오름차순 → 작은 모델(1 성공 + 1 실패 = 2회)이 아래로 가지 않고 큰 모델(1회)이 위
  await table.getByRole('button', { name: '호출', exact: true }).click();
  await expect(table.locator('tbody tr').first()).toContainText('fake-chat-large');
  await table.getByRole('button', { name: /^호출/ }).click(); // 내림차순
  await expect(table.locator('tbody tr').first()).toContainText('fake-chat-small');
  // 기준 바꾸기 = 주소에 (호출 = 기본이라 빠진다)
  await page.getByRole('radiogroup', { name: '기준' }).getByRole('radio', { name: '토큰' }).click();
  await expect(page).toHaveURL(/metric=tokens/);
  await expect(page.getByRole('region', { name: '토큰 추이' })).toBeVisible();
  await page.getByRole('radiogroup', { name: '기준' }).getByRole('radio', { name: '호출' }).click();
  await expect(page).not.toHaveURL(/metric=/);
  await noSecret(page);
  await page.screenshot({ path: shot('admin-usage-model-cost'), fullPage: true });
});

// 이 브라우저의 기간 (화면 windowOf 와 같은 계산)
const windowIn = (page: Page, days: number) => page.evaluate((d) => {
  const ymd = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - (d - 1));
  return `from=${ymd(start)}&to=${ymd(now)}&tz=${-now.getTimezoneOffset()}`;
}, days);

test('모델 자세히 › 사용량: 숫자 = API · 캐시 적중률 · 종류별 토큰과 비용 · Top 5 조직과 사용자 → 이 모델로 거른 사용량', async ({ page }) => {
  await page.goto('/#/models/fake-chat-large');
  const sec = page.getByRole('region', { name: '사용량', exact: true });
  await expect(sec.getByRole('radiogroup', { name: '기간' }).getByRole('radio', { name: '30일' })).toBeChecked();
  const res = await page.request.get(`/api/admin/usage?group=org&model=fake-chat-large&limit=5&${await windowIn(page, 30)}`);
  expect(res.status()).toBe(200);
  const t: Totals = (await res.json()).totals;
  expect(t.runs).toBeGreaterThanOrEqual(1);
  const tile = (k: string) => sec.locator(`[data-kpi="model-${k}"] .ui-stat-value`);
  await expect(tile('runs')).toHaveText(ko(t.runs));
  await expect(tile('cache')).toHaveText(pct(t.cache_hit_rate));
  expect(t.cache_hit_rate).toBeCloseTo(t.cache_read_tokens / t.input_tokens, 3);
  expect(t.cache_hit_rate).toBeGreaterThan(0.4); // mock: 큰 모델 = 입력의 절반을 캐시에서
  // 종류별 표 = 토큰 · 비율 · 비용 (합계 줄 = 토큰 합 · 추정 비용)
  const kinds = sec.getByRole('table', { name: '종류별 토큰과 비용' });
  await expect(kinds.locator('tbody th')).toHaveText(['캐시 아닌 입력', '생각 뺀 출력', '생각', '캐시 읽기', '캐시 쓰기', '합계']);
  expect(t.tokens_by_kind.reasoning).toBeGreaterThan(0); // ORG_B 의 [fake:think]
  await expect(kinds.locator('tr[data-kind="reasoning"] td').first()).toHaveText(ko(t.tokens_by_kind.reasoning));
  await expect(kinds.locator('tr[data-kind="cache_read"] td').first()).toHaveText(ko(t.tokens_by_kind.cache_read));
  await expect(kinds.locator('tr[data-kind="cache_write"] td').first()).toHaveText(ko(t.tokens_by_kind.cache_write));
  await expect(kinds.locator('tr[data-kind="total"] td').first()).toHaveText(ko(t.tokens));
  expect(t.tokens_by_kind.cache_write).toBeGreaterThan(0);
  // 흐름 둘 (호출 · 비용) · Top 5 조직과 사용자
  await expect(sec.locator('.ui-chart-plot svg')).toHaveCount(2);
  const orgs = sec.getByRole('region', { name: '이 모델을 많이 쓴 조직' });
  await expect(orgs.getByRole('link').filter({ hasText: ORG })).toHaveAttribute('href', `#/usage?group=user&org=${orgId}&model=fake-chat-large`);
  const users = sec.getByRole('region', { name: '이 모델을 많이 쓴 사용자' });
  await expect(users.getByRole('link', { name: '상세보기' })).toHaveAttribute('href', '#/usage?group=user&model=fake-chat-large');
  // 사용자 줄 = 한 칸 아래 (그 사람이 이 모델을 쓴 스페이스) · 조직 한 줄짜리가 아니다
  await expect(users.locator('tbody a').filter({ hasText: 'e2e-admin@brewai.test' })).toHaveAttribute('href', `#/usage?group=space&user=${meId}&model=fake-chat-large`);
  await noSecret(page);
  await page.screenshot({ path: shot('admin-models-usage'), fullPage: true });
  // 상세보기 → 사용량 (이 모델로 거른 조직별) = 같은 호출 수
  await orgs.getByRole('link', { name: '상세보기' }).click();
  await expect(page).toHaveURL(/#\/usage\?model=fake-chat-large$/);
  await expect(kpi(page, 'runs')).toHaveText(ko(t.runs));
  // 기간 바꾸기 = 칸 안에서만 (주소 그대로)
  await page.goto('/#/models/fake-chat-large');
  await page.getByRole('region', { name: '사용량', exact: true }).getByRole('radiogroup', { name: '기간' }).getByRole('radio', { name: '7일' }).click();
  await expect(page).toHaveURL(/#\/models\/fake-chat-large$/);
  await expect(page.getByRole('region', { name: '사용량', exact: true }).getByRole('link', { name: '사용량에서 보기' }))
    .toHaveAttribute('href', '#/usage?days=7&metric=cost&model=fake-chat-large');
  // 작은 모델 = 캐시 쓰기 가격 모름 (ORG_B [fake:cache-write]) → 비용 카드 · 종류 표 아래에 '어림'
  await page.goto('/#/models/fake-chat-small');
  const small = page.getByRole('region', { name: '사용량', exact: true });
  await expect(small.locator('[data-kpi="model-cost"]')).toContainText('어림');
  await expect(small).toContainText('어림한 호출');
});

test('서랍 사용량 칸: 조직 · 스페이스 = 이 스펙의 3회 · 사용자 = 칸 + 사용량 메뉴 링크', async ({ page }) => {
  await page.goto('/#/users/orgs');
  await page.getByRole('table', { name: '조직 목록' }).getByRole('row').filter({ hasText: ORG }).getByRole('button').first().click();
  const orgSheet = page.getByRole('dialog', { name: ORG });
  await expect(orgSheet.getByRole('heading', { name: '사용량', exact: true })).toBeVisible();
  await expect(orgSheet.locator('.us-section-meta')).toContainText('호출 3');
  await expect(orgSheet.getByRole('list', { name: '많이 쓴 모델' }).getByRole('listitem')).toHaveCount(2);
  await expect(orgSheet.getByRole('link', { name: '사용량에서 보기' })).toHaveAttribute('href', `#/usage?group=space&org=${orgId}`);
  await page.screenshot({ path: shot('admin-usage-org-sheet') });
  await page.keyboard.press('Escape');

  await page.goto('/#/users/spaces');
  await page.getByRole('table', { name: '공유 스페이스 목록' }).getByRole('row').filter({ hasText: SPACE }).getByRole('button').first().click();
  const spaceSheet = page.getByRole('dialog', { name: SPACE });
  await expect(spaceSheet.locator('.us-section-meta')).toContainText('호출 3');
  await spaceSheet.getByRole('link', { name: '사용량에서 보기' }).click();
  await expect(page).toHaveURL(new RegExp(`#/usage\\?group=user&space=${spaceId}$`));
  await expect(kpi(page, 'runs')).toHaveText('3');

  await page.goto('/#/users');
  await page.getByRole('table', { name: '사용자 목록' }).getByRole('row').filter({ hasText: 'e2e-admin@brewai.test' }).getByRole('button').first().click();
  const userSheet = page.getByRole('dialog').filter({ hasText: 'e2e-admin@brewai.test' });
  await expect(userSheet.getByRole('heading', { name: '사용량', exact: true })).toBeVisible();
  await expect(userSheet.locator('.us-section-meta')).toContainText('호출');
  await expect(userSheet.getByRole('link', { name: '사용량에서 보기' })).toHaveAttribute('href', `#/usage?group=model&user=${meId}`);
  await noSecret(page);
  await page.screenshot({ path: shot('admin-usage-user-sheet') });
});
