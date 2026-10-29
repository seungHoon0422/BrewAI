// 개발 실행: Vite 개발 서버(5173) 를 띄우고, Electron 이 그 주소(BREWAI_DEV_URL) 를 연다.
// Electron 을 닫으면 서버도 닫는다. 셸을 거치지 않아서 윈도우·맥 같은 방식으로 돈다.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import electron from 'electron'; // Node 에서 불러오면 Electron 실행 파일 경로(문자열)
import { createServer } from 'vite';

const appDir = fileURLToPath(new URL('..', import.meta.url));

const server = await createServer({
  configFile: fileURLToPath(new URL('../vite.config.mts', import.meta.url)),
  server: { port: 5173, strictPort: true },
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
