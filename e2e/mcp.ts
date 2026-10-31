import { expect, type ElectronApplication, type Page } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Client } from './auth';
import { GATEWAY_RECORD, MCP } from './env';

// 앱(MCP) 연결 스펙 공용 (ADR-0013 · slice 05). 가짜 MCP + 가짜 OAuth = e2e/mock/mcp.mjs (FAKE_MCP_AUTO_APPROVE=1 = 허용 화면 없이 바로 code)
//   tracker = OAuth 보호 · 도구 30개 (읽기 18 · 쓰기 12) · notes = 인증 없음 · 도구 4개
// 데스크톱 연결 = main 이 시스템 브라우저를 연다 → 스펙은 shell.openExternal 을 바꿔 연 주소를 받고, 그 주소를 끝까지 따라간다
// (브라우저 탭 또는 fetch · 302 사슬: 가짜 AS → conductor 콜백 → 127.0.0.1 loopback ?code=bwm_)
export const TRACKER_URL = `${MCP}/mcp`;
export const NOTES_URL = `${MCP}/noauth/mcp`;

export type AdminServer = { id: string; handle: string; name: string; url: string; status: string; auth: string };
export type App = {
  id: string; handle: string; name: string; source: string; connection: string; status: string; hidden: boolean; share_lost: boolean;
  usable: boolean; tool_count: number | null;
};
export type AppList = { mine: App[]; importable: { id: string; name: string; via: unknown[] }[]; auto_auth: string };

export async function fakeMcp(what: 'account' | 'expire' | 'revoke' | 'reset', body: unknown = {}) {
  const res = await fetch(`${MCP}/__fake/${what}`, { method: 'POST', body: JSON.stringify(body) });
  expect(res.ok).toBe(true);
}
export type McpState = { account: string; calls: { server: string; tool: string; account: string; token_sha: string | null }[]; tokens: Record<string, number> };
export const mcpState = async (): Promise<McpState> => (await fetch(`${MCP}/__fake/state`)).json() as Promise<McpState>;

// 전체 공통 tracker (관리자 콘솔이 넣은 것과 같은 길 · 있으면 그대로 · 꺼져 있으면 켠다)
export async function ensureTracker(admin: Client): Promise<AdminServer> {
  const list = await admin.get<AdminServer[]>('/api/admin/mcp/servers');
  let s = list.find((x) => x.url === TRACKER_URL);
  s ??= await admin.post<AdminServer>('/api/admin/mcp/servers', { url: TRACKER_URL, name: '트래커', description: '팀 이슈와 프로젝트', aliases: ['이슈', '버그'] });
  if (s.status !== 'active') s = await admin.patch<AdminServer>(`/api/admin/mcp/servers/${s.id}`, { status: 'active' });
  return s;
}

export const myApps = (api: Client) => api.get<AppList>('/api/me/mcp/servers');
export const myApp = async (api: Client, id: string) => (await myApps(api)).mine.find((a) => a.id === id);

// 연결 끊기 (연결 없음 = 404 not_connected 도 괜찮다)
export async function disconnect(api: Client, id: string) {
  const res = await api.raw('DELETE', `/api/me/mcp/servers/${id}/connection`);
  expect([204, 404]).toContain(res.status);
}

// 브라우저 대신 fetch 로 로그인 주소를 끝까지 따라간다 (가짜 AS 자동 허용 → conductor 콜백 → loopback). 마지막 응답 = loopback 페이지
export async function followLogin(url: string): Promise<{ status: number; url: string; text: string }> {
  const res = await fetch(url, { redirect: 'follow' });
  return { status: res.status, url: res.url, text: await res.text() };
}

// API 만으로 연결 (스펙 준비용): 이 테스트 프로세스가 loopback 을 열고 start → 로그인 따라가기 → complete
export async function connectViaApi(api: Client, id: string): Promise<App> {
  const ds = crypto.randomBytes(18).toString('base64url');
  let got: (code: string) => void = () => {};
  const code = new Promise<string>((resolve) => { got = resolve; });
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1');
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    got(u.searchParams.get('code') ?? `error:${u.searchParams.get('error')}`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as AddressInfo).port;
    const { authorize_url } = await api.post<{ authorize_url: string }>(`/api/me/mcp/servers/${id}/connect/start`, { port, ds });
    await followLogin(authorize_url);
    const c = await code;
    expect(c).toMatch(/^bwm_/);
    return await api.post<App>(`/api/me/mcp/servers/${id}/connect/complete`, { code: c, ds });
  } finally {
    server.close();
    server.closeAllConnections();
  }
}

// ── 데스크톱: 시스템 브라우저를 여는 대신 주소를 모은다 (main 프로세스) ──
export async function captureBrowser(app: ElectronApplication) {
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as any).__opened = opened;
    shell.openExternal = async (url: string) => {
      opened.push(url);
    };
  });
}
export const openedCount = (app: ElectronApplication) => app.evaluate(() => (globalThis as any).__opened.length as number);
export async function nextOpened(app: ElectronApplication, before: number): Promise<string> {
  let url = '';
  await expect.poll(async () => (url = await app.evaluate((_e, n) => (globalThis as any).__opened[n] ?? '', before)), { timeout: 15_000 }).not.toBe('');
  return url;
}

// 대화 화면 손잡이 (chat-*.spec 과 같은 이름)
export const chat = (win: Page) => ({
  box: win.getByRole('textbox', { name: '요청 입력' }),
  send: win.getByRole('button', { name: '보내기', exact: true }),
  log: win.getByRole('log', { name: '대화 내용' }),
  last: win.locator('.msg.agent:not(.fail)').last(),
  cards: win.locator('.app-card'),
});
export async function ask(win: Page, text: string) {
  const ui = chat(win);
  await ui.box.fill(text);
  await ui.send.click();
}
// 끝 = aria-busy false + 상태 줄 글 폭 전환(220ms · TraceView)이 끝남 (스크린샷이 '0.2…' 처럼 잘리지 않게)
export async function idle(win: Page) {
  await expect(chat(win).last).toHaveAttribute('aria-busy', 'false', { timeout: 25_000 });
  await expect(chat(win).last.locator('.trace-txt[style*="width"]')).toHaveCount(0);
}
export async function openTrace(win: Page) {
  const line = chat(win).last.locator('.trace-line');
  if ((await line.getAttribute('aria-expanded')) !== 'true') await line.click();
  return chat(win).last.locator('.trace-panel');
}

// ── mock 게이트웨이 요청 기록 (FAKE_GATEWAY_RECORD) ──
export type Recorded = { url: string; body: { messages?: { role: string; content?: unknown; tool_calls?: { function: { name: string } }[] }[]; tools?: { function: { name: string } }[] } | null };
export function clearRecord() {
  fs.writeFileSync(GATEWAY_RECORD, '');
}
// 대화 요청 중 user 메시지에 marker 가 든 것 (나온 순서대로)
export function recorded(marker: string): Recorded[] {
  if (!fs.existsSync(GATEWAY_RECORD)) return [];
  return fs.readFileSync(GATEWAY_RECORD, 'utf8').split('\n').filter(Boolean)
    .map((l) => JSON.parse(l) as Recorded)
    .filter((r) => r.url.includes('/chat/completions') && JSON.stringify(r.body?.messages ?? []).includes(marker));
}
export const toolNames = (r: Recorded) => (r.body?.tools ?? []).map((t) => t.function.name);
