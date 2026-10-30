// main 프로세스 다리 (preload.cjs 가 여는 window.brewai) — 로그인만. 토큰은 여기로 오지 않는다 (ADR-0010).
// 모양은 apps/desktop/preload.cjs 와 같다. 브라우저에서 열면(다리 없음) 'no_bridge' → 로그인 화면이 데스크톱 앱을 안내한다.

export type BridgeStatus = 'checking' | 'signed_in' | 'signed_out';
export type BridgeReason = 'offline' | 'expired' | null;
// user = GET /api/me 모양 (features/auth/api.ts 의 toMe 가 읽는다)
export type BridgeState = { status: BridgeStatus; reason: BridgeReason; user: unknown };
// 실패 code = conductor detail (invalid_credentials …) 또는 main 의 것 (offline · timeout · cancelled · loopback_failed · browser_failed)
export type BridgeResult = { ok: true; linked?: boolean } | { ok: false; code: string; retryAfter?: number | null };

export type DesktopBridge = {
  auth: {
    state: () => Promise<BridgeState>;
    retry: () => Promise<BridgeState>;
    login: (input: { email: string; password: string }) => Promise<BridgeResult>;
    signup: (input: { code: string; email: string; password: string; display_name?: string }) => Promise<BridgeResult>;
    refresh: () => Promise<boolean>;
    logout: () => Promise<BridgeResult>;
    google: (input: { invite?: string; link?: boolean }) => Promise<BridgeResult>;
    cancelGoogle: () => Promise<boolean>;
    onChange: (fn: (state: BridgeState) => void) => () => void;
  };
};

declare global {
  interface Window {
    brewai?: DesktopBridge;
  }
}

export const bridge: DesktopBridge | null = typeof window !== 'undefined' && window.brewai ? window.brewai : null;

// IPC 가 막히면(API 주소 없음 등) 서버 꺼짐과 같게
export async function viaBridge<T>(run: (b: DesktopBridge) => Promise<T>, fallback: T): Promise<T> {
  if (!bridge) return fallback;
  try {
    return await run(bridge);
  } catch {
    return fallback;
  }
}
