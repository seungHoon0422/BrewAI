import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchDesktop, userApi, type Client } from './auth';
import { separatorsOnScreen } from './copy-rule';
import { expectHeading, shot } from './helpers';
import { MEMO, addMemo, chat, chatRecords, clearRecord, idle, openTrace, team, toolNames, type App } from './mcp';

// slice 06 에이전트 팀 (P4-1 · P4-2): 복합 질문 하나 → 총괄이 팀원 2명에게 한 응답에 맡김 → 오른쪽 '진행 상황' 이 저절로 열리고
// 총괄 → 팀원 → 도구 트리 · 상태가 실시간으로 · 답 → 다시 열어도 같은 트리 → 새 대화 hello 는 delegate 없는 요청 (오늘과 같다)
// mock 표시: [fake:team 가격 조사>memo, 사양 조사 slow] → delegate 2개 (가격 조사 = 메모 앱 고르기 → search_notes · 사양 조사 = 글만 · 느리게)
// 앱 = 내 앱 '메모' (e2e/mock/mcp.mjs notes · 인증 없음 = 이미 연결된 앱 · 팀원은 읽기 도구만)
const HOME_H1 = '무엇을 맡길까요?';
const ASK = `노트북 3종 비교표 여럿이 나눠서 조사해 줘 [fake:team 가격 조사>${MEMO.handle}, 사양 조사 slow]`;

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

test('팀 턴: 패널이 저절로 열리고 총괄 → 가격 조사 · 사양 조사 트리가 실시간으로 (사양 조사가 도는 동안 가격 조사 완료 + 메모 도구 줄)', async () => {
  test.setTimeout(60_000);
  clearRecord();
  await win.getByRole('textbox', { name: '요청 입력' }).fill(ASK);
  await win.getByRole('button', { name: '보내기', exact: true }).click();
  const t = team(win);
  await expect(t.panel).toBeVisible({ timeout: 15_000 }); // 처음 팀이 생기면 저절로 (넓은 창 = 2열)
  await expect(win.locator('.view.thread')).toHaveClass(/has-team/);
  await expect(t.toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(t.lead.locator(':scope > .tm-row b')).toHaveText('총괄');
  await expect(t.lead.locator(':scope > .tm-row .tm-role')).toHaveText('일 나누고 확인');
  await expect(t.members.locator('.tm-row b')).toHaveText(['가격 조사', '사양 조사']);
  // 상태 줄 = 팀원 2명이 나눠서 하는 중 (사양 조사가 느리다)
  await expect(chat(win).last.locator('.trace-line')).toHaveAttribute('aria-label', '팀원 2명이 나눠서 하는 중', { timeout: 10_000 });
  // 사양 조사가 아직 도는 동안: 가격 조사 = 완료 + 메모 도구 줄 (앱 고르기 · 메모 검색) · 실행은 아직 안 끝남
  const price = t.member('가격 조사');
  const spec = t.member('사양 조사');
  await expect(price).toHaveAttribute('data-state', 'done', { timeout: 15_000 });
  await expect(spec).toHaveAttribute('data-state', 'running');
  await expect(chat(win).last).toHaveAttribute('aria-busy', 'true');
  await expect(price.locator('.tm-tool[data-step^="app:"]')).toHaveCount(1);
  await expect(price.locator(`.tm-tool[data-step="tool:${MEMO.handle}__search_notes"]`)).toHaveAttribute('data-state', 'done');
  await expect(price.locator('.tm-row .tst')).toContainText('완료');
  await expect(spec.locator('.tm-row .tst')).toContainText('작업 중');
  await expect(spec.locator('.tm-tool')).toHaveCount(0); // 글만 하는 팀원 (앱 표시 없음)
  await expect(t.summary).toHaveText('2명이 함께 일하는 중');
  await win.screenshot({ path: shot('desktop-team-running'), animations: 'disabled' });

  await idle(win);
  await expect(spec).toHaveAttribute('data-state', 'done');
  await expect(t.summary).toHaveText('2명이 함께 끝냈어요');
  await expect(t.lead).toHaveAttribute('data-state', 'done');
  // 끝 요약 칩 = 팀원 2명 + 팀원이 쓴 앱 도구 횟수 (앱 이름) + 시간
  const segs = await chat(win).last.locator('.trace-line .trace-txt .seg').allTextContents();
  expect(segs[0]).toBe('팀원 2명');
  expect(segs).toContain(`${MEMO.name} 1회`);
  expect(segs.at(-1)).toMatch(/^\d+(\.\d)?초$/);
  await expect(chat(win).last.locator('.txt')).toContainText('가격 조사: 가격 조사 결과:');
  await expect(chat(win).last.locator('.txt')).toContainText('사양 조사: 사양 조사 결과:');
});

test('팀원 펼침: 맡은 일 · 모델 · 받은 도구(칩) · 사용량 / 답 안 팀 묶음 = "팀원 2명이 나눠서" + 팀원 줄 + 도구 줄', async () => {
  const t = team(win);
  const price = t.member('가격 조사');
  await price.getByRole('button', { name: '가격 조사 자세히' }).click();
  const detail = price.locator('.tm-detail');
  await expect(detail).toBeVisible();
  await expect(detail.locator('[data-row="task"] dd')).toContainText('가격 조사 맡기');
  await expect(detail.locator('[data-row="model"] dd')).not.toBeEmpty();
  await expect(detail.locator('[data-row="tools"] .ui-badge').first()).toBeVisible(); // 앱 고르기 + 꺼낸 읽기 도구
  await expect(detail.locator('[data-row="tools"]')).not.toContainText('Add Note'); // 쓰기 도구는 팀원에게 없다
  await expect(detail.locator('[data-row="usage"] .ui-meta-item')).toHaveText([/^요청 \d+회$/, /^ ?토큰 입력 [\d,]+, 출력 [\d,]+$/]);
  const spec = t.member('사양 조사');
  await spec.getByRole('button', { name: '사양 조사 자세히' }).click();
  await expect(spec.locator('.tm-detail [data-row="tools"] .ui-badge')).toHaveText(['앱 도구 고르기']); // 앱을 안 꺼낸 팀원 = 고르기 도구만
  await win.screenshot({ path: shot('desktop-team-done'), animations: 'disabled' });
  await win.emulateMedia({ colorScheme: 'dark' });
  await win.screenshot({ path: shot('desktop-team-done-dark'), animations: 'disabled' });
  await win.emulateMedia({ colorScheme: 'light' });

  // 답 안 묶음 (상태 줄 펼침)
  const trace = await openTrace(win);
  const group = trace.locator('[data-kind="team"]');
  await expect(group).toHaveAttribute('aria-label', '팀원 2명이 나눠서');
  await expect(group.locator('[data-kind="member"] > .th b')).toHaveText(['가격 조사', '사양 조사']);
  await expect(group.locator('[data-kind="member"][data-agent="a1"] [data-kind="tool"]')).toHaveCount(1);
  await expect(group.locator('[data-kind="member"][data-agent="a1"] [data-kind="member-pick"]')).toHaveCount(1);
  await expect(group.getByRole('button', { name: '오른쪽에서 보기' })).toBeVisible();
  await win.screenshot({ path: shot('desktop-team-trace'), animations: 'disabled' });
  // 화면 글에 가운뎃점 없음 (copy-rule)
  expect(await separatorsOnScreen(win)).toEqual([]);
});

test('요청 기록: 총괄 첫 요청에 delegate · 팀원 요청에는 delegate · use_skill 없음 (task 만 · 대화 기록 없음)', async () => {
  const recs = chatRecords();
  const main = recs.filter((r) => r.kind === 'main');
  const members = recs.filter((r) => r.kind === 'member');
  expect(toolNames(main[0]).slice(0, 2)).toEqual(['use_skill', 'delegate']); // delegate = 고정 앞부분 (공개 도구는 맨 뒤)
  expect(members.length).toBeGreaterThanOrEqual(2);
  for (const r of members) {
    expect(toolNames(r)).not.toContain('delegate');
    expect(toolNames(r)).not.toContain('use_skill');
    expect(toolNames(r).some((n) => n.endsWith('__add_note'))).toBe(false);
    const users = (r.body?.messages ?? []).filter((m) => m.role === 'user');
    expect(users).toHaveLength(1);
    expect(JSON.stringify(users[0].content)).toContain(' 맡기');
    expect(JSON.stringify(users[0].content)).not.toContain('[fake:team');
  }
});

test('닫기는 대화마다 기억 · 머리 토글(진행 상황 열고 닫기)로 다시 연다', async () => {
  const t = team(win);
  await t.close.click();
  await expect(t.panel).toHaveCount(0);
  await expect(win.locator('.view.thread')).not.toHaveClass(/has-team/);
  await expect(t.toggle).toHaveAttribute('aria-pressed', 'false');
  // 다른 화면에 갔다 와도 닫힌 채
  await win.getByRole('button', { name: '새 대화' }).click();
  await expectHeading(win, HOME_H1);
  await win.getByRole('list', { name: '최근' }).getByRole('button', { name: /^노트북 3종/ }).first().click();
  await expect(chat(win).log.locator('.msg.user')).toHaveCount(1);
  await expect(t.panel).toHaveCount(0);
  await t.toggle.click();
  await expect(t.panel).toBeVisible();
  await expect(t.members).toHaveCount(2);
});

test('좁은 창 = 패널은 토글로 덮개 (대화 위 · Esc 로 닫힘)', async () => {
  const t = team(win);
  const size = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize());
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 820));
  try {
    await expect.poll(() => win.evaluate(() => window.innerWidth)).toBeLessThan(1100);
    await expect(t.panel).toHaveAttribute('data-overlay', 'true');
    await win.screenshot({ path: shot('desktop-team-overlay'), animations: 'disabled' });
    await t.panel.getByRole('button', { name: '가격 조사 자세히' }).focus();
    await win.keyboard.press('Escape');
    await expect(t.panel).toHaveCount(0);
    await expect(t.toggle).toBeFocused(); // 닫으면 포커스는 머리 토글로
    // 키보드로 열기 = 포커스가 덮개 안으로 (토글이 덮개 밑에 숨는다) · Esc 는 포커스가 어디 있든 닫는다
    await win.keyboard.press('Enter');
    await expect(t.panel).toHaveAttribute('data-overlay', 'true');
    await expect(t.close).toBeFocused();
    await win.locator('.conv-head').click({ position: { x: 4, y: 4 } }); // 포커스를 패널 밖으로
    await win.keyboard.press('Escape');
    await expect(t.panel).toHaveCount(0);
    await expect(t.toggle).toBeFocused();
  } finally {
    await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h), size as [number, number]);
  }
});

test('다시 열기 (새 창 = 서버 기록): 같은 트리 · 같은 상태 · 같은 도구 줄 · 패널이 저절로', async () => {
  const fresh = await launchDesktop();
  try {
    await expectHeading(fresh.win, HOME_H1);
    await fresh.win.getByRole('list', { name: '최근' }).getByRole('button', { name: /^노트북 3종/ }).first().click();
    const t = team(fresh.win);
    await expect(t.panel).toBeVisible();
    await expect(t.members.locator('.tm-row b')).toHaveText(['가격 조사', '사양 조사']);
    await expect(t.members.and(fresh.win.locator('[data-state="done"]'))).toHaveCount(2);
    await expect(t.member('가격 조사').locator(`.tm-tool[data-step="tool:${MEMO.handle}__search_notes"]`)).toHaveAttribute('data-state', 'done');
    await expect(t.summary).toHaveText('2명이 함께 끝냈어요');
    const segs = await chat(fresh.win).last.locator('.trace-line .trace-txt .seg').allTextContents();
    expect(segs[0]).toBe('팀원 2명');
    await fresh.win.screenshot({ path: shot('desktop-team-reopen'), animations: 'disabled' });
  } finally {
    await fresh.app.close();
  }
});

test('새 대화 hello = 패널 · 토글 없음 · 첫 요청 tools 에 delegate 없음 (오늘과 같은 요청)', async () => {
  clearRecord();
  await win.getByRole('button', { name: '새 대화' }).click();
  await expectHeading(win, HOME_H1);
  await win.getByRole('textbox', { name: '요청 입력' }).fill('hello');
  await win.getByRole('button', { name: '보내기', exact: true }).click();
  await expect(chat(win).last.locator('.txt')).toContainText('받은 질문: hello', { timeout: 20_000 });
  await expect(chat(win).last).toHaveAttribute('aria-busy', 'false');
  const t = team(win);
  await expect(t.panel).toHaveCount(0);
  await expect(t.toggle).toHaveCount(0);
  const recs = chatRecords();
  expect(recs.length).toBeGreaterThan(0);
  expect(recs.every((r) => r.kind === 'main')).toBe(true);
  expect(toolNames(recs[0])).not.toContain('delegate');
  expect(toolNames(recs[0])[0]).toBe('use_skill');
});

test('팀원의 긴 일 설명(task)이 와도 상태 줄 패널 밖으로 넘치지 않는다 (실사용 2026-11-04 · 여행 경비 조사)', async () => {
  await win.getByRole('button', { name: '새 대화' }).click();
  await expectHeading(win, HOME_H1);
  // 긴 일 설명 + 팀원마다 앱 도구 줄 (실사용 스크린샷 모양: 팀원 카드 안에 도구 카드 여럿)
  await win.getByRole('textbox', { name: '요청 입력' }).fill(
    `여럿이 나눠서 조사해 줘 [fake:team 서울 경비 조사>${MEMO.handle} long, 도쿄 경비 조사>${MEMO.handle} long, 방콕 경비 조사 long]`);
  await win.getByRole('button', { name: '보내기', exact: true }).click();
  await idle(win);
  const panel = await openTrace(win);
  await expect(panel.locator('[data-kind="member"]')).toHaveCount(3);
  await expect(panel.locator('.tp-member-steps [data-kind="tool"]').first()).toBeVisible();
  const fit = await panel.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const rights = [...el.querySelectorAll('[data-kind="member"], .tp-member-task, .tp-par-list > li, .tp-member-steps [data-kind="tool"]')].map((c) => c.getBoundingClientRect().right);
    return { inside: rights.every((r) => r <= box.right + 1), noScroll: el.scrollWidth <= el.clientWidth + 1 };
  });
  expect(fit).toEqual({ inside: true, noScroll: true });
  await win.screenshot({ path: shot('desktop-team-long-task'), animations: 'disabled' });
});
