import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { adminApi, launchDesktop, userApi, type Client } from './auth';
import { expectHeading, shot } from './helpers';
import {
  ask, chat, clearRecord, connectViaApi, disconnect, ensureTracker, idle, openTrace, recorded, toolNames, type AdminServer, type Recorded,
} from './mcp';

// slice 05 mcp-tokens (데스크톱 쪽): 모델 요청에 실리는 도구를 mock 게이트웨이 기록(FAKE_GATEWAY_RECORD)으로 센다
//   요청 1 = 기본 도구 + use_app + search_tools · `<앱>__*` 0개 → use_app 뒤 4개 이하 → 다음 턴도 그대로 (새 use_app 없음)
//   MCP 바이트 예산 = 앱 목록 한 줄 + 공개된 도구 4개만 (서버 도구 30개를 다 싣지 않는다)
// + 도구 카드: MCP 도구 = 앱 이름 · '<앱>: <도구>' · 쓰기 도구 = '쓰기' 배지 (쓰기 도구는 지금 바로 실행 · 승인은 slice 07)
const HOME_H1 = '무엇을 맡길까요?';
const BUILTIN = ['calculator', 'current_time', 'unit_convert', 'date_calc', 'text_stats'];

test.describe.configure({ mode: 'serial' });
let api: Client;
let tracker: AdminServer;
let app: ElectronApplication;
let win: Page;
let h = '';
const MARK = `tok${Date.now().toString(36)}`;
const appTools = (r: Recorded) => toolNames(r).filter((n) => n.startsWith(`${h}__`));
const toolBytes = (r: Recorded) => JSON.stringify((r.body?.tools ?? []).filter((t) => t.function.name.startsWith(`${h}__`))).length;
const calledInTurn = (r: Recorded, name: string) => {
  const msgs = r.body?.messages ?? [];
  const last = msgs.findLastIndex((m) => m.role === 'user');
  return msgs.slice(last + 1).some((m) => m.tool_calls?.some((c) => c.function.name === name));
};

test.beforeAll(async () => {
  test.setTimeout(120_000);
  tracker = await ensureTracker(await adminApi());
  h = tracker.handle;
  api = await userApi();
  await connectViaApi(api, tracker.id); // 연결된 상태에서 토큰만 본다
  clearRecord();
  ({ app, win } = await launchDesktop());
  await expectHeading(win, HOME_H1);
});
test.afterAll(async () => {
  await app?.close();
  if (api && tracker) await disconnect(api, tracker.id);
});

test('턴 1: 요청 1 에 앱 도구 0개 → use_app 뒤 4개 이하 · 앱 목록 한 줄만', async () => {
  test.setTimeout(60_000);
  await ask(win, `[fake:app ${h} 이슈 검색] [fake:tool ${h}__search_issues {"query":"${MARK}"}] ${MARK} 이슈 찾아줘`);
  await expect(chat(win).last).toContainText('앱 결과를 받았어요', { timeout: 25_000 });
  await idle(win);
  const reqs = recorded(MARK);
  expect(reqs.length).toBeGreaterThanOrEqual(3); // use_app → 도구 → 답
  const first = reqs[0];
  const names = toolNames(first);
  for (const b of BUILTIN) expect(names).toContain(b);
  expect(names).toContain('use_app');
  expect(names).toContain('search_tools');
  expect(appTools(first)).toEqual([]);
  // 앱 목록 = 지침 안 한 줄 (설명 · 도구 정의는 안 실린다)
  const system = JSON.stringify(first.body?.messages?.filter((m) => m.role === 'system') ?? []);
  expect(system).toContain(h);
  expect(system).not.toContain('Search issues by text');
  // use_app 뒤 = 공개된 도구만 (4개 이하) · 바이트 예산
  const after = reqs.slice(1);
  for (const r of after) {
    expect(appTools(r).length).toBeGreaterThan(0);
    expect(appTools(r).length).toBeLessThanOrEqual(4);
    expect(toolBytes(r)).toBeLessThan(6_000);
  }
  expect(appTools(after[0])).toContain(`${h}__search_issues`);
});

test('턴 2: 같은 대화 = 공개된 도구가 그대로 (새 use_app 없이 바로 부른다)', async () => {
  test.setTimeout(60_000);
  const m2 = `${MARK}b`;
  await ask(win, `[fake:tool ${h}__search_issues {"query":"${m2}"}] ${m2} 한 번 더`);
  await expect(chat(win).last).toContainText('앱 결과를 받았어요', { timeout: 25_000 });
  await idle(win);
  const reqs = recorded(m2);
  const first = reqs[0];
  expect(appTools(first)).toContain(`${h}__search_issues`);
  expect(appTools(first).length).toBeLessThanOrEqual(4);
  expect(reqs.some((r) => calledInTurn(r, 'use_app'))).toBe(false);
});

test('도구 카드: 앱 고르기 = 고른 도구 수 · MCP 도구 = 앱 이름 · 쓰기 도구 = 쓰기 배지', async () => {
  test.setTimeout(60_000);
  const m3 = `${MARK}c`;
  await ask(win, `[fake:app ${h} 이슈 만들기] [fake:tool ${h}__create_issue {"team":"ENG","title":"${m3}"}] ${m3} 이슈 만들어줘`);
  await expect(chat(win).last).toContainText('앱 결과를 받았어요', { timeout: 25_000 });
  await idle(win);
  const panel = await openTrace(win);
  const pick = panel.locator('[data-tool="use_app"]');
  await expect(pick.locator('.th b')).toHaveText(`앱: ${tracker.name}`);
  await expect(pick).toContainText(new RegExp(`${tracker.name}에서 쓸 도구 [1-4]개를 골랐어요`));
  await expect(pick).toContainText('Create Issue (쓰기)');
  const write = panel.locator(`[data-tool="${h}__create_issue"]`);
  await expect(write).toHaveAttribute('data-write', 'true');
  await expect(write.locator('.twrite')).toHaveText('쓰기');
  await expect(write.locator('.th b')).toContainText(`${tracker.name}:`);
  await expect(write.locator('.ttile [data-icon="plug"]')).toHaveCount(1);
  await win.screenshot({ path: shot('desktop-mcp-tool-cards'), animations: 'disabled' });
  await win.emulateMedia({ colorScheme: 'dark' });
  await win.screenshot({ path: shot('desktop-mcp-tool-cards-dark'), animations: 'disabled' });
  await win.emulateMedia({ colorScheme: 'light' });
  // 활동 단계 = app:<handle> (tool:use_app 대신)
  const runs = await api.get<{ steps: { name: string; label: string }[] }[]>('/api/runs');
  const steps = runs.flatMap((r) => r.steps);
  expect(steps.some((s) => s.name === `app:${h}`)).toBe(true);
  expect(steps.some((s) => s.name === 'tool:use_app')).toBe(false);
});
