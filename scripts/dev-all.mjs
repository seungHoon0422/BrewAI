// npm run dev = 데스크톱 앱(Vite 5173 + Electron) + 관리자 콘솔(Vite 5174) 을 한 번에 띄운다.
// - 더블클릭: start.cmd (윈도우) · start.command (맥)
// - 끄기: 이 창에서 Ctrl+C, 또는 데스크톱 앱을 끄면(윈도우 = 창 닫기 · 맥 = ⌘Q) 둘 다 닫히고 포트도 비운다
// - 셸을 거치지 않는다 (shell:false). npm 은 node + npm-cli.js 로 부른다
//   → 윈도우에서 npm.cmd 를 shell 없이 부르면 EINVAL(CVE-2024-27980 이후)이고, PowerShell 의 npm.ps1 실행 정책과도 무관하다
// - 의존성 없음 (Node 기본 모듈만). 옵션: --no-open 또는 BREWAI_NO_OPEN=1 → 브라우저를 열지 않는다
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const WIN = process.platform === 'win32';
const ADMIN_URL = 'http://localhost:5174/';
const PORTS = [
  { port: 5173, what: '데스크톱 개발 서버' },
  { port: 5174, what: '관리자 콘솔' },
];
const NO_OPEN = process.argv.includes('--no-open') || process.env.BREWAI_NO_OPEN === '1';
const TTY = process.stdout.isTTY;
const color = (code, s) => (TTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const say = (msg) => console.log(`${color('1', '[brewai]')} ${msg}`);
const ps = (cmd) => (WIN ? `${cmd.replace(/^(npm|npx)\b/, '$1.cmd')}` : cmd); // 윈도우는 npm.cmd 로 안내 (PowerShell 정책 회피)

function fail(...lines) {
  console.error(`\n${color('31;1', '[brewai]')} ${lines.join('\n          ')}\n`);
  process.exit(1);
}

// ---------- 시작 전 확인 ----------

const want = fs.existsSync(path.join(root, '.nvmrc')) ? fs.readFileSync(path.join(root, '.nvmrc'), 'utf8').trim() : null;
if (want && process.versions.node !== want)
  say(color('33', `Node ${process.versions.node} 으로 돌아요 (레포는 ${want}). 이상하면 Node ${want} 로 바꾸세요.`));

const mod = (p) => path.join(root, 'node_modules', ...p.split('/'));
const missing = ['vite/package.json', 'electron/package.json', 'react/package.json', '@vitejs/plugin-react/package.json'].filter((p) => !fs.existsSync(mod(p)));
if (missing.length)
  fail(
    '의존성이 설치되어 있지 않아요 (node_modules 없음).',
    `이 폴더에서 한 번:  ${ps('npm ci')}`,
    `그다음 다시:        ${ps('npm run dev')}  (또는 start 파일 더블클릭)`,
  );

// Electron 실행 파일(~130MB)은 npm ci 가 받지 않는다. 없으면 여기서 받는다:
// 같은 고정 버전 + node_modules/electron/checksums.json(lock 에 고정된 해시)로 확인 = README 4단계의 `npx --no install-electron` 과 같은 일
function electronReady() {
  try {
    const dir = mod('electron');
    const { version } = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const got = fs.readFileSync(path.join(dir, 'dist', 'version'), 'utf8').trim().replace(/^v/, '');
    const exe = fs.readFileSync(path.join(dir, 'path.txt'), 'utf8').trim();
    return got === version && fs.existsSync(path.join(dir, 'dist', exe));
  } catch {
    return false;
  }
}
if (!electronReady()) {
  say('Electron 실행 파일이 없어서 지금 받아요 (한 번만 · ~130MB · 고정 해시로 확인)…');
  const r = spawnSync(process.execPath, [mod('electron/install.js')], { cwd: mod('electron'), stdio: 'inherit' });
  if (r.status !== 0 || !electronReady())
    fail('Electron 을 받지 못했어요 (네트워크 확인).', `직접 받기:  ${ps('npx --no install-electron')}`, `그다음 다시:  ${ps('npm run dev')}`);
}

// 포트가 이미 쓰이면 (이전 창이 아직 떠 있음) 바로 알린다
function busy(port) {
  const one = (host) =>
    new Promise((resolve) => {
      const s = net.connect({ port, host });
      s.setTimeout(500);
      s.once('connect', () => (s.destroy(), resolve(true)));
      s.once('timeout', () => (s.destroy(), resolve(false)));
      s.once('error', () => resolve(false));
    });
  return Promise.all([one('127.0.0.1'), one('::1')]).then((r) => r.some(Boolean));
}
const taken = [];
for (const p of PORTS) if (await busy(p.port)) taken.push(p);
if (taken.length)
  fail(
    `포트 ${taken.map((p) => `${p.port}(${p.what})`).join(' · ')} 이 이미 쓰이고 있어요.`,
    '이미 떠 있는 BrewAI 창(터미널 · 데스크톱 앱)을 먼저 닫고 다시 실행하세요.',
    WIN ? `누가 쓰는지:  netstat -ano | findstr :${taken[0].port}` : `누가 쓰는지:  lsof -nP -iTCP:${taken[0].port} -sTCP:LISTEN`,
  );

// ---------- npm 찾기: node + npm-cli.js ----------

function npmCommand() {
  const dir = path.dirname(process.execPath);
  const cands = [
    process.env.npm_execpath, // npm run dev 로 왔으면 그 npm
    path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'), // 윈도우 설치본 · nvm-windows
    path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'), // 맥 · 리눅스 (nvm · 설치본)
  ];
  const cli = cands.find((p) => p && /npm-cli\.js$/.test(p) && fs.existsSync(p));
  if (cli) return [process.execPath, [cli]];
  if (!WIN) return ['npm', []]; // 맥 · 리눅스는 npm 이 실행 파일이라 셸 없이도 된다
  fail('npm 을 찾지 못했어요. Node 24 를 다시 설치하세요 (README 1단계).');
}
const [npmBin, npmPre] = npmCommand();

// ---------- 실행 ----------

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
if (TTY && !env.NO_COLOR) env.FORCE_COLOR ??= '1'; // 파이프로 받아도 색은 그대로

const children = [];
let stopping = false;
let exitCode = 0;

function start(name, tag, args) {
  // stdin = ignore: 윈도우에서 Ctrl+C 뒤 cmd 의 'Y/N?' 질문이 입력을 기다리지 않게
  // detached(맥): 자기 프로세스 그룹 → 끌 때 그룹째(npm → sh → vite/electron) 보낸다
  const child = spawn(npmBin, [...npmPre, ...args], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], detached: !WIN, windowsHide: false });
  const label = color(tag, `[${name}]`);
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8');
    readline.createInterface({ input: stream, crlfDelay: Infinity }).on('line', (line) => {
      if (stopping && /^npm (error|ERR!)/.test(line)) return; // 끌 때 npm 이 남기는 'Lifecycle script failed' 는 소음
      process.stdout.write(`${label} ${line}\n`);
    });
  }
  const c = { name, child, alive: true };
  children.push(c);
  child.on('error', (err) => {
    c.alive = false;
    console.error(`${label} 실행하지 못했어요: ${err.message}`);
    stopAll(1);
    // 실행 실패면 'exit' 가 오지 않는다 → 여기서 마무리 (안 하면 코드 0 으로 조용히 끝남)
    if (children.every((x) => !x.alive)) finish();
  });
  child.on('exit', (code, signal) => {
    c.alive = false;
    // 130 · SIGINT · 0xC000013A = 사용자가 Ctrl+C 로 끈 것.
    // 윈도우의 npm 자식은 Ctrl+C 를 받으면 자기 셸을 TerminateProcess 하고 1 로 끝난다(0xC000013A 아님)
    // → 우리 SIGINT 처리보다 먼저 올 수 있으니 윈도우에서는 잠깐 기다렸다가 판단한다
    const userStop = code === 3221225786 || code === 130 || signal === 'SIGINT';
    const settle = () => {
      if (!stopping && userStop) stopAll(0);
      if (!stopping) {
        say(`${name} 이(가) 끝났어요${code ? ` (코드 ${code})` : signal ? ` (${signal})` : ''} → 나머지도 닫아요`);
        stopAll(code ?? 0);
      }
      if (children.every((x) => !x.alive)) finish();
    };
    if (WIN && !stopping) setTimeout(settle, 300);
    else settle();
  });
  return c;
}

function kill(c, hard = false) {
  const pid = c.child.pid;
  if (!pid) return;
  if (WIN) {
    // 윈도우 child.kill = 그 프로세스만 강제 종료 → 손자(vite · electron)가 남는다. /T = 트리째
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  try {
    process.kill(-pid, hard ? 'SIGKILL' : 'SIGTERM'); // 그룹째
  } catch {
    /* 이미 끝남 */
  }
}

function stopAll(code) {
  if (stopping) return;
  stopping = true;
  exitCode = code;
  for (const c of children) if (c.alive) kill(c);
  setTimeout(() => {
    for (const c of children) kill(c, true);
    finish();
  }, 6000).unref();
}

// 다 끝나면 포트가 비었는지 보고 나간다 (남은 손자는 그룹째 강제 종료)
let finishing = false;
async function finish() {
  if (finishing) return;
  finishing = true;
  for (let i = 0; i < 20; i++) {
    const left = [];
    for (const p of PORTS) if (await busy(p.port)) left.push(p.port);
    if (!left.length) break;
    if (i === 10) for (const c of children) kill(c, true);
    await new Promise((r) => setTimeout(r, 250));
  }
  say('모두 닫았어요.');
  process.exit(exitCode);
}

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    if (!stopping) say('닫는 중… (데스크톱 · 관리자)');
    stopAll(0);
  });
}

say(`데스크톱 앱 + 관리자 콘솔을 띄워요. 끄기 = 이 창에서 Ctrl+C, 또는 ${WIN ? '데스크톱 창 닫기' : '데스크톱 앱 ⌘Q (창만 닫으면 앱이 남아요)'}`);
start('desktop', '36', ['run', 'dev', '-w', 'apps/desktop']);
start('admin', '35', ['run', 'dev', '-w', 'apps/admin']);

// 관리자 서버가 뜨면 기본 브라우저로 한 번 연다
async function waitAdmin() {
  for (let i = 0; i < 240 && !stopping; i++) {
    try {
      const r = await fetch(ADMIN_URL, { signal: AbortSignal.timeout(1000) });
      if (r.ok) return true;
    } catch {
      /* 아직 */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
if (await waitAdmin()) {
  say(`관리자 콘솔: ${color('4', ADMIN_URL)} · 데스크톱 앱은 별도 창으로 떠요`);
  if (!NO_OPEN) openBrowser(ADMIN_URL);
}

function openBrowser(url) {
  try {
    const [cmd, args, extra] = WIN
      ? ['cmd.exe', ['/d', '/c', 'start', '""', url], { windowsVerbatimArguments: true, windowsHide: true }] // start = cmd 내장 · "" = 창 제목
      : process.platform === 'darwin'
        ? ['open', [url], {}]
        : ['xdg-open', [url], {}];
    const p = spawn(cmd, args, { stdio: 'ignore', detached: !WIN, ...extra });
    p.on('error', () => say(`브라우저를 열지 못했어요 → 직접 여세요: ${url}`));
    p.unref();
  } catch {
    say(`브라우저를 열지 못했어요 → 직접 여세요: ${url}`);
  }
}
