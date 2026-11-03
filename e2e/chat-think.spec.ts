import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchDesktop } from './auth';
import { expectHeading, shot } from './helpers';

// 대화 상태 줄(유리 알약)의 세 모양 — 기다림 · 생각하는 중 · 생각함.
//   첫 이벤트 전 = 점 셋 + '응답을 기다리는 중' (글 반짝임 없음)
//   생각하는 동안 (생각 조각이 흐르거나 · 생각을 켰고 답 글이 아직 없다) = 반짝임 아이콘 + '생각하는 중' (글 위로 옅은 빛 · 움직임 줄이기 = 멈춘 글)
//   끝: 생각 글이 있으면 펼치는 'n초 동안 생각함' · 글 없이 토큰만이면 펼치지 않는 '생각함' + 작은 글 '생각 토큰 N' (빈 패널 없음)
// 도구 · 팀 문구는 도는 동안 생각보다 먼저 (slice 06 그대로).
// mock 표시: [fake:wait] 첫 조각 전 3초 · [fake:slow] 조각마다 250ms · [fake:think] 생각 조각 · [fake:omitted] 생각 글 없이 토큰만
const HOME_H1 = '무엇을 맡길까요?';
// trace.ts 는 model.ts → @brewai/ui 타입까지 끌고 와서 e2e tsc(nodenext)가 못 읽는다 → 돌릴 때만 읽는다 (chat-markdown.spec 과 같은 이유)
const TRACE_MODULE = '../apps/desktop/renderer/src/features/chat/trace';
type TraceMod = {
  tracePhrase: (a: Record<string, unknown>, tools: Record<string, string>, skills?: Record<string, string>) => { step: string; kind: string; parts: string[]; meta: string[]; text: string };
  hasPanel: (a: Record<string, unknown>) => boolean;
};

const ui = (win: Page) => ({
  box: win.getByRole('textbox', { name: '요청 입력' }),
  send: win.getByRole('button', { name: '보내기', exact: true }),
  last: win.locator('.msg.agent:not(.fail)').last(),
  model: win.locator('.composer .mpick-btn'),
  menu: win.getByRole('dialog', { name: '모델과 생각 깊이' }),
});
async function ask(win: Page, text: string) {
  await ui(win).box.fill(text);
  await ui(win).send.click();
}
const usage = (reasoning: number) => ({ input_tokens: 10, output_tokens: 20, requests: 1, tool_calls: 0, reasoning_tokens: reasoning });

test('상태 줄 모양 고르기: 기다림 → 생각하는 중 → 도구 · 팀이 먼저 → 생각함 (토큰만이면 펼치지 않음)', async () => {
  const { tracePhrase, hasPanel } = (await import(TRACE_MODULE)) as TraceMod;
  const base = {
    runId: 'r', status: 'running', failure: null, failureDetail: null, parts: [], steps: [], model: null, reasoning: 'off',
    startedAt: 1, durationMs: null, usage: null, fromHistory: false, cards: [],
  };
  const pick = (a: Record<string, unknown>) => {
    const t = tracePhrase(a, {});
    return { kind: t.kind, text: t.text };
  };
  // 보내고 RUN_STARTED 전 = 기다림 (생각을 켰어도 아직 실행이 안 열렸다)
  expect(pick({ ...base, status: 'sending', reasoning: 'high' })).toEqual({ kind: 'waiting', text: '응답을 기다리는 중' });
  // 생각 끄기 · 첫 이벤트 전 = 기다림
  expect(pick(base)).toEqual({ kind: 'waiting', text: '응답을 기다리는 중' });
  // 생각을 켰고 실행이 열렸는데 아직 아무것도 안 왔다 = 생각하는 중 (생각 글을 안 보내는 모델도 이 동안 생각한다)
  expect(pick({ ...base, reasoning: 'low' })).toEqual({ kind: 'thinking', text: '생각하는 중' });
  // 생각 끄기여도 생각 조각이 흐르면 = 생각하는 중 · 생각 단계 동안도 (오래 걸려도 같은 말)
  const flowing = { kind: 'reasoning', id: 'r0', text: '생각', live: true, ms: null, at: 1 };
  expect(pick({ ...base, parts: [flowing] })).toEqual({ kind: 'thinking', text: '생각하는 중' });
  const thinking = { name: 'thinking', label: '생각', status: 'running', started_ms: 0, duration_ms: null };
  expect(pick({ ...base, reasoning: 'high', steps: [thinking], parts: [flowing] })).toEqual({ kind: 'thinking', text: '생각하는 중' });
  expect(pick({ ...base, reasoning: 'high', steps: [{ ...thinking, started_ms: -60_000 }] })).toEqual({ kind: 'thinking', text: '생각하는 중' });
  // 생각을 켰어도 답 글이 오면 생각이 아니다
  const writing = { name: 'writing', label: '답 쓰기', status: 'running', started_ms: 10, duration_ms: null };
  expect(pick({ ...base, reasoning: 'high', steps: [{ ...thinking, status: 'done', duration_ms: 5 }, writing] })).toEqual({ kind: 'busy', text: '답을 다듬는 중' });
  // 도구가 도는 동안 = 도구 문구가 먼저 (생각을 켰어도)
  const tool = { kind: 'tool', id: 'c1', name: 'use_skill', label: '스킬 사용', argsText: '', args: {}, result: undefined, status: 'running', ms: null, at: 1, ready: 1, batch: 1 };
  const skillStep = { name: 'skill:summarize', label: '스킬: 요약', status: 'running', started_ms: 5, duration_ms: null };
  expect(tracePhrase({ ...base, reasoning: 'high', steps: [skillStep], parts: [tool] }, {}, { summarize: '요약' }).kind).toBe('busy');
  expect(pick({ ...base, reasoning: 'high', parts: [tool, { ...tool, id: 'c2' }] })).toEqual({ kind: 'busy', text: '도구 2개를 동시에 쓰는 중' });
  // 팀 = 팀 문구가 먼저 (총괄이 생각 단계여도 '팀원 n명이 나눠서 하는 중')
  const delegate = { ...tool, id: 'd1', name: 'delegate', label: '팀원에게 맡기기' };
  const member = { callId: 'd1', agent: 'a1', role: '조사', task: '찾기', modelLabel: '', tools: [], status: 'running', ms: null, code: null, usage: null, steps: [], at: 1 };
  expect(pick({ ...base, reasoning: 'high', steps: [thinking], parts: [delegate], team: [member] })).toEqual({ kind: 'busy', text: '팀원 1명이 나눠서 하는 중' });

  // 끝: 생각 글이 있으면 펼친다 (작은 글 없음)
  const done = { ...base, status: 'done', reasoning: 'high', durationMs: 4000 };
  const said = { ...flowing, live: false, ms: 2300 };
  expect(tracePhrase({ ...done, parts: [said], usage: usage(40) }, {})).toMatchObject({ kind: 'done', parts: ['2.3초 동안 생각함'], meta: [], text: '2.3초 동안 생각함' });
  expect(hasPanel({ ...done, parts: [said], usage: usage(40) })).toBe(true);
  // 글 없이 토큰만 = 펼치지 않는 '생각함' + '생각 토큰 N' (천 단위 쉼표) · 빈 생각 조각(시작 · 끝 신호만)도 그리지 않는다
  const silent = { ...done, parts: [{ ...said, text: '' }], usage: usage(1234) };
  expect(tracePhrase(silent, {})).toMatchObject({ kind: 'done', parts: ['생각함'], meta: ['생각 토큰 1,234'], text: '생각함, 생각 토큰 1,234' });
  expect(hasPanel(silent)).toBe(false);
  // 토큰 수를 모르면 (기록 · usage 없음) 작은 글 없이 — 생각 토큰이 없으면 '생각함' 도 아니다
  expect(tracePhrase({ ...silent, usage: null }, {}).meta).toEqual([]);
  // 토큰만 + 도구 = 도구 카드가 있으니 펼친다 (작은 글은 그대로)
  const toolDone = { ...tool, status: 'done', result: { ok: true }, ms: 5 };
  expect(hasPanel({ ...silent, parts: [toolDone] })).toBe(true);
  expect(tracePhrase({ ...silent, parts: [toolDone] }, {}).meta).toEqual(['생각 토큰 1,234']);
  // 생각을 건너뜀 = 펼칠 것 없음 · 작은 글 없음
  expect(hasPanel({ ...done, usage: usage(0) })).toBe(false);
  expect(tracePhrase({ ...done, usage: usage(0) }, {}).meta).toEqual([]);
});

test.describe('상태 줄 세 모양 (데스크톱)', () => {
  test.describe.configure({ mode: 'serial' });
  let app: ElectronApplication;
  let win: Page;
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    ({ app, win } = await launchDesktop());
    await expectHeading(win, HOME_H1);
  });
  test.afterAll(async () => app?.close());

  test('첫 이벤트 전 = 점 셋 + "응답을 기다리는 중" (반짝임 없음) · 화면 읽기는 한 번', async () => {
    await expect(ui(win).model).toHaveText('fake-chat-small'); // 생각 끄기
    await ask(win, '[fake:wait] 첫 토큰이 늦게 와요');
    const line = ui(win).last.locator('.trace-line');
    await expect(line).toHaveAttribute('data-kind', 'waiting');
    await expect(line).toHaveAttribute('data-glyph', 'wait');
    await expect(line).toHaveAttribute('data-step', 'waiting');
    await expect(line.locator('.glyph.dots i')).toHaveCount(3);
    await expect(line.locator('.trace-txt')).toHaveText('응답을 기다리는 중');
    await expect(line.locator('.trace-txt')).not.toHaveClass(/run/); // 기다림엔 글 위 빛이 없다
    await expect(line).toHaveAccessibleName('응답을 기다리는 중');
    await expect(line).toHaveAttribute('aria-expanded', 'false'); // 흐르는 중은 늘 펼칠 수 있다 (곧 생긴다)
    await expect(ui(win).last.locator('.trace > .sr[aria-live="polite"]')).toHaveText('응답을 기다리는 중');
    // 점은 움직인다 (차례로 · 움직임 줄이기 = 멈춤)
    expect(await line.locator('.glyph.dots i').first().evaluate((el) => getComputedStyle(el).animationName)).toBe('dots');
    await win.screenshot({ path: shot('desktop-think-waiting'), animations: 'disabled' });
    // 답이 오면 = 한 일이 없는 답 → 줄 없이 답만
    await expect(ui(win).last).toContainText('받은 질문: [fake:wait] 첫 토큰이 늦게 와요', { timeout: 15_000 });
    await expect(ui(win).last).toHaveAttribute('aria-busy', 'false');
    await expect(ui(win).last.locator('.trace-line')).toHaveCount(0);
  });

  test('생각하는 동안 = 반짝임 + "생각하는 중" (글 위로 옅은 빛 · 움직임 줄이기 = 멈춘 글) → 끝 = 펼치는 "n초 동안 생각함"', async () => {
    await ask(win, '[fake:slow] [fake:think] 천천히 생각해서 답해 줘');
    const line = ui(win).last.locator('.trace-line');
    await expect(line).toHaveAttribute('data-kind', 'thinking', { timeout: 10_000 });
    await expect(line).toHaveAttribute('data-step', 'thinking');
    await expect(line).toHaveAttribute('data-glyph', 'spark');
    await expect(line.locator('.glyph [data-icon="sparkle"]')).toHaveCount(1);
    await expect(line.locator('.trace-txt')).toHaveText('생각하는 중');
    await expect(line.locator('.trace-txt')).toHaveClass(/run/);
    const ph = line.locator('.trace-txt .ph');
    expect(await ph.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('gradient'); // 글 위로 지나가는 빛
    expect(await ph.evaluate((el) => getComputedStyle(el).animationName)).toContain('ui-shimmer');
    await win.screenshot({ path: shot('desktop-think-thinking') });
    // 화면 읽기 = 버튼 밖 live 영역 하나 (2초에 한 번 · 같은 글이면 그대로)
    await expect(ui(win).last.locator('.trace > .sr[aria-live="polite"]')).toHaveCount(1);
    // 끝 = 생각 글이 있다 → 펼치는 'n초 동안 생각함' (꺾쇠 · 버튼)
    await expect(line).toHaveAttribute('data-step', 'done', { timeout: 20_000 });
    await expect(line).toHaveAttribute('data-kind', 'done');
    await expect(line.locator('.trace-txt')).toHaveText(/^\d+(\.\d)?초 동안 생각함$/);
    await expect(line.locator('.trace-txt')).not.toHaveClass(/run/);
    await expect(line.locator('.tmeta')).toHaveCount(0);
    await expect(line).toHaveAttribute('data-glyph', 'think');
    await expect(line).toHaveAttribute('aria-expanded', 'false');
    await expect(line.locator('.chev')).toHaveCount(1);
    await expect(ui(win).last.locator('.trace > .sr[aria-live="polite"]')).toHaveText(/^\d+(\.\d)?초 동안 생각함$/); // 끝은 바로 알린다
    await win.screenshot({ path: shot('desktop-think-done') });
    await line.click();
    const panel = ui(win).last.getByRole('region', { name: '생각과 도구 사용 과정' });
    await expect(panel.locator('.tp-think .tp-body')).toContainText('필요한 도구가 있는지 확인해요');
    await expect(panel.locator('.tp-none')).toHaveCount(0);
    await line.click();
    await expect(panel).toBeHidden();
  });

  test('생각 글 없이 토큰만 = 펼치지 않는 "생각함" + "생각 토큰 N" · 빈 패널 없음', async () => {
    // OpenAI 모델 + [fake:omitted] = 생각 조각 없이 reasoning_tokens 만 (o 시리즈처럼 생각 글을 숨기는 모델)
    await ask(win, '[fake:think] [fake:omitted] 생각은 숨기고 답해');
    const line = ui(win).last.locator('.trace-line');
    await expect(line).toHaveAttribute('data-step', 'done', { timeout: 15_000 });
    await expect(line.locator('.trace-txt')).toHaveText('생각함');
    await expect(line.locator('.tmeta')).toHaveText(/^생각 토큰 \d[\d,]*$/);
    await expect(line).toHaveAttribute('data-glyph', 'think');
    await expect(line).toHaveAttribute('data-static', 'true');
    expect(await line.evaluate((el) => el.tagName)).toBe('DIV'); // 버튼이 아니다
    expect(await line.getAttribute('aria-expanded')).toBeNull();
    await expect(line.locator('.chev')).toHaveCount(0);
    await expect(line).toHaveAccessibleName(/^생각함, 생각 토큰 \d[\d,]*$/);
    await expect(ui(win).last.locator('.trace > .sr[aria-live="polite"]')).toHaveText(/^생각함, 생각 토큰 \d[\d,]*$/);
    expect(await line.textContent()).not.toMatch(/[·‧・•]/);
    await line.click(); // 눌러도 아무것도 안 열린다
    await expect(ui(win).last.getByRole('region', { name: '생각과 도구 사용 과정', includeHidden: true })).toHaveCount(0);
    await expect(ui(win).last).not.toContainText('모델이 생각 내용을 보내지 않았어요');
    await expect(ui(win).last.locator('.tp-none, .tp-think')).toHaveCount(0);
    await win.screenshot({ path: shot('desktop-think-done-empty') });
  });

  test('생각을 켰으면 첫 토큰 전에도 "생각하는 중" (기다림 점 대신 반짝임)', async () => {
    await ui(win).model.click();
    await ui(win).menu.locator('[role="option"][data-model="fake-chat-large"]').click();
    await ui(win).model.click();
    await ui(win).menu.getByRole('radiogroup', { name: '생각 깊이' }).getByRole('radio', { name: '보통', exact: true }).click();
    await win.keyboard.press('Escape');
    try {
      await ask(win, '[fake:wait] 생각을 켜고 첫 토큰이 늦게');
      const line = ui(win).last.locator('.trace-line');
      // 아직 생각 단계도 없다 (data-step waiting) · 생각을 켠 실행 = 생각하는 중
      await expect(line).toHaveAttribute('data-kind', 'thinking');
      await expect(line).toHaveAttribute('data-step', 'waiting');
      await expect(line).toHaveAttribute('data-glyph', 'spark');
      await expect(line.locator('.trace-txt')).toHaveText('생각하는 중');
      // 움직임 줄이기 = 빛 없이 멈춘 글 · 반짝임 아이콘도 가만히 (첫 토큰 전 3초 = 이 모양이 오래 머문다)
      await win.emulateMedia({ reducedMotion: 'reduce' });
      try {
        expect(await line.locator('.trace-txt .ph').evaluate((el) => getComputedStyle(el).backgroundImage)).toBe('none');
        expect(await line.locator('.glyph[data-glyph-icon="spark"]').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
        await expect(line.locator('.trace-txt')).toHaveText('생각하는 중');
      } finally {
        await win.emulateMedia({ reducedMotion: 'no-preference' });
      }
      expect(await line.locator('.glyph[data-glyph-icon="spark"]').evaluate((el) => getComputedStyle(el).animationName)).toBe('twinkle');
      await expect(line).toHaveAttribute('data-step', 'done', { timeout: 20_000 });
      await expect(line.locator('.trace-txt')).toHaveText(/생각함$/);
    } finally {
      await ui(win).model.click();
      await ui(win).menu.getByRole('radiogroup', { name: '생각 깊이' }).getByRole('radio', { name: '끄기', exact: true }).click();
      await ui(win).menu.locator('[role="option"][data-model="fake-chat-small"]').click();
    }
  });
});
