// 로그인 상태 = 앱 전체 store. 원본은 main (lib/bridge.ts) — 여기는 그 사본 + 서버 정보(GET /api/auth/state) + 화면 상태.
// 다른 기능은 currentMe() · useMe() 로 '나' 를 읽는다 (닉네임 · 조직 · 내 스페이스).
import { codeOf } from '../../lib/api';
import { bridge, viaBridge, type BridgeReason, type BridgeResult, type BridgeState } from '../../lib/bridge';
import { createStore } from '../../lib/store';
import { DEFAULT_PASSWORD_MIN, getServerInfo, previewInvite, resetPassword, serverHost, toMe, type InvitePreview, type Me, type ServerInfo } from './api';

export type AuthView = 'login' | 'invite' | 'reset';
export type AuthState = {
  status: 'checking' | 'signed_in' | 'signed_out' | 'no_bridge';
  reason: BridgeReason;
  me: Me | null;
  everSignedIn: boolean; // 이 창에서 한 번이라도 로그인 → 만료 때 게이트를 덮개로 (화면 · 쓰던 글을 둔다)
  server: { status: 'checking' | 'ok' | 'offline'; info: ServerInfo | null; host: string | null };
  view: AuthView;
  googlePending: boolean;
  notice: string | null; // 로그인 화면 위 한 줄 (예: 비밀번호를 바꿨어요)
};

const store = createStore<AuthState>({
  status: bridge ? 'checking' : 'no_bridge', reason: null, me: null, everSignedIn: false,
  server: { status: 'checking', info: null, host: null }, view: 'login', googlePending: false, notice: null,
});
const set = store.set;

export const useAuth = store.use;
export const watchAuth = store.watch;
export const currentMe = () => store.get().me;
// 로그인한 화면 안에서만 (AuthGate 가 me 없이는 그리지 않는다)
export const useMe = () => store.use((s) => s.me) as Me;
export const usePasswordMin = () => store.use((s) => s.server.info?.passwordMin ?? DEFAULT_PASSWORD_MIN);

function apply(b: BridgeState) {
  const me = toMe(b.user);
  const before = store.get().me;
  // 다른 사람으로 로그인 = 이전 사람의 대화 · 스페이스가 메모리에 남지 않게 새로 연다
  if (before && me && before.id !== me.id) {
    location.reload();
    return;
  }
  set((s) => ({
    ...s,
    status: b.status,
    reason: b.reason,
    me: b.status === 'signed_in' ? me : s.me, // 게이트 덮개 동안에도 아래 화면이 '나' 를 읽는다
    everSignedIn: s.everSignedIn || b.status === 'signed_in',
    view: b.status === 'signed_in' ? 'login' : s.view,
  }));
}

export async function checkServer() {
  set((s) => ({ ...s, server: { ...s.server, status: 'checking' } }));
  const host = await serverHost();
  try {
    const info = await getServerInfo();
    set((s) => ({ ...s, server: { status: 'ok', info, host } }));
  } catch {
    set((s) => ({ ...s, server: { ...s.server, status: 'offline', host } }));
  }
}

let started = false;
export function startAuth() {
  if (started || !bridge) return;
  started = true;
  bridge.auth.onChange(apply);
  void viaBridge((b) => b.auth.state(), { status: 'signed_out', reason: 'offline', user: null } as BridgeState).then(apply);
  void checkServer();
}

// 서버가 꺼져 있었으면: 서버 정보 + 저장된 로그인 다시
export async function retryServer() {
  await checkServer();
  if (store.get().status === 'signed_out' && store.get().reason === 'offline') {
    apply(await viaBridge((b) => b.auth.retry(), { status: 'signed_out', reason: 'offline', user: null } as BridgeState));
  }
}

export const showView = (view: AuthView, notice: string | null = null) => set((s) => ({ ...s, view, notice }));

const OFFLINE: BridgeResult = { ok: false, code: 'offline' };

export const login = (email: string, password: string) => viaBridge((b) => b.auth.login({ email: email.trim(), password }), OFFLINE);

export const signup = (input: { code: string; email: string; password: string; display_name?: string }) =>
  viaBridge((b) => b.auth.signup({ ...input, email: input.email.trim() }), OFFLINE);

// Google — 로그인 · 초대 가입(invite) · 설정 › 계정 연결(link). 끝날 때까지(최대 5분) 기다린다
export async function continueWithGoogle(input: { invite?: string; link?: boolean } = {}): Promise<BridgeResult> {
  set((s) => ({ ...s, googlePending: true }));
  try {
    return await viaBridge((b) => b.auth.google(input), OFFLINE);
  } finally {
    set((s) => ({ ...s, googlePending: false }));
  }
}
export const cancelGoogle = () => viaBridge((b) => b.auth.cancelGoogle(), false);

// 공개 경로 (토큰 없음 · renderer 가 바로). 결과 모양 = 위 bridge 결과처럼 {ok, code} — 화면은 문구만 고른다
export type Outcome<T = undefined> = { ok: true; data: T } | { ok: false; code: string };

export async function previewCode(code: string): Promise<Outcome<InvitePreview>> {
  try {
    return { ok: true, data: await previewInvite(code) };
  } catch (e) {
    return { ok: false, code: codeOf(e) ?? 'server' };
  }
}

export async function resetWithCode(code: string, password: string): Promise<Outcome> {
  try {
    await resetPassword(code, password);
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, code: codeOf(e) ?? 'server' };
  }
}

// 로그아웃 = 세션 폐기 → 이 창의 모든 상태를 버리고 게이트부터
export async function logout() {
  await viaBridge((b) => b.auth.logout(), OFFLINE);
  location.reload();
}

// 계정 화면이 바꾼 '나' (PATCH /api/me 응답)
export const setMe = (me: Me) => set((s) => ({ ...s, me }));
