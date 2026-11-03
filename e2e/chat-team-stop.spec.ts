import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchDesktop, userApi, type Client } from './auth';
import { expectHeading, shot } from './helpers';
import { MEMO, addMemo, chat, chatRecords, clearRecord, team, type App } from './mcp';

// slice 06 멈추기 = 실행 전체만 (팀원 하나 멈추기는 없다): 팀원 둘이 느리게 도는 중 [멈추기] (작성창) →
// 도는 팀원 = '멈춤' · 실행 = cancelled (GET /api/runs) · 멈춘 뒤 게이트웨이에 팀원 요청이 더 가지 않는다
// mock 표시: [fake:team 가격 조사>memo slow, 사양 조사 slow] (가격 조사 = 앱 고르기 → 읽기 → 답 = 요청 3번 · 모두 느리게)
const HOME_H1 = '무엇을 맡길까요?';
const ASK = `노트북 두 종류를 각각 나눠서 조사해 줘 [fake:team 가격 조사>${MEMO.handle} slow, 사양 조사 slow]`;
const memberCount = () => chatRecords().filter((r) => r.kind === 'member').length;

test.describe.configure({ mode: 'serial' });
let api: Client;
let memo: App | null = null;
let app: ElectronApplication;
let win: Page;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  api = await userApi();
  memo = await addMemo(api);
  ({ app, win } = await launchDesktop());
  await expectHeading(win, HOME_H1);
});
test.afterAll(async () => {
  await app?.close();
  if (api && memo) await api.del(`/api/me/mcp/servers/${memo.id}`);
});

test('팀원이 도는 중 멈추기 → 팀원 "멈춤" · 실행 cancelled · 멈춘 뒤 팀원 요청 0', async () => {
  test.setTimeout(60_000);
  clearRecord();
  await win.getByRole('textbox', { name: '요청 입력' }).fill(ASK);
  await win.getByRole('button', { name: '보내기', exact: true }).click();
  const t = team(win);
  await expect(t.panel).toBeVisible({ timeout: 15_000 });
  await expect(t.members.and(win.locator('[data-state="running"]'))).toHaveCount(2, { timeout: 10_000 });
  await expect(t.summary).toHaveText('2명이 함께 일하는 중');
  await expect.poll(memberCount).toBeGreaterThanOrEqual(2); // 두 팀원 모두 첫 요청을 보냈다

  await win.getByRole('button', { name: '멈추기', exact: true }).click();
  await expect(chat(win).last).toHaveAttribute('aria-busy', 'false', { timeout: 10_000 });
  const stoppedAt = memberCount();
  // 도는 중이던 팀원 = 멈춤 (색 점 없이 글 + 아이콘) · 총괄 = 멈춤 · 요약 = 멈췄어요
  await expect(t.members.and(win.locator('[data-state="cancelled"]'))).toHaveCount(2);
  await expect(t.member('사양 조사').locator('.tm-row .tst')).toContainText('멈춤');
  await expect(t.lead).toHaveAttribute('data-state', 'cancelled');
  await expect(t.summary).toHaveText('함께 하던 일을 멈췄어요');
  await expect(t.panel.locator('.tm-tool[data-state="running"]')).toHaveCount(0);
  await expect(chat(win).last.locator('.trace-line .trace-txt')).toContainText('중간에 멈춤');
  await win.screenshot({ path: shot('desktop-team-stopped'), animations: 'disabled' });
  await win.emulateMedia({ colorScheme: 'dark' });
  await win.screenshot({ path: shot('desktop-team-stopped-dark'), animations: 'disabled' });
  await win.emulateMedia({ colorScheme: 'light' });

  // 서버: 실행 = cancelled · 멈춘 뒤 팀원 요청이 더 가지 않는다 (느린 팀원의 다음 왕복 시간보다 오래 기다린다)
  await expect.poll(async () => (await api.get<{ status: string }[]>('/api/runs'))[0]?.status, { timeout: 10_000 }).toBe('cancelled');
  await win.waitForTimeout(3000);
  expect(memberCount()).toBe(stoppedAt);
});
