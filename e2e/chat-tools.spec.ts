import { test, expect, type ElectronApplication, type Locator, type Page, type Request } from '@playwright/test';
import { launchDesktop, userApi, type Client } from './auth';
import { expectHeading, shot } from './helpers';
import { MEMO, addMemo, type App } from './mcp';

// 도구 실행 흐름 (내장 도구는 없다 = 앱(MCP) · 스킬): 새 대화 홈의 제안 · '앱으로 해 보기'(쓸 수 있는 앱이 있을 때만) · 병렬 도구 묶음 · 여러 단계 · 보내기 전환.
// 앱 = 내 앱 '메모' (e2e/mock/mcp.mjs notes · 인증 없음 · 부르는 이름 memo). search_notes = 검색 MCP 모양 글(Title/URL 기록 3개)
// mock 표시: [fake:app memo 메모] → use_app · [fake:parallel] → memo__search_notes {query: 회의} + memo__list_notes 를 한 응답에
//   · [fake:chain memo] → use_app → memo__add_note → memo__list_notes → 요약 스킬 → 답 · [fake:slow] = 조각마다 250ms (도는 중 모습)
// 화면: 앱 도구 고르기 = 한 줄 메모(카드 아님) · 입력 = 핵심 인자 값(JSON 아님) · 검색 결과 = 제목 + 도메인 목록 · 요약 줄 = '메모 2회'
const HOME_H1 = '무엇을 맡길까요?';
const FIRST_STARTER = `${MEMO.name} 앱에서 최근 항목을 찾아서 정리해 줘`;

const ui = (win: Page) => ({
  box: win.getByRole('textbox', { name: '요청 입력' }),
  send: win.getByRole('button', { name: '보내기', exact: true }),
  log: win.getByRole('log', { name: '대화 내용' }),
  composer: win.locator('.composer').first(),
  last: win.locator('.msg.agent:not(.fail)').last(),
  suggest: win.locator('.suggest').first(),
  tryList: win.getByRole('list', { name: '앱으로 해 보기' }),
});

async function home(win: Page) {
  await win.getByRole('button', { name: '새 대화' }).click();
  await expectHeading(win, HOME_H1);
}
const idle = (win: Page) => expect(ui(win).last).toHaveAttribute('aria-busy', 'false', { timeout: 20_000 });
async function openTrace(win: Page) {
  const line = ui(win).last.locator('.trace-line');
  if ((await line.getAttribute('aria-expanded')) !== 'true') await line.click();
  return ui(win).last.locator('.trace-panel');
}
// 패널 아래 사용량 = 천 단위 쉼표 (1234 → 1,234)
async function expectGrouped(foot: Locator) {
  const text = (await foot.textContent()) ?? '';
  for (const n of text.match(/\d[\d,]*/g) ?? []) expect(n).toBe(Number(n.replace(/,/g, '')).toLocaleString('ko-KR'));
}

test.describe.configure({ mode: 'serial' });
let api: Client;
let memo: App | null = null;
let app: ElectronApplication;
let win: Page;
test.beforeAll(async () => {
  test.setTimeout(120_000);
  api = await userApi();
  memo = await addMemo(api); // 켜기 전에 = 홈이 처음부터 '앱으로 해 보기' 를 보인다
  ({ app, win } = await launchDesktop());
  await expectHeading(win, HOME_H1);
});
test.afterAll(async () => {
  await app?.close();
  if (api && memo) await api.del(`/api/me/mcp/servers/${memo.id}`);
});

test('홈: 스킬 제안(요약 · 비교표) + 쓸 수 있는 앱이 있으면 "앱으로 해 보기" (동시 실행 · 여러 단계 꼬리표)', async () => {
  await expect(ui(win).suggest.getByRole('button')).toHaveCount(2);
  await expect(ui(win).suggest.locator('.sg-t')).toHaveText(['재택근무의 장단점 세 줄 요약', '노트북 3종 가격, 무게, 배터리 비교표']);
  const list = ui(win).tryList;
  await expect(list.getByRole('button')).toHaveCount(3);
  await expect(list.locator('.need')).toHaveText(['동시 실행', '여러 단계']);
  await expect(list.getByRole('button').first()).toHaveAttribute('data-prompt', FIRST_STARTER);
  await expect(win.locator('.suggest-box').getByText(/메일|회의 자료|시차|마일/)).toHaveCount(0); // 없앤 도구 · 스킬 제안은 없다
  await win.screenshot({ path: shot('desktop-tools-home'), animations: 'disabled' });
});

test('제안을 누르면 입력창에 넣지 않고 바로 보낸다 (요청에 그 글) · 입력창은 제자리 · 홈 복제본은 사라진다', async () => {
  const { box, composer, log } = ui(win);
  const before = await composer.boundingBox();
  const sent = win.waitForRequest((r) => r.url().endsWith('/api/chat') && r.method() === 'POST');
  await ui(win).tryList.getByRole('button').first().click();
  const body = (await sent).postDataJSON() as { messages: { role: string; content: unknown }[] };
  expect(body.messages.at(-1)).toMatchObject({ role: 'user', content: FIRST_STARTER });
  await expect(log.locator('.msg.user')).toHaveText([FIRST_STARTER]);
  await expect(box).toHaveValue('');
  await expect(win.locator('.home-ghost')).toHaveCount(0, { timeout: 2000 }); // 빠지는 홈 = 잠깐의 그림 (남지 않는다)
  // 움직임이 다 끝난 뒤: 입력창이 같은 자리 (홈 → 대화 화면에서 튀지 않는다) · 말풍선은 제자리
  await expect.poll(() => win.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)).toBe(0);
  const after = await composer.boundingBox();
  expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(2);
  await idle(win);
});

test('병렬 도구: 앱 고르기 = 한 줄 메모 → 한 응답의 앱 도구 2개 = "동시에 2개" · 입력 = 검색어 · 결과 = 제목과 도메인 목록', async () => {
  const { box, send } = ui(win);
  await box.fill(`[fake:app ${MEMO.handle} 메모] [fake:parallel] [fake:slow] 회의 메모 찾고 목록도 보여 줘`);
  await send.click();
  const panel = await openTrace(win);
  const group = panel.locator('[data-kind="parallel"]');
  // 도는 중: 상태 줄 = 동시에 쓰는 중 · 묶음 머리 = n개 실행 중
  await expect(ui(win).last.locator('.trace-line')).toHaveAttribute('aria-label', /^도구 2개를 동시에 쓰는 중$/, { timeout: 15_000 });
  await expect(group.locator('.tp-par-meta')).toContainText('실행 중');
  await win.screenshot({ path: shot('desktop-tools-parallel-running'), animations: 'disabled' });
  await idle(win);

  // 앱 고르기 = 카드가 아니라 한 줄 메모 ('메모 연결, 도구 n개') · '도구' 꼬리표 · 0.0초 없음
  const note = panel.locator('.tp-note[data-tool="use_app"]');
  await expect(note).toHaveCount(1);
  await expect(note.locator('.tn')).toHaveText(new RegExp(`^${MEMO.name} 연결, 도구 [1-4]개$`));
  await expect(panel.locator('[data-kind="tool"][data-tool="use_app"]')).toHaveCount(0);
  await expect(note).not.toContainText('초');

  await expect(group).toHaveCount(1);
  await expect(group).toHaveAttribute('aria-label', '동시에 2개');
  const cards = group.locator('[data-kind="tool"]');
  await expect(cards).toHaveCount(2);
  await expect(cards.locator('.th b')).toHaveText([`${MEMO.name}: Search Notes`, `${MEMO.name}: List Notes`]);
  for (const i of [0, 1]) {
    await expect(cards.nth(i)).toHaveAttribute('data-state', 'done');
    await expect(cards.nth(i).locator('.tst .tm')).toHaveText(/^\d+(\.\d)?(초|ms)$/); // 묶음 안 카드 = 실행 시간 (머리 줄과 같은 뜻)
  }
  // 입력 = 핵심 인자 값 (JSON 중괄호 · 따옴표 없이)
  const search = cards.nth(0);
  await expect(search.locator('[data-row="입력"] dd')).toHaveText('회의');
  await expect(search.locator('dl')).not.toContainText('{');
  // 결과 = Title/URL 기록 → 제목(링크) + 도메인 목록
  await expect(search.locator('[data-row="결과"] dd')).toHaveText('3개');
  const links = search.getByRole('list', { name: '결과 목록' }).getByRole('listitem');
  await expect(links).toHaveCount(3);
  await expect(links.first().getByRole('link')).toHaveText('회의 메모 1');
  await expect(links.first().getByRole('link')).toHaveAttribute('href', 'https://notes.example.com/n/1');
  await expect(links.first().locator('.ld')).toHaveText('notes.example.com');
  await expect(search).not.toContainText('Title:');
  // 날것은 '원문' 토글 뒤에 (기본 접힘)
  await expect(search.locator('.traw')).toBeHidden();
  await search.getByRole('button', { name: '원문 보기' }).click();
  await expect(search.locator('.traw')).toBeVisible();
  await expect(search.locator('.traw')).toContainText('"query": "회의"');
  await search.getByRole('button', { name: '원문 접기' }).click();
  await expect(search.locator('.traw')).toBeHidden();

  await expect(group.locator('.tp-par-meta .ui-meta-item')).toHaveText([/^실행 \d/, /^ ?하나씩이면 \d/]);
  // 머리 줄 '하나씩이면' = 카드 시간의 합 (같은 뜻 · 반올림 차이만)
  const ms = (t: string) => (t.endsWith('ms') ? Number(t.slice(0, -2)) : Number(t.replace('초', '')) * 1000);
  const sum = (await cards.locator('.tst .tm').allTextContents()).reduce((n, t) => n + ms(t), 0);
  const serial = ms((await group.locator('.tp-par-meta .ui-meta-item').nth(1).textContent())!.replace(/^ ?하나씩이면 /, ''));
  expect(Math.abs(sum - serial)).toBeLessThanOrEqual(Math.max(3, serial * 0.1));
  // 실행 막대(그렸다면) = 모두 같은 왼쪽 끝에서 시작 (모델이 인자를 쓰는 엇갈린 칸은 없다)
  await expect(group.locator('.tp-lane .call')).toHaveCount(0);
  const starts = await group.locator('.tp-lane .run').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
  expect(new Set(starts).size).toBeLessThanOrEqual(1);

  // 요약 줄 = 앱 이름으로 묶은 횟수 ('앱:' · '<앱>: <도구>' 겹침 없이)
  const segs = await ui(win).last.locator('.trace-line .trace-txt .seg').allTextContents();
  expect(segs).toContain(`${MEMO.name} 2회`);
  expect(segs.join(' ')).not.toContain('앱:');
  await expect(ui(win).last.locator('.txt')).toContainText('앱 결과를 받았어요');
  await expectGrouped(panel.locator('.tp-foot'));
  await win.screenshot({ path: shot('desktop-tools-parallel-done'), animations: 'disabled' });
  await win.emulateMedia({ colorScheme: 'dark' });
  await win.screenshot({ path: shot('desktop-tools-parallel-done-dark'), animations: 'disabled' });
  await win.emulateMedia({ colorScheme: 'light' });
});

test('여러 단계: 앱 고르기 → 메모 저장 → 목록 → 요약 스킬 → 답 (차례대로 = 묶음 없음)', async () => {
  await home(win);
  const { box, send } = ui(win);
  await box.fill(`[fake:chain ${MEMO.handle}] 회의 준비 메모 남기고 정리해 줘`);
  await send.click();
  await idle(win);
  const panel = await openTrace(win);
  await expect(panel.locator('[data-kind="parallel"]')).toHaveCount(0);
  await expect(panel.locator('.tp-note[data-tool="use_app"]')).toHaveCount(1);
  await expect(panel.locator('[data-kind="tool"] .th b')).toHaveText([`${MEMO.name}: Add Note`, `${MEMO.name}: List Notes`, '스킬 사용']);
  await expect(panel.locator(`[data-tool="${MEMO.handle}__add_note"] [data-row="입력"] dd`)).toHaveText('회의 준비');
  await expect(panel.locator(`[data-tool="${MEMO.handle}__add_note"] .twrite`)).toHaveText('쓰기');
  await expect(ui(win).last.locator('.trace-line .trace-txt .seg')).toContainText([`${MEMO.name} 2회`, '스킬 사용 1회']);
  await expect(ui(win).last.locator('.txt')).toContainText("스킬 '요약' 지침을 따랐어요");
  await win.screenshot({ path: shot('desktop-tools-chain'), animations: 'disabled' });
});

test('기록에서 다시 열어도 같은 묶음 · 같은 메모 줄 (새 창 = 서버 기록 · 시간 막대 없이)', async () => {
  const fresh = await launchDesktop();
  try {
    await expectHeading(fresh.win, HOME_H1);
    // 제안으로 시작한 대화 (둘째 턴 = 병렬)
    await fresh.win.getByRole('list', { name: '최근' }).getByRole('button', { name: new RegExp(`^${FIRST_STARTER}`) }).first().click();
    await expect(ui(fresh.win).log.locator('.msg.user')).toHaveCount(2);
    const panel = await openTrace(fresh.win);
    await expect(panel.locator('.tp-note[data-tool="use_app"] .tn')).toHaveText(new RegExp(`^${MEMO.name} 연결, 도구 [1-4]개$`));
    const group = panel.locator('[data-kind="parallel"]');
    await expect(group).toHaveAttribute('aria-label', '동시에 2개');
    await expect(group.locator('[data-kind="tool"]')).toHaveCount(2);
    await expect(group.locator('.tp-lane')).toHaveCount(0); // 기록엔 시간이 없다
    await expect(group.getByRole('list', { name: '결과 목록' }).first().getByRole('listitem')).toHaveCount(3);
    const segs = await ui(fresh.win).last.locator('.trace-line .trace-txt .seg').allTextContents();
    expect(segs).toContain(`${MEMO.name} 2회`);
  } finally {
    await fresh.app.close();
  }
});

test('앱 고르기 실패 = 사람이 읽는 문구 (모델용 지시 "사용자에게 묻는다" 는 화면에 없음)', async () => {
  await home(win);
  const { box, send } = ui(win);
  await box.fill('[fake:app zzqx zzqx] 없는 앱으로 해 줘');
  await send.click();
  await idle(win);
  const panel = await openTrace(win);
  await expect(panel.locator('.tp-note[data-tool="use_app"] .tn')).toHaveText('앱 도구를 고르지 못했어요: 맞는 앱이 없어요');
  await expect(panel).not.toContainText('묻는다');
  await win.screenshot({ path: shot('desktop-tools-app-missed'), animations: 'disabled' });
});

test('움직임 줄이기: 홈 복제본 · 말풍선 이동 없이 바로 끝 모양', async () => {
  await win.emulateMedia({ reducedMotion: 'reduce' });
  await home(win);
  const ghosts = win.evaluate(() => new Promise<number>((resolve) => {
    let n = 0;
    const o = new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((x) => { if (x instanceof HTMLElement && x.classList.contains('home-ghost')) n++; })));
    o.observe(document.body, { childList: true });
    setTimeout(() => { o.disconnect(); resolve(n); }, 800);
  }));
  await ui(win).tryList.getByRole('button').nth(1).click();
  await expect(ui(win).log.locator('.msg.user')).toHaveCount(1);
  expect(await ghosts).toBe(0);
  expect(await ui(win).log.locator('.msg.user .bubble').evaluate((el) => el.getAnimations().length)).toBe(0);
  await idle(win);
  await win.emulateMedia({ reducedMotion: 'no-preference' });
});

test('이어서 보내면 새 말풍선이 아래에서 떠오른다 (가벼운 전환)', async () => {
  const { box, send, log } = ui(win);
  await box.fill('하나 더');
  await send.click();
  const bubble = log.locator('.msg.user').last();
  await expect(bubble).toHaveText('하나 더');
  expect(await bubble.evaluate((el) => getComputedStyle(el).animationName)).toBe('bubble-in');
  await idle(win);
});

test('제안을 두 번 눌러도 한 번만 보낸다 (보낸 뒤엔 홈이 사라지고 도는 중엔 막힌다)', async () => {
  await home(win);
  const posts: string[] = [];
  const onReq = (r: Request) => {
    if (r.url().endsWith('/api/chat') && r.method() === 'POST') posts.push(r.url());
  };
  win.on('request', onReq);
  try {
    await ui(win).tryList.getByRole('button').nth(1).dblclick();
    await expect(ui(win).log.locator('.msg.user')).toHaveCount(1);
    await idle(win);
    expect(posts).toHaveLength(1);
    await expect(ui(win).log.locator('.msg.user')).toHaveCount(1);
  } finally {
    win.off('request', onReq);
  }
});

test('쓸 수 있는 앱이 없으면 "앱으로 해 보기" 없이 스킬 제안만', async () => {
  if (memo) await api.del(`/api/me/mcp/servers/${memo.id}`);
  memo = null;
  const fresh = await launchDesktop();
  try {
    await expectHeading(fresh.win, HOME_H1);
    await expect(ui(fresh.win).suggest.getByRole('button')).toHaveCount(2);
    // 다른 스펙이 남긴 전체 공통 앱(로그인 필요)은 '바로 쓸 수 있는 앱' 이 아니다
    const apps = (await api.get<{ mine: App[] }>('/api/me/mcp/servers')).mine;
    const ready = apps.filter((a) => !a.hidden && a.usable && (a.connection === 'connected' || a.connection === 'none'));
    if (!ready.length) await expect(fresh.win.getByRole('list', { name: '앱으로 해 보기' })).toHaveCount(0);
  } finally {
    await fresh.app.close();
  }
});
