// BrewAI 데스크톱 셸 (사용자 앱). 화면 = renderer/ 를 vite build 한 dist/ 를 app://brewai 로 띄운다.
// 보안 기본값: contextIsolation·sandbox 켬, nodeIntegration 끔, preload 없음, 앱 밖 요청·이동·권한은 전부 막는다.
// 게이트웨이·Langfuse 키는 넣지 않는다. 데스크톱은 우리 API 만 부른다 (AGENTS.md · ADR-0004).
const { app, BrowserWindow, nativeTheme, net, protocol, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');

const isMac = process.platform === 'darwin';
const DIST = path.join(__dirname, 'dist');
const HOST = 'brewai';
const START_URL = `app://${HOST}/index.html`;
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

// 개발: scripts/dev.mjs 가 Vite 주소를 BREWAI_DEV_URL 로 넘긴다. 배포본은 무시하고, 이 PC 주소만 받는다.
const DEV = (() => {
  const raw = process.env.BREWAI_DEV_URL;
  if (!raw || app.isPackaged) return null;
  try {
    const url = new URL(raw);
    if (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return url;
  } catch {}
  console.warn('[brewai] BREWAI_DEV_URL 무시:', raw);
  return null;
})();

// design/prototype.html 의 --side · --fg 와 같은 색 (창 배경 · 윈도우 창 버튼 overlay)
const frame = () => nativeTheme.shouldUseDarkColors
  ? { color: '#161618', symbolColor: '#ececee', height: 40 }
  : { color: '#f7f7f8', symbolColor: '#1d1d1f', height: 40 };

// app:// 을 https 처럼 다룬다 (secure context · fetch · 같은 출처). ready 전에 등록해야 한다.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
app.setName('BrewAI'); // 사용자 데이터 폴더 이름 (@brewai/desktop 대신)

// dist/ 안쪽 파일인가. 경로로 비교한다 (윈도우 드라이브 글자 대소문자는 path.relative 가 맞춰 준다).
function inDist(file) {
  const rel = path.relative(DIST, file);
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel) && !rel.includes('\0');
}

// app://brewai/<경로> → dist/<경로>. MIME 은 net.fetch(file:) 가 정한다. dist 밖을 가리키면 거절.
async function serve(request) {
  const url = new URL(request.url);
  let file = '';
  try {
    const rel = decodeURIComponent(url.pathname);
    file = path.join(DIST, rel === '/' ? 'index.html' : rel);
  } catch {}
  if (url.host !== HOST || !file || !inDist(file)) {
    return new Response('Bad Request', { status: 400, headers: { 'content-type': 'text/plain' } });
  }
  const stat = await fs.promises.stat(file).catch(() => null);
  if (!stat || !stat.isFile()) {
    return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } });
  }
  try {
    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(res.headers);
    headers.set('Content-Security-Policy', CSP);
    return new Response(res.body, { status: res.status, headers });
  } catch (err) {
    console.error('[brewai] 파일을 읽지 못했어요:', file, err);
    return new Response('Internal Error', { status: 500, headers: { 'content-type': 'text/plain' } });
  }
}

// 요청은 app: · data: · DevTools 만. 개발 중엔 Vite 주소와 그 HMR(ws) 만 더한다.
// file: 은 serve() 가 net.fetch 로 읽는 dist/ 안쪽만 (이 net.fetch 도 여기를 거친다).
function allowed(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol === 'app:' || url.protocol === 'data:' || url.protocol === 'devtools:') return true;
    if (url.protocol === 'file:') return inDist(fileURLToPath(url));
    return DEV !== null && (url.origin === DEV.origin || (url.protocol === 'ws:' && url.host === DEV.host));
  } catch {
    return false;
  }
}

// 창 안에서 이동해도 되는 주소 (앱 자신만)
function inApp(raw) {
  try {
    const url = new URL(raw);
    return DEV ? url.origin === DEV.origin : url.protocol === 'app:' && url.host === HOST;
  } catch {
    return false;
  }
}

function lockDown(ses) {
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !allowed(details.url) }));
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: frame().color,
    titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 16, y: 13 } } : { titleBarOverlay: frame() }),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.on('will-navigate', (event) => {
    if (!inApp(event.url)) event.preventDefault();
  });
  // 새 창은 열지 않는다. https 링크만 시스템 브라우저로.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  win.loadURL(DEV ? DEV.href : START_URL).catch((err) => console.error('[brewai] 화면을 열지 못했어요:', err.message));
  return win;
}

app.whenReady().then(() => {
  lockDown(session.defaultSession);
  protocol.handle('app', serve);
  if (!DEV && !fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error('[brewai] dist/ 가 없어요 → npm run build -w apps/desktop (개발은 npm run desktop)');
  }
  nativeTheme.on('updated', () => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.setBackgroundColor(frame().color);
      if (!isMac) win.setTitleBarOverlay(frame());
    }
  });
  createWindow();
  // 맥: 창을 다 닫아도 앱은 남고, Dock 을 누르면 다시 연다
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
