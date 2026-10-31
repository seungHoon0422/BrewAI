// 카탈로그 상태 = Skill 목록 · MCP 서버 목록(전체 공통) · 서버 하나(자세히 · 도구) · 사용자 추가 서버 · 정책. 컴포넌트는 fetch 하지 않는다
import { useCallback, useEffect, useRef, useState } from 'react';
import { LOAD_FAILED } from '../../shared/copy';
import { codeOf, isConductorDown } from '../../shared/http';
import { errorText, useLoad } from '../../shared/load';
import { useToast } from '../../shared/toast';
import {
  addMcpServer, deleteMcpServer, getMcpPolicy, getMcpServer, listAdminSkills, listMcpServers, listMcpTools, listUserServers, patchMcpPolicy,
  patchMcpServer, patchMcpTool, putOAuthClient, setUserServerStatus, testMcpServer,
  type AdminServer, type ClientIn, type McpPolicy, type NewServer, type Preview, type ServerPatch, type SkillCatalog, type TestResult, type ToolPatch,
} from './api';
import { ADD_COPY, CATALOG_COPY as C, MCP_ERROR, MCP_OTHER, OAUTH_ERROR } from './copy';

export type SkillLoad = { kind: 'loading' } | { kind: 'ok'; data: SkillCatalog } | { kind: 'error'; text: string };

export function useSkills() {
  const [state, setState] = useState<SkillLoad>({ kind: 'loading' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const ctrl = new AbortController();
    setState({ kind: 'loading' });
    listAdminSkills(ctrl.signal).then(
      (data) => setState({ kind: 'ok', data }),
      (e) => {
        if ((e as Error).name === 'AbortError') return;
        setState({ kind: 'error', text: isConductorDown(e) ? C.conductorDown : C.loadFailed });
      },
    );
    return () => ctrl.abort();
  }, [tick]);
  return { state, retry: () => setTick((t) => t + 1) };
}

// MCP 실패 → 한 줄. 표에 없는 oauth_<code> · mcp_<code> 는 묶어서 (code 는 괄호로 남긴다)
export function mcpErrorText(e: unknown): string {
  const code = codeOf(e);
  if (code && MCP_ERROR[code]) return MCP_ERROR[code];
  if (code?.startsWith('oauth_')) return OAUTH_ERROR(code);
  if (code?.startsWith('mcp_')) return MCP_OTHER(code);
  return errorText(e, MCP_ERROR, LOAD_FAILED.conductor);
}
export const testCodeText = (code: string) =>
  MCP_ERROR[code] ?? (code.startsWith('oauth_') ? OAUTH_ERROR(code) : code.startsWith('mcp_') ? MCP_OTHER(code) : code);

// 바꾸기 하나 = 바쁨(무엇이 바쁜지 id) → 성공 알림 + 새로 읽기 | 실패 알림. 성공하면 결과 (실패 = null)
function useMcpTask(after: () => Promise<void>) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(async <T,>(task: () => Promise<T>, done: string | ((r: T) => string) | null, id = ''): Promise<T | null> => {
    setBusy(id);
    try {
      const r = await task();
      if (done) toast({ tone: 'ok', title: typeof done === 'function' ? done(r) : done });
      await after();
      return r;
    } catch (e) {
      toast({ tone: 'danger', title: mcpErrorText(e) });
      return null;
    } finally {
      setBusy(null);
    }
  }, [after, toast]);
  return { busy, run };
}

// 지금 시각 ('3분 전' 이 흐르게 30초마다 · 테스트 결과가 오면 바로)
export function useNow(tick = 0) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [tick]);
  return now;
}

/* ── 연결 테스트 (줄마다 · 그 자리에서 결과) ─────────────── */
export type TestState = { phase: 'running' } | { phase: 'done'; r: TestResult } | { phase: 'error'; text: string };

export function useTests(after: () => Promise<void>) {
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const running = useRef(new Set<string>());
  const test = useCallback(async (s: AdminServer) => {
    if (running.current.has(s.id)) return; // 두 번 누름
    running.current.add(s.id);
    setTests((t) => ({ ...t, [s.id]: { phase: 'running' } }));
    try {
      const r = await testMcpServer(s.id);
      setTests((t) => ({ ...t, [s.id]: { phase: 'done', r } }));
      await after(); // 도구 수 · 예상 토큰 · 마지막 확인이 바뀐다
    } catch (e) {
      setTests((t) => ({ ...t, [s.id]: { phase: 'error', text: mcpErrorText(e) } }));
    } finally {
      running.current.delete(s.id);
    }
  }, [after]);
  return { testOf: (id: string) => tests[id], test };
}

/* ── 전체 공통 서버 목록 + 추가 ───────────────────────── */
export type AddResult = { server: AdminServer; preview: Preview | null; client: 'saved' | 'skipped' | 'failed' | null; clientError?: string };

export function useMcpServers() {
  const load = useLoad(listMcpServers);
  const { busy, run } = useMcpTask(load.refresh);
  const tests = useTests(load.refresh);
  const toast = useToast();
  // 추가 → (사전 등록 client 가 있으면) 저장. 서버는 추가됐는데 client 만 실패하면 결과 화면에서 알린다
  const add = useCallback(async (body: NewServer, client: ClientIn | null): Promise<AddResult | null> => {
    const out = await run(() => addMcpServer(body), null, 'add');
    if (!out) return null;
    let state: AddResult['client'] = null;
    let clientError: string | undefined;
    if (client) {
      if (out.server.auth !== 'oauth') state = 'skipped';
      else {
        try {
          await putOAuthClient(out.server.id, client);
          state = 'saved';
          await load.refresh();
        } catch (e) {
          state = 'failed';
          clientError = mcpErrorText(e);
          toast({ tone: 'danger', title: ADD_COPY.clientFailed(clientError) });
        }
      }
    }
    return { ...out, client: state, clientError };
  }, [run, load, toast]);
  return { ...load, ...tests, adding: busy === 'add', add };
}

/* ── 서버 하나 (자세히 페이지) ─────────────────────────── */
export function useMcpServer(id: string) {
  // 없는 서버(지워짐 · 잘못된 주소) = null → '없는 MCP 서버' 안내 (오류 아님)
  const server = useLoad((signal) => getMcpServer(id, signal).catch((e) => {
    if (codeOf(e) === 'mcp_server_not_found') return null;
    throw e;
  }), id);
  const tools = useLoad((signal) => listMcpTools(id, signal).catch((e) => {
    if (codeOf(e) === 'mcp_server_not_found') return { tools: [], fetched_at: null };
    throw e;
  }), id);
  const refreshServer = server.refresh;
  const refreshTools = tools.refresh;
  const after = useCallback(async () => {
    await Promise.all([refreshServer(), refreshTools()]);
  }, [refreshServer, refreshTools]);
  const { busy, run } = useMcpTask(after);
  const tests = useTests(after);
  return {
    server,
    tools,
    ...tests,
    busy,
    change: (patch: ServerPatch, done: string) => run(() => patchMcpServer(id, patch), done, 'server'),
    setStatus: (s: AdminServer, next: 'active' | 'disabled', done: string) =>
      run(() => (s.origin === 'user' ? setUserServerStatus(id, next) : patchMcpServer(id, { status: next })), done, 'status'),
    remove: (done: string) => run(() => deleteMcpServer(id), done, 'remove'),
    setTool: (patch: ToolPatch, done: string) => run(() => patchMcpTool(id, patch), done, `tool:${patch.tool}`),
    setClient: (body: ClientIn, done: string) => run(() => putOAuthClient(id, body), done, 'client'),
  };
}

/* ── 사용자 추가 서버 + 정책 ──────────────────────────── */
export function useUserServers() {
  const load = useLoad(listUserServers);
  const { busy, run } = useMcpTask(load.refresh);
  return {
    ...load,
    busy,
    setStatus: (s: AdminServer, next: 'active' | 'disabled', done: string) => run(() => setUserServerStatus(s.id, next), done, s.id),
  };
}

export function useMcpPolicy() {
  const load = useLoad(getMcpPolicy);
  const { busy, run } = useMcpTask(load.refresh);
  return { ...load, busy: busy !== null, save: (patch: Partial<McpPolicy>, done: string) => run(() => patchMcpPolicy(patch), done) };
}
