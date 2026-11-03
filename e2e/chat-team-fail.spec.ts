import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchDesktop, poolUser } from './auth';
import { separatorsOnScreen } from './copy-rule';
import { expectHeading, shot } from './helpers';
import { chat, idle, openTrace, team } from './mcp';

// slice 06 실패 격리: 팀원 하나가 모델 오류(500)로 실패해도 다른 팀원은 끝내고 총괄은 답한다.
// 화면 = '실패' + 짧은 이유 ('모델이 응답하지 못했어요') · 게이트웨이 원문 오류는 어디에도 없다 · 요약 줄 Meta '1명 실패'
// mock 표시: [fake:team 가격 조사, 사양 조사 500] → 사양 조사의 모든 요청 = 500 (fake upstream failure)
// 바로 쓸 앱이 없는 사람 (테스트 사용자 '일반 멤버' · 앱을 넣지 않는다) = 팀원 도구 0개 (글만 · '받은 도구' = 도구 없음)
const HOME_H1 = '무엇을 맡길까요?';
const ASK = '두 가지를 여럿이 나눠서 알아봐 줘 [fake:team 가격 조사, 사양 조사 500]';
// 게이트웨이 원문 · 오류 코드 (task 의 mock 표시 '[fake:500]' 는 맡은 일 글이라 보여도 된다)
const RAW = ['fake upstream failure', 'internal_server_error', 'InternalServerError', 'member_model_error'];

test.describe.configure({ mode: 'serial' });
let app: ElectronApplication;
let win: Page;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  ({ app, win } = await launchDesktop({ as: await poolUser('member') }));
  await expectHeading(win, HOME_H1);
});
test.afterAll(async () => app?.close());

test('팀원 하나 실패 = "실패" + 짧은 이유 · 다른 팀원 완료 · 답은 나온다 · 원문 오류 없음', async () => {
  test.setTimeout(60_000);
  await win.getByRole('textbox', { name: '요청 입력' }).fill(ASK);
  await win.getByRole('button', { name: '보내기', exact: true }).click();
  const t = team(win);
  await expect(t.panel).toBeVisible({ timeout: 15_000 });
  await idle(win);

  const ok = t.member('가격 조사');
  const bad = t.member('사양 조사');
  await expect(ok).toHaveAttribute('data-state', 'done');
  await expect(bad).toHaveAttribute('data-state', 'error');
  await expect(bad.locator('.tm-row .tst')).toContainText('실패');
  await expect(bad.locator('.tm-why')).toHaveText('모델이 응답하지 못했어요');
  await expect(ok.locator('.tm-why')).toHaveCount(0);
  await expect(t.summary).toHaveText('2명 중 1명이 끝냈어요'); // 실패한 팀원은 '함께 끝냈다' 에 세지 않는다
  await expect(t.panel.locator('.team-sum-meta')).toHaveText('1명 실패');
  // 화면 읽기: 이름은 짧게 · 설명 = 할 일 + 상태 + 실패 이유 (펼치지 않아도 누가 실패했는지 들린다)
  await expect(bad.getByRole('button', { name: '사양 조사 자세히' })).toHaveAccessibleDescription(/실패.*모델이 응답하지 못했어요/);
  await expect(ok.getByRole('button', { name: '가격 조사 자세히' })).toHaveAccessibleDescription(/완료/);
  await expect(t.lead).toHaveAttribute('data-state', 'done');
  // 총괄은 받은 결과로 답한다 (실패한 팀원 = '하지 못했어요' · 오류 글은 옮기지 않음)
  await expect(chat(win).last.locator('.txt')).toContainText('가격 조사: 가격 조사 결과:');
  await expect(chat(win).last.locator('.txt')).toContainText('사양 조사: 하지 못했어요');
  await bad.getByRole('button', { name: '사양 조사 자세히' }).click();
  await expect(bad.locator('.tm-detail [data-row="tools"] dd')).toHaveText('도구 없음');
  await win.screenshot({ path: shot('desktop-team-failed'), animations: 'disabled' });
  await win.emulateMedia({ colorScheme: 'dark' });
  await win.screenshot({ path: shot('desktop-team-failed-dark'), animations: 'disabled' });
  await win.emulateMedia({ colorScheme: 'light' });

  // 답 안 묶음에도 같은 상태 · 이유
  const trace = await openTrace(win);
  const member = trace.locator('[data-kind="member"][data-agent="a2"]');
  await expect(member).toHaveAttribute('data-state', 'error');
  await expect(member.locator('.tp-member-why')).toHaveText('모델이 응답하지 못했어요');
  await expect(trace.locator('[data-kind="member"][data-agent="a1"]')).toHaveAttribute('data-state', 'done');
  await win.screenshot({ path: shot('desktop-team-failed-trace'), animations: 'disabled' });

  // 원문 오류 · 코드는 화면 어디에도 없다 (패널 · 답 · 상태 줄)
  const screen = (await win.locator('body').innerText()) + (await t.panel.innerHTML());
  for (const raw of RAW) expect(screen).not.toContain(raw);
  expect(await separatorsOnScreen(win)).toEqual([]);
});
