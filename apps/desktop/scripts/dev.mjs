// 개발 실행: Vite 개발 서버(5173) 를 띄우고, Electron 이 그 주소(BREWAI_DEV_URL) 를 연다.
// Electron 을 닫으면 서버도 닫는다. 셸을 거치지 않아서 윈도우·맥 같은 방식으로 돈다.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import electron from 'electron'; // Node 에서 불러오면 Electron 실행 파일 경로(문자열)
import { createServer } from 'vite';
import { apiOrigin } from '../api-url.cjs'; // main.js 와 같은 검사 → 같은 값

const appDir = fileURLToPath(new URL('..', import.meta.url));
const API = apiOrigin(process.env.BREWAI_API_URL);
// 개발 중엔 화면을 Vite 가 준다 → app:// 대신 Vite 가 /config.json 을 같은 모양으로 준다
const brewaiConfig = {
  name: 'brewai-config',
  configureServer(s) {
    s.middlewares.use('/config.json', (_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.setHeader('cache-control', 'no-store');
      res.end(JSON.stringify({ apiUrl: API }));
    });
  },
};

const server = await createServer({
  configFile: fileURLToPath(new URL('../vite.config.mts', import.meta.url)),
  server: { port: 5173, strictPort: true },
  plugins: [brewaiConfig],
});
await server.listen();
server.printUrls();

const env = { ...process.env, BREWAI_DEV_URL: server.resolvedUrls?.local[0] ?? 'http://localhost:5173/' };
delete env.ELECTRON_RUN_AS_NODE; // 켜져 있으면 Electron 이 창 없이 Node 로만 돈다

const child = spawn(electron, ['.'], { cwd: appDir, env, stdio: 'inherit' });

let closing = false;
let userStop = false; // Ctrl+C 로 끈 건 정상 종료 (윈도우는 child.kill 이 강제 종료라 코드가 없다)
async function stop(code) {
  if (closing) return;
  closing = true;
  await server.close();
  process.exit(code);
}
child.on('exit', (code) => stop(userStop ? 0 : code ?? 1));
child.on('error', (err) => {
  console.error('[brewai] Electron 을 실행하지 못했어요:', err.message);
  stop(1);
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    userStop = true;
    child.kill(signal);
  });
}
