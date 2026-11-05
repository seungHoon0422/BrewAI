// main 프로세스 다리 (preload.cjs 가 여는 window.brewai) — 로그인 · 앱 연결. 토큰은 여기로 오지 않는다 (ADR-0010 · ADR-0013).
// 모양은 apps/desktop/preload.cjs 와 같다. 브라우저에서 열면(다리 없음) 'no_bridge' → 로그인 화면이 데스크톱 앱을 안내한다.

export type BridgeStatus = 'checking' | 'signed_in' | 'signed_out';
export type BridgeReason = 'offline' | 'expired' | null;
// user = GET /api/me 모양 (features/auth/api.ts 의 toMe 가 읽는다)
export type BridgeState = { status: BridgeStatus; reason: BridgeReason; user: unknown };
// 실패 code = conductor detail (invalid_credentials …) 또는 main 의 것 (offline · timeout · cancelled · loopback_failed · browser_failed)
export type BridgeResult = { ok: true; linked?: boolean } | { ok: false; code: string; retryAfter?: number | null };

// 앱(MCP 서버) 연결 = 시스템 브라우저 로그인 → loopback → conductor 가 토큰을 금고에 (mcp-connect.cjs).
// 실패 code = conductor detail (needs_import · vault_missing · handoff_invalid …) 또는 main 의 것 (cancelled · timeout · browser_failed …)
export type McpConnectResult = { ok: true; connection: string; tool_count: number } | { ok: false; code: string };

export type DesktopBridge = {
  dev?: boolean; // 개발 빌드 (배포본 아님 · main.js additionalArguments) — 개발용 도구만 본다
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
  mcp?: {
    connect: (input: { serverId: string; scope?: string | null }) => Promise<McpConnectResult>;
    cancel: () => Promise<boolean>;
  };
  // 만든 파일 저장 (slice 08) = main 의 저장 대화상자 · code = cancelled · bad_input · write_failed
  files?: {
    save: (input: { name: string; bytes: Uint8Array }) => Promise<SaveResult>;
  };
  // 로컬 폴더 고르기 (slice 09) = main 의 폴더 대화상자 · code = cancelled. 규칙 판정은 conductor (PUT /api/projects/{id}/folder)
  folder?: {
    pick: (input?: { title?: string }) => Promise<PickResult>;
  };
};
export type SaveResult = { ok: true; name: string } | { ok: false; code: string };
export type PickResult = { ok: true; path: string } | { ok: false; code: string };

declare global {
  interface Window {
    brewai?: DesktopBridge;
  }
}

export const bridge: DesktopBridge | null = typeof window !== 'undefined' && window.brewai ? window.brewai : null;
// 개발 빌드에서만 보이는 것 (입력창 '샘플' 메뉴). 브라우저로 연 화면 · 배포본 = false
export const devBuild = bridge?.dev === true;

// IPC 가 막히면(API 주소 없음 등) 서버 꺼짐과 같게
export async function viaBridge<T>(run: (b: DesktopBridge) => Promise<T>, fallback: T): Promise<T> {
  if (!bridge) return fallback;
  try {
    return await run(bridge);
  } catch {
    return fallback;
  }
}
