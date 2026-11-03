// 로그인 · 앱 연결 preload (sandbox · contextIsolation). renderer 에 여는 것 = window.brewai.auth · window.brewai.mcp · window.brewai.dev.
// dev = 개발 빌드인지 (main 이 배포본이 아닐 때만 --brewai-dev 를 넘긴다 · 값 하나뿐 · 비밀 없음).
// 토큰은 오가지 않는다: 결과는 {ok, code?, retryAfter?, linked?} · 상태는 {status, reason, user} 뿐 (auth.cjs)
// · 앱 연결 결과는 {ok, code?, connection?, tool_count?} 뿐 (mcp-connect.cjs).
// 모양은 renderer/src/lib/bridge.ts 의 DesktopBridge 와 같다 — 하나를 바꾸면 둘 다.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('brewai', {
  dev: process.argv.includes('--brewai-dev'),
  auth: {
    state: () => ipcRenderer.invoke('auth:state'),
    retry: () => ipcRenderer.invoke('auth:retry'),
    login: (input) => ipcRenderer.invoke('auth:login', input),
    signup: (input) => ipcRenderer.invoke('auth:signup', input),
    refresh: () => ipcRenderer.invoke('auth:refresh'),
    logout: () => ipcRenderer.invoke('auth:logout'),
    google: (input) => ipcRenderer.invoke('auth:google', input),
    cancelGoogle: () => ipcRenderer.invoke('auth:google-cancel'),
    onChange: (fn) => {
      const listener = (_event, state) => fn(state);
      ipcRenderer.on('auth:changed', listener);
      return () => ipcRenderer.removeListener('auth:changed', listener);
    },
  },
  mcp: {
    connect: (input) => ipcRenderer.invoke('mcp:connect', input),
    cancel: () => ipcRenderer.invoke('mcp:cancel'),
  },
});
