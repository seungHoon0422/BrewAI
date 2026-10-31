// 연결된 앱 상태 = 앱 전체 store. 연결된 앱 화면 · 대화 카드(연결 필요 · 이어서 하기) · 활동 단계 이름(app:<handle>)이 같이 본다.
// 연결(로그인) = main 이 시스템 브라우저로 (bridge.mcp.connect) → 끝나면 목록을 다시 읽는다. 서버가 권한의 근거다 (UI 는 아님).
import { useMemo } from 'react';
import type { DotState } from '@brewai/ui';
import { failureOf, type Failure } from '../../lib/api';
import { bridge, type McpConnectResult } from '../../lib/bridge';
import { createStore, single } from '../../lib/store';
import { useScopeState } from '../scope/hooks';
import { MEMBERSHIP, TENANT } from '../scope/model';
import { listApps, setAutoAuth, type App, type AppList, type AutoAuth, type ShareKind } from './api';
import type { AppStateKey } from './copy';

export type ConnState = {
  apps: { status: 'loading' | 'ready' | 'error'; data: AppList | null; error: Failure | null };
  connecting: Record<string, true>; // server id → 브라우저에서 로그인 중
  focus: string | null; // 열어 둘 앱 상세 (대화 카드 '연결된 앱 열기' → 그 앱)
  version: number; // 연결 · 가져오기 · 끊기마다 +1 (상세 서랍이 다시 읽는다)
};

const store = createStore<ConnState>({ apps: { status: 'loading', data: null, error: null }, connecting: {}, focus: null, version: 0 });
const set = store.set;

export const useConnections = store.use;
export const watchConnections = store.watch;
export const appById = (id: string): App | null => store.get().apps.data?.mine.find((a) => a.id === id) ?? null;
// 활동 단계 app:<handle> 의 화면 이름 (모르면 handle 그대로)
export const appLabels = (): Record<string, string> => Object.fromEntries((store.get().apps.data?.mine ?? []).map((a) => [a.handle, a.name]));
export const autoAuthNow = (): AutoAuth => store.get().apps.data?.auto_auth ?? 'unset';
// 바로 쓸 수 있나 (연결됨 · 인증 없음 · 꺼지지 않음)
export const isReady = (a: App | null | undefined) => !!a && a.usable && (a.connection === 'connected' || a.connection === 'none');

export const loadApps = single(async () => {
  try {
    const data = await listApps();
    set((s) => ({ ...s, apps: { status: 'ready', data, error: null } }));
  } catch (e) {
    set((s) => ({ ...s, apps: { ...s.apps, status: s.apps.data ? 'ready' : 'error', error: failureOf(e) } }));
  }
});

export const bump = () => {
  set((s) => ({ ...s, version: s.version + 1 }));
  return loadApps();
};

// 시스템 브라우저로 로그인 → loopback → conductor 가 토큰을 금고에. 결과에 토큰 없음. 다리 없음(브라우저로 연 화면) = no_bridge
export async function connectApp(serverId: string, scope?: string | null): Promise<McpConnectResult> {
  if (!bridge?.mcp) return { ok: false, code: 'no_bridge' };
  set((s) => ({ ...s, connecting: { ...s.connecting, [serverId]: true } }));
  try {
    return await bridge.mcp.connect({ serverId, scope: scope ?? null });
  } catch {
    return { ok: false, code: 'offline' };
  } finally {
    set((s) => {
      const connecting = { ...s.connecting };
      delete connecting[serverId];
      return { ...s, connecting };
    });
    await bump();
  }
}

export const cancelConnect = () => (bridge?.mcp ? bridge.mcp.cancel().catch(() => false) : Promise.resolve(false));

// '필요할 때 바로 로그인 화면 열기' (기본 unset = 꺼짐으로 셈)
export async function changeAutoAuth(value: AutoAuth): Promise<AutoAuth> {
  const now = await setAutoAuth(value);
  set((s) => (s.apps.data ? { ...s, apps: { ...s.apps, data: { ...s.apps.data, auto_auth: now } } } : s));
  return now;
}

export const focusApp = (id: string | null) => set((s) => (s.focus === id ? s : { ...s, focus: id }));

// 줄 상태 하나 (공유 끊김 > 꺼짐 · 오류 > 연결) → 문구 · 점 (copy.ts STATE_LABEL)
export function stateOf(a: App): AppStateKey {
  if (a.share_lost) return 'share_lost';
  if (a.status === 'disabled' || a.blocked) return 'disabled'; // 정책에 막힘 = 꺼짐으로 보인다 (상세에 이유)
  if (a.status === 'error') return 'error';
  if (a.connection === 'connected' || a.connection === 'none') return 'connected';
  return a.connection;
}
export const STATE_DOT: Record<AppStateKey, DotState> = {
  connected: 'ok', needs_login: 'warn', expired: 'warn', share_lost: 'stop', disabled: 'idle', error: 'fail',
};

// 공유할 수 있는 곳 (화면 안내용 · 판정은 서버): 스페이스 = 내가 멤버인 공유 스페이스 · 조직 = 내가 owner · admin 인 조직
export type ShareTarget = { kind: ShareKind; id: string; name: string };
export function useShareTargets(): ShareTarget[] {
  const spaces = useScopeState((s) => s.spaces.list);
  const orgs = useScopeState((s) => s.orgs);
  return useMemo(() => [
    ...spaces.filter((x) => x.kind === 'shared' && x.joined && !x.archived_at).map((x) => ({ kind: MEMBERSHIP, id: x.id, name: x.name })),
    ...orgs.filter((o) => o.role === 'owner' || o.role === 'admin').map((o) => ({ kind: TENANT, id: o.id, name: o.name })),
  ], [spaces, orgs]);
}
