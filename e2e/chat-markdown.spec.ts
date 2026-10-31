import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { adminApi, launchDesktop, userApi } from './auth';
import { expectHeading, shot } from './helpers';
import { parse, type Token } from '../apps/desktop/renderer/src/features/chat/markdown/parse';
import { cellCount, closeInline, streamSafe } from '../apps/desktop/renderer/src/features/chat/markdown/stream';
import { cutAt, revealStep } from '../apps/desktop/renderer/src/features/chat/markdown/reveal';

// trace.ts 는 model.ts → @brewai/ui 타입까지 끌고 와서 e2e tsc(nodenext)가 못 읽는다 → 돌릴 때만 읽는다 (타입 검사는 데스크톱 typecheck 가 한다)
const TRACE_MODULE = '../apps/desktop/renderer/src/features/chat/trace';
type Summary = (a: Record<string, unknown>) => string[];

// 답 글 = 마크다운 (흐르는 중에도 날것 문법 없음) · 생각 블록 ↔ 도구 블록 · 최소한의 모델 메뉴.
// 위 = 단위 (앱 없이 parse · stream · reveal) · 아래 = 데스크톱 (mock [fake:md] = 마크다운 답을 3글자씩 잘게)
const HOME_H1 = '무엇을 맡길까요?';

const DOC = [
  '## 노트북 비교',
  '',
  '세 제품을 **무게**와 *배터리*로 비교했어요. `npm ci` 로 설치해요.',
  '',
  '| 모델 | 무게 | 배터리 |',
  '| --- | ---: | :---: |',
  '| **A14** | 1.2kg | 18시간 |',
  '| B15 | 1.6kg | 12시간 |',
  '',
  '- 첫째 항목',
  '- 둘째 **굵게** 항목',
  '',
  '1. 하나',
  '2. 둘',
  '',
  '> 인용 문장',
  '',
  '```ts',
  'const x = 1;',
  '```',
  '',
  '---',
  '',
  '자세한 내용은 [공식 문서](https://example.com/docs)를 보세요.',
].join('\n');

// 화면에 보일 글만 (코드 상자 글은 뺀다 — 거기선 기호가 글자다)
function visible(tokens: readonly Token[]): string {
  return tokens.map((t) => {
    const g = t as any;
    if (t.type === 'code') return '';
    if (t.type === 'table') return [g.header, ...g.rows].map((r: any[]) => r.map((c) => visible(c.tokens)).join(' ')).join('\n');
    if (t.type === 'list') return g.items.map((i: any) => visible(i.tokens)).join('\n');
    if (Array.isArray(g.tokens)) return visible(g.tokens);
    if (t.type === 'hr' || t.type === 'br') return '\n';
    return typeof g.text === 'string' ? g.text : '';
  }).join('');
}
const RAW = /\*\*|\||##|```|\]\(|(^|\n)\s*[-*>]\s*(\n|$)/;

test.describe('마크다운 (단위)', () => {
  test('블록 종류마다 토큰 (제목 · 문단 · 표 · 목록 · 인용 · 코드 · 구분선)', () => {
    const { blocks } = parse(DOC);
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'table', 'list', 'list', 'blockquote', 'code', 'hr', 'paragraph']);
    const inl = (blocks[1] as any).tokens.map((t: Token) => t.type);
    expect(inl).toEqual(expect.arrayContaining(['strong', 'em', 'codespan']));
    const link = (blocks[8] as any).tokens.find((t: Token) => t.type === 'link');
    expect(link.href).toBe('https://example.com/docs');
    expect(parse('<script>alert(1)</script>').blocks[0].type).toBe('html'); // 그리는 쪽이 글자로 둔다
  });

  test('흐르는 중: 글자 하나씩 늘려도 날것 문법이 안 보이고, 머리 줄이 오면 바로 표', () => {
    const cps = Array.from(DOC);
    const bad: string[] = [];
    let tableBeforeEnd = false;
    for (let i = 1; i <= cps.length; i++) {
      const part = cps.slice(0, i).join('');
      const { blocks } = parse(part, true);
      const text = visible(blocks);
      if (RAW.test(text)) bad.push(`${JSON.stringify(part.slice(-24))} → ${JSON.stringify(text.slice(-30))}`);
      const headerIn = /\| 모델 \|/.test(part);
      const hasTable = blocks.some((b) => b.type === 'table');
      if (headerIn && !part.includes('- 첫째') && !hasTable) bad.push(`표 아님: ${JSON.stringify(part.slice(-24))}`);
      if (hasTable && i < cps.length) tableBeforeEnd = true;
    }
    expect(bad).toEqual([]);
    expect(tableBeforeEnd).toBe(true);
  });

  test('표: 머리 줄만 → 구분 줄을 짓는다 · 쓰다 만 구분 줄 · 쓰다 만 줄도 한 줄', () => {
    expect(streamSafe('| a | b |').text).toBe('| a | b |\n| --- | --- |');
    expect(streamSafe('| a | b |\n|--').text).toBe('| a | b |\n| --- | --- |');
    expect(streamSafe('| a | b |\n').text).toBe('| a | b |\n| --- | --- |');
    const t = parse('| a | b |\n| --- | --- |\n| 1', true).blocks[0] as any;
    expect(t.type).toBe('table');
    expect(t.rows).toHaveLength(1);
    expect(cellCount('| a | b \\| c |')).toBe(2);
  });

  test('닫히지 않은 인라인 기호는 화면에서만 닫는다 (뒤에 글이 없으면 숨김) · 2**10 같은 글자는 그대로', () => {
    expect(closeInline('**굵')).toBe('**굵**');
    expect(closeInline('글 **')).toBe('글 ');
    expect(closeInline('`co')).toBe('`co`');
    expect(closeInline('*a* 그리고 **b ')).toBe('*a* 그리고 **b** ');
    expect(closeInline('[문서](https://a.b')).toBe('[문서](https://a.b)');
    expect(closeInline('자세히는 [공식')).toBe('자세히는 공식');
    expect(closeInline('2**10 + 1')).toBe('2**10 + 1');
    expect(closeInline('snake_case')).toBe('snake_case');
    expect(streamSafe('```py\nprint(1)').text).toBe('```py\nprint(1)\n```');
    expect(streamSafe('```ui:chart\n{"a":').openFence).toBe('ui:chart'); // 생성형 UI 블록 = 덜 옴 → 뼈대
    expect(streamSafe('```ui:chart\r\n{"a":').openFence).toBe('ui:chart'); // CRLF 도 같다
    expect(streamSafe('**첫 줄\n둘').text).toBe('**첫 줄\n둘**'); // 줄을 넘는 굵게도 닫는다
    expect(streamSafe('**첫 줄\n').text).toBe('**첫 줄**\n');
    expect(streamSafe('## 제목 **a\n본문').text).toBe('## 제목 **a\n본문'); // 제목 줄은 다른 블록 → 본문 끝에 닫지 않는다
    expect(streamSafe('- 하나\n* 둘 **굵').text).toBe('- 하나\n* 둘 **굵**'); // 둘째 줄 맨 앞 '* ' = 목록 기호
    expect(streamSafe('글\n-').text).toBe('글\n'); // '-' 하나 = 목록 · 구분선 · 제목 밑줄이 될 수 있다 → 잠깐 숨김
    expect(streamSafe('글\n##').text).toBe('글\n');
  });

  test('생각 요약: 생각 글이 없으면 "N초 동안 생각함" 을 쓰지 않는다 · 조각 = 칸 나눔', async () => {
    const { doneSummary } = (await import(TRACE_MODULE)) as { doneSummary: Summary };
    const base = {
      runId: 'r', status: 'done', failure: null, failureDetail: null, parts: [], steps: [], model: null, reasoning: 'low',
      startedAt: 0, durationMs: 1200, usage: null, fromHistory: false,
    };
    const empty = { kind: 'reasoning', id: 'r0', text: '', live: false, ms: 3, at: 0 } as const;
    const tool = { kind: 'tool', id: 't', name: 'calculator', label: '계산기', argsText: '', args: {}, result: { result: 1 }, status: 'done', ms: 5, at: 0 } as const;
    // 시작 · 끝 신호만 온 빈 생각 + 생각 토큰 0 = 생각을 건너뜀
    expect(doneSummary({ ...base, parts: [empty], usage: { input_tokens: 1, output_tokens: 1, requests: 1, tool_calls: 0, reasoning_tokens: 0 } }))
      .toEqual(['생각 없이 바로 답함', '1.2초']);
    // 글 없이 토큰만 = 시간 없이 '생각함'
    expect(doneSummary({ ...base, parts: [empty, tool], usage: { input_tokens: 1, output_tokens: 1, requests: 2, tool_calls: 1, reasoning_tokens: 30 } }))
      .toEqual(['생각함', '계산기 1회']);
    // 생각 글은 왔지만 너무 짧게 잰 시간 = 시간 없이
    expect(doneSummary({ ...base, parts: [{ ...empty, text: '생각', ms: 20 }] })).toEqual(['생각함']);
    expect(doneSummary({ ...base, parts: [{ ...empty, text: '생각', ms: 2300 }] })).toEqual(['2.3초 동안 생각함']);
  });

  test('펼침 속도: 밀릴수록 빨리 · 최소 속도 · 이모지를 가르지 않음', () => {
    expect(revealStep(0, 10, 16)).toBeGreaterThan(0);
    expect(revealStep(0, 1000, 16) - 0).toBeGreaterThan(revealStep(990, 1000, 16) - 990);
    expect(revealStep(5, 5, 16)).toBe(5);
    expect(revealStep(0, 100, 5000)).toBe(100);
    expect(cutAt('a😀b', 2)).toBe(3);
  });
});

async function launch() {
  const { app, win } = await launchDesktop();
  await expectHeading(win, HOME_H1);
  return { app, win };
}
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

// 마지막 답의 마크다운을 바뀔 때마다 본다: 날것 기호 · 흐르는 중 표 · 떠오르는 낱말
async function watchAnswer(win: Page) {
  await win.evaluate((raw) => {
    const w = window as any;
    w.__mdObserver?.disconnect();
    const rec = { bad: [] as string[], tableLive: false, samples: 0, fade: 0, first: 0 };
    w.__md = rec;
    const re = new RegExp(raw);
    const o = new MutationObserver(() => {
      const msg = [...document.querySelectorAll('.msg.agent:not(.fail)')].pop();
      const md = msg?.querySelector('.md');
      if (!msg || !md) return;
      const clone = md.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('.md-code').forEach((e) => e.remove());
      const t = clone.textContent ?? '';
      rec.samples++;
      if (re.test(t)) rec.bad.push(t.slice(-60));
      const txt = msg.querySelector('.md.txt')?.textContent ?? ''; // 답 글만 (생각 패널의 .md 는 뺀다)
      if (!rec.first && txt.length && msg.getAttribute('aria-busy') === 'true') rec.first = txt.length; // 처음 보인 글자 수
      if (msg.getAttribute('aria-busy') === 'true') {
        if (md.querySelector('table')) rec.tableLive = true;
        if (md.querySelector('.md-w')) rec.fade++;
      }
    });
    o.observe(document.body, { subtree: true, childList: true, characterData: true });
    w.__mdObserver = o;
  }, /\*\*|\||##|```|\]\(/.source);
}
const watched = (win: Page) => win.evaluate(() => (window as any).__md as { bad: string[]; tableLive: boolean; samples: number; fade: number; first: number });

test.describe('데스크톱: 답 글 · 생각/도구 · 모델 메뉴', () => {
  test.describe.configure({ mode: 'serial' });
  let app: ElectronApplication;
  let win: Page;
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    ({ app, win } = await launch());
  });
  test.afterAll(async () => app?.close());

  test('흐르는 답: 날것 마크다운이 한 번도 안 보이고 표는 끝나기 전에 표로 · 끝나면 블록마다 제 모양', async () => {
    await watchAnswer(win);
    await ask(win, '[fake:md] 노트북 비교해 줘');
    const answer = ui(win).last;
    await expect(answer.locator('table')).toBeVisible({ timeout: 15_000 });
    if ((await answer.getAttribute('aria-busy')) === 'true') await win.screenshot({ path: shot('desktop-md-streaming') });
    await expect(answer).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
    const rec = await watched(win);
    expect(rec.bad).toEqual([]);
    expect(rec.tableLive).toBe(true);
    expect(rec.samples).toBeGreaterThan(20);
    expect(rec.fade).toBeGreaterThan(0); // 새 낱말이 떠오른다 (움직임 줄이기가 아닐 때)
    await expect(answer.locator('.md-w')).toHaveCount(0); // 끝나면 평범한 글자

    const md = answer.locator('.md').first();
    await expect(md.locator('h3')).toHaveText('노트북 비교'); // ## → h3 (화면 h1 = 대화 제목 하나)
    const px = (sel: string) => md.locator(sel).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(await px('h3')).toBeGreaterThan(await px('p')); // ## 제목은 본문보다 크다
    await expect(md.locator('p strong').first()).toHaveText('무게');
    await expect(md.locator('em')).toHaveText('배터리');
    await expect(md.locator('p code')).toHaveText('npm ci');
    await expect(md.locator('th')).toHaveText(['모델', '무게', '배터리']);
    await expect(md.locator('tbody tr')).toHaveCount(3);
    await expect(md.locator('tbody tr').first().locator('td strong')).toHaveText('A14');
    await expect(md.locator('ul > li')).toHaveCount(2);
    await expect(md.locator('ol > li')).toHaveText(['무게를 먼저 봐요', '그다음 배터리를 봐요']);
    await expect(md.locator('blockquote')).toContainText('실제 무게는 구성에 따라 달라요.');
    await expect(md.locator('pre code')).toHaveText("const lightest = 'C13';");
    await expect(md.locator('hr')).toHaveCount(1);
    const link = md.getByRole('link', { name: '제조사 문서' });
    await expect(link).toHaveAttribute('href', 'https://example.com/laptops');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    expect(await md.evaluate((el) => el.textContent)).not.toMatch(/\*\*|\||##|```/);
    await win.screenshot({ path: shot('desktop-md-done') });
  });

  test('큰 조각(120글자)도 첫 문단부터 펼침 · 줄 넘는 굵게도 별표 없음 · 칸 안 <br> = 줄바꿈 · 인라인 코드의 &lt; 는 글자', async () => {
    await watchAnswer(win);
    await ask(win, '[fake:md-big] [fake:slow] 큰 조각');
    const answer = ui(win).last;
    await expect(answer).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
    const rec = await watched(win);
    expect(rec.bad).toEqual([]);
    expect(rec.first).toBeGreaterThan(0);
    expect(rec.first).toBeLessThan(40); // 첫 조각(120글자)이 한꺼번에 떨어지지 않는다
    const md = answer.locator('.md').first();
    await expect(md.locator('p strong').first()).toContainText('걸친 굵은 글');
    await expect(md.locator('td').nth(1).locator('br')).toHaveCount(1);
    await expect(md.locator('td').nth(1)).toHaveText('첫 줄둘째 줄');
    await expect(md.locator('td code')).toHaveText('&lt;div&gt;');
    expect(await md.evaluate((el) => el.textContent)).not.toMatch(/<br|\*\*/);
  });

  test('움직임 줄이기: 펼침 · 떠오름 없이 받은 대로 (날것 문법은 여전히 없음)', async () => {
    await win.emulateMedia({ reducedMotion: 'reduce' });
    try {
      await watchAnswer(win);
      await ask(win, '[fake:md] 한 번 더');
      await expect(ui(win).last).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
      const rec = await watched(win);
      expect(rec.bad).toEqual([]);
      expect(rec.tableLive).toBe(true);
      expect(rec.fade).toBe(0);
    } finally {
      await win.emulateMedia({ reducedMotion: 'no-preference' });
    }
  });

  test('생각 블록 ↔ 도구 블록이 다르게 · 요약은 칸 나눔(가운뎃점 없음) · 답 아래에 생각 깊이 없음', async () => {
    await ask(win, '[fake:think] 6 곱하기 7은?\n[fake:calc] 6*7');
    const answer = ui(win).last;
    await expect(answer).toContainText('계산 결과는 42예요', { timeout: 20_000 });
    await expect(answer).toHaveAttribute('aria-busy', 'false');
    const line = answer.locator('.trace-line');
    await expect(line).toHaveAttribute('data-step', 'done');
    await expect(line.locator('.trace-txt .seg')).toHaveText([/^\d+(\.\d)?초 동안 생각함$/, '계산기 1회']);
    await expect(line).toHaveAccessibleName(/^\d+(\.\d)?초 동안 생각함, 계산기 1회$/);
    await expect(line).not.toHaveAccessibleName(/0\.0초/);
    expect(await line.textContent()).not.toContain('·');
    // 답 아래 = 모델 · 걸린 시간만 (생각 깊이 · 가운뎃점 없음)
    const by = answer.locator('.by');
    await expect(by).not.toContainText('생각');
    expect(await by.textContent()).not.toContain('·');

    await line.click();
    const panel = answer.getByRole('region', { name: '생각과 도구 사용 과정' });
    const blocks = panel.locator('[data-kind]');
    await expect(blocks).toHaveCount(2);
    expect(await blocks.evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')))).toEqual(['think', 'tool']); // 나온 순서
    const think = panel.locator('[data-kind="think"]');
    const tool = panel.locator('[data-kind="tool"]');
    await expect(think.locator('.tp-h')).toContainText('생각');
    await expect(think.locator('.tp-body')).toContainText('질문을 살펴보는 중이에요');
    await expect(tool.locator('.th b')).toHaveText('계산기');
    await expect(tool.locator('.tkind')).toHaveText('도구');
    await expect(tool.locator('dl')).toContainText('결과42');
    // 모양이 다르다: 생각 = 왼쪽 선만 · 도구 = 테두리 카드
    const style = (sel: typeof think) => sel.evaluate((el) => {
      const s = getComputedStyle(el);
      return { top: s.borderTopWidth, left: s.borderLeftWidth };
    });
    expect(await style(think)).toEqual({ top: '0px', left: '2px' });
    expect(await style(tool)).toEqual({ top: '1px', left: '1px' });
    expect(await panel.locator('.tp-foot').textContent()).not.toContain('·');
    await win.screenshot({ path: shot('desktop-trace-blocks') });
  });

  test('생각 글 없이 토큰만 = 시간 없이 "생각함" (0.0초 동안 생각함 안 씀)', async () => {
    await ui(win).model.click();
    await ui(win).menu.locator('[role="option"][data-model="fake-chat-large"]').click();
    await ui(win).model.click();
    await ui(win).menu.getByRole('radiogroup', { name: '생각 깊이' }).getByRole('radio', { name: '보통', exact: true }).click();
    await win.keyboard.press('Escape');
    try {
      await ask(win, '[fake:omitted] 생각만');
      const line = ui(win).last.locator('.trace-line');
      await expect(line).toHaveAttribute('data-step', 'done', { timeout: 15_000 });
      await expect(line).toHaveAccessibleName('생각함');
    } finally {
      await ui(win).model.click();
      await ui(win).menu.getByRole('radiogroup', { name: '생각 깊이' }).getByRole('radio', { name: '끄기', exact: true }).click();
      await ui(win).menu.locator('[role="option"][data-model="fake-chat-small"]').click();
    }
  });

  test('모델 메뉴 = 최소한: 회사 아이콘 + 이름만 · API 순서 그대로 · id · 최근 사용 · 자세히 · 묶음 머리 없음', async () => {
    const admin = await adminApi();
    // 표시 이름을 id 와 다르게 → 화면 어디에도 id 가 없는지 볼 수 있다
    await admin.patch('/api/admin/models/fake-chat-small', { display_name: '작은 모델' });
    try {
      const order = (await (await userApi()).get<{ id: string }[]>('/api/models')).map((m) => m.id);
      await ui(win).model.click();
      const menu = ui(win).menu;
      const options = menu.getByRole('option');
      await expect(options).toHaveCount(order.length);
      expect(await options.evaluateAll((els) => els.map((e) => e.getAttribute('data-model')))).toEqual(order);
      const small = menu.locator('[role="option"][data-model="fake-chat-small"]');
      await expect(small).toHaveText('작은 모델');
      await expect(small).toHaveAccessibleName('작은 모델');
      await expect(small.locator('svg[data-provider="openai"]')).toHaveCount(1);
      await expect(menu).not.toContainText('fake-chat-small'); // 게이트웨이 id 없음
      await expect(menu).not.toContainText('최근 사용');
      await expect(menu).not.toContainText('기본');
      await expect(menu.locator('.mdetail, .mid, .l2, .cap, .mopt-ctx')).toHaveCount(0);
      await expect(menu.locator('h6')).toHaveText(['생각 깊이']); // 회사 묶음 머리 없음
      await expect(menu.getByRole('combobox')).toHaveCount(0); // 모델이 적으면 검색칸 없음
      await expect(menu.getByRole('listbox', { name: '모델' })).toBeFocused();
      await expect(ui(win).model).not.toHaveAttribute('title', /fake-chat-small/);
      await win.screenshot({ path: shot('desktop-model-menu-minimal'), animations: 'disabled' });
      await win.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
    } finally {
      await admin.patch('/api/admin/models/fake-chat-small', { display_name: null });
    }
  });
});
