import { test, expect, type Page } from '@playwright/test';
import { adminApi, userApi, type Client } from './auth';
import { overflowX, pickOption, shot } from './helpers';

// 관리자 '사용량' (usage_events · 숫자만) + 개요 그래프 + 사용자/조직/스페이스 서랍의 사용량 칸.
// 씨앗 = 이 스펙만의 조직 하나 (첫 관리자가 owner) · 그 조직의 공유 스페이스 하나 · 그 스페이스에서 대화 셋 (작은 모델 성공 1 · 실패 1 · 큰 모델 성공 1).
// 같은 conductor 를 다른 스펙도 쓰므로 합계는 '이 조직으로 거른 값'만 정확히 본다 (전체 합계는 이상 · 이하로만)
const STAMP = Date.now().toString(36);
const ORG = `사용량 조직 ${STAMP}`;
const SPACE = `사용량 스페이스 ${STAMP}`;
const SECRET = `비밀 질문 ${STAMP}`; // 관리자 화면 어디에도 나오면 안 된다 (대화 내용 0)

let admin: Client;
let orgId = '';
let spaceId = '';
let meId = '';

async function chat(api: Client, text: string, model: string, n: number) {
  const body = {
    threadId: `usage-${STAMP}-${n}`, runId: `usage-${STAMP}-r${n}`, state: {}, tools: [], context: [],
    messages: [{ id: `m-${n}`, role: 'user', content: text }], forwardedProps: { model, spaceId },
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
  await chat(me, '[fake:calc] 6*7', 'fake-chat-large', 3);
});

const kpi = (page: Page, key: string) => page.locator(`[data-kpi="${key}"] .ui-stat-value`);
const num = async (page: Page, key: string) => Number((await kpi(page, key).textContent())!.replace(/[^\d.]/g, ''));
const noSecret = async (page: Page) => expect(await page.locator('body').innerText()).not.toContain(SECRET);

test('API: 조직으로 거른 합계 · 묶음 · 비용 · 대화 내용 없음', async () => {
  const q = `org=${orgId}&tz=0`;
  const u = await admin.get(`/api/admin/usage?${q}`);
  expect(u.totals).toMatchObject({ runs: 3, ok: 2, errors: 1, active_users: 1 });
  expect(u.totals.tokens).toBeGreaterThan(0);
  expect(u.totals.cost_usd).toBeGreaterThan(0); // mock 게이트웨이 가격 × 토큰
  expect(u.totals.cost_runs).toBe(2);
  expect(u.totals.tool_calls).toBeGreaterThanOrEqual(1); // [fake:calc]
  const models = await admin.get(`/api/admin/usage?${q}&group=model`);
  expect(models.groups.map((g: { key: string; runs: number }) => [g.key, g.runs])).toEqual([['fake-chat-small', 2], ['fake-chat-large', 1]]);
  const spaces = await admin.get(`/api/admin/usage?${q}&group=space`);
  expect(spaces.groups.map((g: { label: string; runs: number }) => [g.label, g.runs])).toEqual([[SPACE, 3]]);
  const users = await admin.get(`/api/admin/usage?${q}&group=user`);
  expect(users.groups.map((g: { key: string }) => g.key)).toEqual([meId]);
  const raw = await (await admin.raw('GET', `/api/admin/usage?group=user`)).text();
  expect(raw).not.toContain(SECRET);
  // 사용자 표면(Bearer)으로는 못 읽는다
  expect((await (await userApi()).raw('GET', '/api/admin/usage')).status).toBe(401);
});

test('개요: 숫자 카드 · 흐름 차트 · 조직별 → 그 조직 사용량 · 모델 비중 → 모델 · 기간 30일 · 대화 내용 없음', async ({ page }) => {
  await page.goto('/#/overview');
  await expect(kpi(page, 'runs')).toBeVisible();
  expect(await num(page, 'runs')).toBeGreaterThanOrEqual(3);
  for (const k of ['tokens', 'cost', 'users', 'errors']) await expect(kpi(page, k)).toBeVisible();
  await expect(page.getByRole('region', { name: '호출 추이' }).locator('.ui-chart-plot svg')).toBeVisible();
  await expect(page.getByRole('region', { name: '토큰 추이' }).locator('.ui-chart-plot svg')).toBeVisible();
  // 차트 = 표 보기 (같은 값)
  const runs = page.getByRole('region', { name: '호출 추이' });
  await runs.getByRole('button', { name: '표로 보기' }).click();
  await expect(runs.getByRole('table')).toBeVisible();
  await expect(runs.getByRole('table').getByRole('row')).toHaveCount(8); // 머리 + 7일
  await runs.getByRole('button', { name: '차트로 보기' }).click();
  // 다시 그린 차트도 칸 너비대로 (빈 그림 0px 이 아니다)
  await expect.poll(async () => Number(await runs.locator('.ui-chart-plot svg').getAttribute('width'))).toBeGreaterThan(100);
  // 키보드: 차트에 포커스 → 마지막 날 값을 읽어 준다
  await runs.getByRole('group').focus();
  await expect(runs.locator('[aria-live]')).toContainText('호출');
  await noSecret(page);
  await page.screenshot({ path: shot('admin-overview-usage'), fullPage: true });

  // 모델 비중 → 모델 자세히
  const models = page.getByRole('region', { name: '모델별 비중' });
  await expect(models.getByRole('link').filter({ hasText: 'fake-chat-small' })).toHaveAttribute('href', '#/models/fake-chat-small');
  // 조직별 → 사용량 (그 조직 · 스페이스 묶음)
  const orgs = page.getByRole('region', { name: '조직별 사용량' });
  await orgs.getByRole('link').filter({ hasText: ORG }).click();
  await expect(page).toHaveURL(new RegExp(`#/usage\\?days=7&group=space&org=${orgId}$`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(['사용량']);
  await expect(kpi(page, 'runs')).toHaveText('3');
  await expect(page.getByRole('table', { name: '스페이스별 사용량 표' }).getByRole('row').filter({ hasText: SPACE })).toContainText('3');

  // 기간 30일 = 주소에
  await page.goto('/#/overview');
  await page.getByRole('radiogroup', { name: '기간' }).getByRole('radio', { name: '30일' }).click();
  await expect(page).toHaveURL(/#\/overview\?days=30$/);
  await expect(page.getByRole('region', { name: '호출 추이' }).getByRole('table').getByRole('row')).toHaveCount(31);
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
  await expect(page.getByRole('region', { name: '호출 추이' })).toHaveCount(0);
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
