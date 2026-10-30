// scripts/stack.mjs — npm run stack[:trace|:down|:status|:logs|:reset] (ADR-0009)
// 로컬 Docker 스택. 기본 = LiteLLM 게이트웨이 + 그 전용 Postgres (관리 화면 /ui 로그인 · UI 로 모델 추가). trace = Langfuse v4 셀프호스트 묶음을 더한다. 클라우드 요금 없음.
//   up          = litellm + litellm-db             (npm run stack)
//   up trace    = litellm + Langfuse 묶음 6개       (npm run stack:trace · npm run stack -- trace)
//   up auto     = .env(또는 셸)의 BREWAI_TRACE=1 일 때만 trace (npm run dev 가 부른다)
//   down        = 전부 내린다 (데이터 볼륨은 남는다) · reset --yes = 볼륨까지 지운다 (trace·계정·UI 로 넣은 모델 초기화)
//   secrets     = Docker 없이 .env 의 첫 관리자 계정(BREWAI_ADMIN_EMAIL · BREWAI_ADMIN_PASSWORD)만 만든다 (BREWAI_STACK=0 인 PC)
// - 처음 실행: .env 에 없는(또는 빈) 비밀값만 만들어 넣는다. 이미 있는 값은 절대 덮어쓰지 않는다
// - up = docker compose up -d --wait → 모든 healthcheck 가 통과해야 끝난다 (= 바로 써도 된다)
// - 의존성 없음 (Node 기본 모듈만). shell:false. 윈도우 · 맥 같은 코드
// 시험용 덮어쓰기: BREWAI_ENV_FILE=<경로> · BREWAI_COMPOSE_FILE=<경로> · BREWAI_STACK_PROJECT=<이름> · DOCKER_HOST (Docker 꺼짐 흉내)
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENV_FILE = process.env.BREWAI_ENV_FILE ? path.resolve(process.env.BREWAI_ENV_FILE) : path.join(ROOT, '.env');
const COMPOSE = process.env.BREWAI_COMPOSE_FILE ? path.resolve(process.env.BREWAI_COMPOSE_FILE) : path.join(ROOT, 'infra', 'compose.yaml');
const PROJECT = process.env.BREWAI_STACK_PROJECT || 'brewai';
const WAIT_SECONDS = Number(process.env.BREWAI_STACK_WAIT ?? 300);
const cmd = process.argv[2] ?? 'up';
const say = (m) => console.log(`[stack] ${m}`);
// 종료 코드: 0 = 준비됨 · 1 = 스택 실패 · 3 = Docker 없음/꺼짐 (dev-all 은 3 일 때만 venv 게이트웨이로 간다)
const failWith = (code, ...lines) => {
  console.error(`\n[stack] ${lines.filter(Boolean).join('\n        ')}\n`);
  process.exit(code);
};
const fail = (...lines) => failWith(1, ...lines);
const noDocker = (...lines) => failWith(3, ...lines);

// ---------- 1. Docker 가 있고 켜져 있나 ----------
// 윈도우: PATH 에 없으면(설치 직후 · 예전 창) Docker Desktop 기본 위치의 docker.exe 를 바로 쓴다
const WIN_DOCKER = process.platform === 'win32'
  ? [process.env.ProgramFiles, process.env.ProgramW6432, 'C:\\Program Files', process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')]
      .filter(Boolean).map((d) => path.join(d, 'Docker', 'Docker', 'resources', 'bin', 'docker.exe')).find((p) => fs.existsSync(p))
  : undefined;
let DOCKER = 'docker';
function docker(args, opts = {}) {
  let r = spawnSync(DOCKER, args, { encoding: 'utf8', windowsHide: true, ...opts });
  if (r.error?.code === 'ENOENT' && WIN_DOCKER && DOCKER !== WIN_DOCKER) {
    DOCKER = WIN_DOCKER;
    r = spawnSync(DOCKER, args, { encoding: 'utf8', windowsHide: true, ...opts });
  }
  return r;
}
function checkDocker(trace = false) {
  // timeout: Docker Desktop 이 켜지는 중이면 docker info 가 오래 멈춘다 → 20초 뒤 "꺼져 있어요(또는 켜지는 중)"
  const r = docker(['info', '--format', '{{.ServerVersion}} {{.MemTotal}}'], { timeout: 20000 });
  if (r.error?.code === 'ENOENT') {
    // 윈도우: 방금 설치했으면 탐색기에서 연 창의 PATH 가 예전 것이다
    const winExe = process.platform === 'win32' && path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Docker', 'Docker', 'resources', 'bin', 'docker.exe');
    if (winExe && fs.existsSync(winExe)) noDocker('Docker 는 깔려 있어요 → 이 창을 닫고 다시 열거나, 로그아웃 후 다시 실행하세요 (PATH 갱신).');
    noDocker('docker 명령을 찾지 못했어요 → Docker Desktop 을 설치하세요: https://www.docker.com/products/docker-desktop/');
  }
  if (r.status !== 0)
    noDocker(
      'Docker Desktop 이 꺼져 있어요 (또는 아직 켜지는 중).',
      process.platform === 'win32' ? '시작 메뉴에서 Docker Desktop 을 켜고, 아래쪽 "Engine running" 이 보이면 다시 실행하세요.'
        : 'Docker Desktop 을 켜고, 메뉴 막대 고래 아이콘이 멈추면 다시 실행하세요.',
    );
  const [ver, mem] = r.stdout.trim().split(' ');
  if (Number(ver.split('.')[0]) < 25) noDocker(`Docker Engine ${ver} 은 너무 오래됐어요 → Docker Desktop 을 업데이트하세요 (25 이상).`);
  const c = docker(['compose', 'version', '--short']);
  if (c.status !== 0) noDocker('docker compose 가 없어요 → Docker Desktop 을 업데이트하세요.');
  const gib = Number(mem) / 2 ** 30;
  if (trace && gib < 4)
    say(`주의: Docker 메모리가 ${gib.toFixed(1)} GB 예요. trace 묶음은 컨테이너 한도 합이 ~2.4 GB 라 빠듯해요 → ${process.platform === 'win32'
      ? '%UserProfile%\\.wslconfig 에 [wsl2] memory=6GB 후 wsl --shutdown'
      : 'Docker Desktop › Settings › Resources › Memory 를 6 GB 로'}`);
}

// ---------- 2. .env 비밀값 (없는 것만 만든다) ----------
const hex = (n) => crypto.randomBytes(n).toString('hex');
// conductor 첫 관리자 (ADR-0010) = users 가 비어 있을 때만 이 값으로 만든다. 비밀번호 24자 (CONDUCTOR_PASSWORD_MIN 기본 15 이상)
const ADMIN = {
  BREWAI_ADMIN_EMAIL: () => 'dev@brewai.local',
  BREWAI_ADMIN_PASSWORD: () => crypto.randomBytes(18).toString('base64url'),
};
const SECRETS = {
  LITELLM_MASTER_KEY: () => `sk-${hex(32)}`,
  LITELLM_DB_PASSWORD: () => hex(16),
  LITELLM_SALT_KEY: () => `sk-${hex(32)}`, // DB 에 저장한 provider 키를 암호화 → 처음 쓴 뒤 절대 바꾸지 않는다
  LANGFUSE_PUBLIC_KEY: () => `pk-lf-${crypto.randomUUID()}`,
  LANGFUSE_SECRET_KEY: () => `sk-lf-${crypto.randomUUID()}`,
  LANGFUSE_INIT_USER_PASSWORD: () => hex(12),
  LANGFUSE_NEXTAUTH_SECRET: () => hex(32),
  LANGFUSE_SALT: () => hex(32),
  LANGFUSE_ENCRYPTION_KEY: () => hex(32), // 정확히 64 hex
  LANGFUSE_POSTGRES_PASSWORD: () => hex(16),
  LANGFUSE_CLICKHOUSE_PASSWORD: () => hex(16),
  LANGFUSE_REDIS_PASSWORD: () => hex(16),
  LANGFUSE_MINIO_PASSWORD: () => hex(16),
};
const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;
function unquote(raw) {
  const t = raw.trim();
  if (t.startsWith('#')) return ''; // KEY= # 주석 → 빈 값
  const q = t.match(/^(['"])(.*)\1/);
  return (q ? q[2] : t.replace(/\s+#.*$/, '')).trim();
}
function readEnv() {
  const text = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(LINE);
    if (m) values[m[1]] = unquote(m[2]);
  }
  return { text, values };
}
function fillEnv(table, header) {
  const { text, values } = readEnv();
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let out = text;
  let appended = false;
  const added = [];
  for (const [k, make] of Object.entries(table)) {
    if (values[k]) continue; // 이미 값이 있으면 그대로 (덮어쓰기 금지)
    const v = make();
    const empty = new RegExp(`^([ \\t]*(?:export[ \\t]+)?${k}[ \\t]*=)[ \\t]*(?:#.*)?$`, 'm');
    if (empty.test(out)) out = out.replace(empty, `$1${v}`); // 빈 KEY= 줄은 그 자리에 채운다
    else {
      if (!appended) out += `${out && !out.endsWith('\n') ? eol : ''}${eol}# ── ${header}${eol}`;
      out += `${k}=${v}${eol}`;
      appended = true;
    }
    added.push(k);
  }
  if (added.length) {
    fs.writeFileSync(ENV_FILE, out, { mode: 0o600 });
    // mode 는 새 파일에만 → cp .env.example .env (0644) 로 만든 파일도 본인만 읽게
    if (process.platform !== 'win32') try { fs.chmodSync(ENV_FILE, 0o600); } catch { /* 권한 없음 → 그대로 */ }
  }
  return added;
}
// 첫 관리자 계정: Docker 와 상관없이 (up 이 Docker 검사보다 먼저 부른다 · BREWAI_STACK=0 인 PC = node scripts/stack.mjs secrets)
function ensureAdmin() {
  const added = fillEnv(ADMIN, 'conductor 첫 관리자 (scripts/stack.mjs 가 처음 한 번 만듦 · DB 에 사용자가 없을 때만 쓰인다)');
  const rel = path.relative(ROOT, ENV_FILE);
  const where = rel && !rel.startsWith('..') ? rel : ENV_FILE;
  if (added.length) say(`첫 관리자 계정을 ${where} 에 만들었어요 (비밀번호는 찍지 않아요): ${added.join(' · ')}`);
  const { text, values: now } = readEnv();
  say(`conductor 로그인 = ${now.BREWAI_ADMIN_EMAIL} · 비밀번호 = ${where} 의 BREWAI_ADMIN_PASSWORD (새 DB 에서 처음 켤 때만 계정이 생겨요)`);
  // 공백 있는 값을 따옴표 없이 = uv 가 .env 를 거기서 못 읽어 첫 관리자가 안 생기고 뒤 줄도 빠진다 (이 파일 · dev-all 은 읽어서 서로 어긋난다)
  const raw = (text.match(/^[ \t]*(?:export[ \t]+)?BREWAI_ADMIN_PASSWORD[ \t]*=(.*)$/m)?.[1] ?? '').replace(/\s+#.*$/, '').trim();
  if (/\s/.test(raw) && !/^(['"]).*\1$/.test(raw))
    say(`주의: ${where} 의 BREWAI_ADMIN_PASSWORD 에 공백이 있어요 → "따옴표"로 감싸세요 (안 그러면 첫 관리자가 만들어지지 않아요)`);
}

function ensureSecrets() {
  const { values } = readEnv();
  if (/cloud\.langfuse\.com/.test(values.OTEL_EXPORTER_OTLP_ENDPOINT ?? '') || /<base64/.test(values.OTEL_EXPORTER_OTLP_HEADERS ?? ''))
    say('주의: .env 의 OTEL_EXPORTER_OTLP_* 가 아직 Langfuse Cloud 예시예요 → .env.example 의 로컬 값으로 바꾸고 OTEL_EXPORTER_OTLP_HEADERS 줄은 지우세요.');
  if (values.LITELLM_LICENSE || process.env.LITELLM_LICENSE) fail('LITELLM_LICENSE 가 설정돼 있어요 → 지우세요 (GHSA-w4c7, 1.106.5 전까지 금지).');
  // LiteLLM DB 가 이미 있는데 SALT·DB 비번이 없다 = 새로 만들면 저장한 provider 키를 못 읽고(SALT) DB 에 못 붙는다(비번) → 만들지 않고 멈춘다
  const lost = ['LITELLM_SALT_KEY', 'LITELLM_DB_PASSWORD'].filter((k) => !values[k]);
  if (lost.length && docker(['volume', 'inspect', `${PROJECT}_litellm_db_data`]).status === 0)
    fail(`.env 에 ${lost.join(' · ')} 가 없는데 LiteLLM DB 는 이미 있어요 (새로 만들면 DB 에 못 붙거나 저장한 키를 못 읽어요).`,
      '예전 값을 .env 에 되살리거나, UI 로 넣은 모델·키를 버려도 되면 npm run stack:reset -- --yes 후 다시 실행하세요.');
  const added = fillEnv(SECRETS, '로컬 스택 비밀값 (scripts/stack.mjs 가 처음 한 번 만듦 · 바꾸려면 npm run stack:reset 먼저)');
  if (added.length) say(`.env 에 비밀값 ${added.length}개를 만들었어요 (값은 찍지 않아요): ${added.join(' · ')}`);
  const now = readEnv().values;
  if (!/^[0-9a-f]{64}$/i.test(now.LANGFUSE_ENCRYPTION_KEY)) fail('LANGFUSE_ENCRYPTION_KEY 는 64자 hex 여야 해요 → 그 줄을 지우고 다시 실행하세요.');
  if (!/^sk-[A-Za-z0-9_-]{32,}$/.test(now.LITELLM_MASTER_KEY) || now.LITELLM_MASTER_KEY === 'sk-1234')
    fail('LITELLM_MASTER_KEY 가 약해요 → 그 줄을 지우고 다시 실행하면 새로 만들어요.');
  return now;
}

// ---------- 3. 포트 ----------
const busy = (port) =>
  new Promise((ok) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.setTimeout(500);
    s.once('connect', () => (s.destroy(), ok(true)));
    s.once('timeout', () => (s.destroy(), ok(false)));
    s.once('error', () => ok(false));
  });

// ---------- 4. compose ----------
// trace = Langfuse 묶음 (compose profile "trace"). down · status · logs 는 늘 전부를 본다
const compose = (args, { trace = true, ...opts } = {}) =>
  docker(['compose', '-p', PROJECT, '-f', COMPOSE, ...(fs.existsSync(ENV_FILE) ? ['--env-file', ENV_FILE] : []),
    ...(trace ? ['--profile', 'trace'] : []), ...args], opts);
// down · status · logs: 비밀값을 검사하거나 .env 에 쓰지 않는다 (끄려는 순간에 거부하면 안 된다).
// compose 의 ${VAR:?} 치환만 통과하게 빈 키에 자리표시 값을 셸 env 로 준다 (셸 값이 --env-file 보다 이긴다 · 컨테이너는 안 만든다)
function placeholderEnv() {
  const { values } = readEnv();
  const env = { ...process.env };
  for (const k of Object.keys(SECRETS)) if (!env[k] && !values[k]) env[k] = 'unused';
  return env;
}
const projectPs = (fmt, ...filters) =>
  docker(['ps', '--filter', `label=com.docker.compose.project=${PROJECT}`, ...filters.flatMap((f) => ['--filter', f]), '--format', fmt]);
const runningServices = () => new Set(projectPs('{{.Label "com.docker.compose.service"}}').stdout?.split(/\s+/).filter(Boolean) ?? []);

// 지금 떠 있는 brewai 컨테이너의 메모리 (docker stats) → 한 줄 합계 + 서비스별
function memory() {
  const ids = projectPs('{{.ID}}').stdout?.split(/\s+/).filter(Boolean) ?? [];
  if (!ids.length) return;
  const r = docker(['stats', '--no-stream', '--format', '{{.Name}}\t{{.MemUsage}}', ...ids]);
  if (r.status !== 0) return;
  const unit = { B: 1, KiB: 2 ** 10, MiB: 2 ** 20, GiB: 2 ** 30, kB: 1e3, MB: 1e6, GB: 1e9 };
  const toB = (s) => { const m = s.trim().match(/^([\d.]+)\s*([A-Za-z]+)$/); return m ? Number(m[1]) * (unit[m[2]] ?? 1) : 0; };
  let used = 0;
  let limit = 0;
  const parts = [];
  for (const line of r.stdout.trim().split(/\r?\n/)) {
    const [name, usage = ''] = line.split('\t');
    const [u, l] = usage.split('/');
    used += toB(u ?? '');
    limit += toB(l ?? '');
    parts.push(`${name.replace(/^brewai-|-1$/g, '')} ${(toB(u ?? '') / 2 ** 20).toFixed(0)}`);
  }
  say(`메모리 ${(used / 2 ** 30).toFixed(2)} GiB 사용 / 한도 합 ${(limit / 2 ** 30).toFixed(2)} GiB  (MiB: ${parts.join(' · ')})`);
}

function wantTrace(env) {
  const arg = process.argv.slice(3);
  if (arg.includes('trace')) return true;
  if (!arg.includes('auto')) return false;
  const v = process.env.BREWAI_TRACE ?? env.BREWAI_TRACE ?? ''; // 셸 값이 .env 보다 이긴다
  return /^(1|true|yes|on)$/i.test(v.trim());
}

async function up() {
  const unknown = process.argv.slice(3).filter((a) => !['trace', 'auto'].includes(a));
  if (unknown.length) fail(`모르는 옵션: ${unknown.join(' ')} → npm run stack · npm run stack -- trace`);
  if (!fs.existsSync(COMPOSE)) fail(`${path.relative(ROOT, COMPOSE)} 이 없어요.`);
  ensureAdmin(); // Docker 가 없어도 (dev-all 은 그때 venv 게이트웨이로 간다) 로그인 계정은 있어야 한다
  const pre = readEnv().values;
  const trace = wantTrace(pre);
  checkDocker(trace);
  const env = ensureSecrets();
  // compose 처럼 셸 값 → .env → 기본값 (빈 LITELLM_PORT= 줄은 기본값)
  const port = (k, d) => Number(process.env[k] || env[k] || d);
  const ports = [[port('LITELLM_PORT', 4000), 'LiteLLM 게이트웨이', 'litellm']];
  if (trace) ports.push([port('LANGFUSE_PORT', 3000), 'Langfuse', 'langfuse-web'], [port('LANGFUSE_MEDIA_PORT', 9090), 'Langfuse 미디어(MinIO)', 'minio']);
  const mine = runningServices();
  const taken = [];
  for (const [p, what, svc] of ports) if (!mine.has(svc) && (await busy(p))) taken.push(`${p}(${what})`);
  if (taken.length)
    fail(`포트 ${taken.join(' · ')} 를 다른 프로그램이 쓰고 있어요.`,
      '그 프로그램을 끄거나 .env 에 LITELLM_PORT · LANGFUSE_PORT · LANGFUSE_MEDIA_PORT 로 다른 포트를 주세요.',
      '(npm run gateway 로 띄운 venv 게이트웨이가 4000 에 떠 있으면 먼저 끄세요)');
  const images = compose(['config', '--images'], { trace }).stdout?.trim().split(/\s+/).filter(Boolean) ?? [];
  const missing = images.filter((i) => docker(['image', 'inspect', '--format', '.', i]).status !== 0);
  if (missing.length)
    say(`처음이라 이미지 ${missing.length}개를 받아요 (${trace ? '합 ~1.5 GB' : '~800 MB'} 압축 · 느린 망이면 오래 걸려요. PC 마다 한 번)`);
  say(`올리는 중… ${trace ? 'LiteLLM + DB + Langfuse 묶음' : 'LiteLLM + DB (Langfuse = npm run stack:trace)'} · 모두 healthy 가 될 때까지 최대 ${WAIT_SECONDS}초`);
  const t0 = Date.now();
  const r = compose(['up', '-d', '--wait', '--wait-timeout', String(WAIT_SECONDS)], { trace, stdio: 'inherit' });
  if (r.status !== 0) {
    compose(['ps', '-a'], { stdio: 'inherit' });
    fail('스택이 준비되지 않았어요. 위 표에서 unhealthy · exited 인 서비스를 보세요.',
      `로그: npm run stack:logs -- <서비스>   (예: ${trace ? 'langfuse-web' : 'litellm'})`,
      trace ? '메모리 부족이면 Docker Desktop 메모리를 6 GB 이상으로 올리세요.' : '',
      process.platform === 'win32' ? '"ports are not available" 이면 윈도우가 막아 둔 포트예요: netsh interface ipv4 show excludedportrange protocol=tcp → .env 의 LITELLM_PORT · LANGFUSE_PORT 를 그 밖으로' : '');
  }
  const L = port('LANGFUSE_PORT', 3000);
  say(`준비됐어요 (${((Date.now() - t0) / 1000).toFixed(0)}초)`);
  say(`게이트웨이  http://127.0.0.1:${port('LITELLM_PORT', 4000)}   (키 = .env LITELLM_MASTER_KEY)`);
  say(`관리 화면  http://127.0.0.1:${port('LITELLM_PORT', 4000)}/ui   로그인 admin / .env LITELLM_MASTER_KEY  (모델 추가 = Models + Endpoints)`);
  if (trace || runningServices().has('langfuse-web')) {
    say(`Langfuse    http://localhost:${L}   로그인 ${env.LANGFUSE_INIT_USER_EMAIL || 'dev@brewai.local'} / .env LANGFUSE_INIT_USER_PASSWORD`);
    say(`trace 받는 곳 http://127.0.0.1:${L}/api/public/otel  (Basic LANGFUSE_PUBLIC_KEY:LANGFUSE_SECRET_KEY)`);
  }
  memory();
}

function down(volumes) {
  checkDocker();
  if (volumes && !process.argv.includes('--yes'))
    fail('reset 은 trace · Langfuse 계정 · 키 · LiteLLM UI 로 넣은 모델·키를 모두 지워요. 정말이면: npm run stack:reset -- --yes');
  const r = compose(['down', ...(volumes ? ['-v'] : [])], { stdio: 'inherit', env: placeholderEnv() });
  if (r.status !== 0) process.exit(r.status ?? 1);
  say(volumes ? '내리고 데이터도 지웠어요. 다음 up 은 처음처럼 새로 만들어요.' : '내렸어요 (데이터는 남아요 → 다음 up 에서 그대로).');
}

switch (cmd) {
  case 'up': await up(); break;
  case 'down': down(false); break;
  case 'reset': down(true); break;
  case 'secrets': ensureAdmin(); break;
  case 'status': checkDocker(); compose(['ps', '-a'], { stdio: 'inherit', env: placeholderEnv() }); memory(); break;
  case 'logs': checkDocker(); compose(['logs', '--tail', '200', ...process.argv.slice(3)], { stdio: 'inherit', env: placeholderEnv() }); break;
  default: fail(`모르는 명령: ${cmd} → up [trace] · down · status · logs · reset --yes · secrets`);
}
