// scripts/gateway.mjs — npm run gateway: LiteLLM 프록시 1.106.2 를 127.0.0.1:4000 에. 전용 venv = infra/litellm/.venv (ADR-0003).
// 설치는 하지 않는다 (README "게이트웨이 설치 1회"). 없으면 방법만 알려 준다.
// uv run --no-project: 루트 워크스페이스(conductor)를 sync 하지 않고 그 venv 의 litellm 만 실행.
// 실행 파일은 venv 안의 절대 경로로 부른다 (맥 bin/litellm · 윈도우 Scripts\litellm.exe). 이름만 주면 venv 에 없을 때
// uv 가 PATH 의 다른 litellm(해시 검사 안 된 전역 설치)을 띄운다 → 없거나 1.106.2 가 아니면 멈춘다.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runUv } from './run-uv.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = path.join(ROOT, 'infra', 'litellm');
const VENV = path.join(DIR, '.venv');
const CONFIG = path.join(DIR, 'config.yaml');
const WIN = process.platform === 'win32';
const BIN = path.join(VENV, WIN ? 'Scripts' : 'bin', WIN ? 'litellm.exe' : 'litellm');
const PY = path.join(VENV, WIN ? 'Scripts' : 'bin', WIN ? 'python.exe' : 'python');
const LITELLM_VERSION = '1.106.2'; // infra/litellm/requirements.txt 와 같게
// .env 대신 다른 파일: BREWAI_ENV_FILE=<경로> (시험용 · 키 파일을 따로 둘 때). 없으면 레포 .env
const envFile = process.env.BREWAI_ENV_FILE ? path.resolve(process.env.BREWAI_ENV_FILE) : path.join(ROOT, '.env');
const PORT = Number(process.env.LITELLM_PORT ?? 4000);
const fail = (msg) => { console.error(`[gateway] ${msg}`); process.exit(1); };

if (process.env.BREWAI_ENV_FILE && !existsSync(envFile)) fail(`BREWAI_ENV_FILE 파일이 없어요: ${envFile}`);
const INSTALL = 'README "게이트웨이 설치 1회" (uv venv + uv pip sync --require-hashes --only-binary :all:)';
if (!existsSync(VENV)) fail(`infra/litellm/.venv 가 없어요 → ${INSTALL}`);
if (!existsSync(BIN) || !existsSync(PY)) fail(`infra/litellm/.venv 에 litellm 이 없어요 (설치가 중간에 실패?) → ${INSTALL}`);
// -I = 격리 모드: PYTHONPATH · 현재 폴더를 안 본다 → venv 에 깔린 배포판 버전만 읽는다
const got = spawnSync(PY, ['-I', '-c', "import importlib.metadata as m;print(m.version('litellm'))"], { encoding: 'utf8', windowsHide: true });
if (got.status !== 0 || got.stdout.trim() !== LITELLM_VERSION)
  fail(`infra/litellm/.venv 의 litellm 이 ${LITELLM_VERSION} 이 아니에요 (${got.stdout?.trim() || '읽지 못함'}) → ${INSTALL}`);

// .env 에서 두 값만 본다 (값은 찍지 않는다). 셸 env 가 .env 보다 이긴다 (uv 와 같은 순서)
// uv(dotenvy) 처럼 `export KEY=…` · 따옴표 · 줄 끝 주석을 읽는다. 같은 키가 여러 번이면 모두 모은다 (검사는 전부를 본다)
const dotenv = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
// 키 이름은 대소문자 무시 (윈도우 환경변수는 대소문자를 안 가린다 → litellm_license 도 LITELLM_LICENSE 로 읽힌다)
const fileValues = (k) =>
  dotenv
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/))
    .filter((m) => m?.[1].toUpperCase() === k)
    .map((m) => {
      const raw = m[2].trim();
      const q = raw.match(/^(['"])(.*)\1/);
      return (q ? q[2] : raw.replace(/\s+#.*$/, '')).trim();
    })
    .filter(Boolean);
const value = (k) => process.env[k] || fileValues(k).at(-1);

// GHSA-w4c7-34wj-hqm8: 1.106.2 + Enterprise 라이선스 = 인증 없이 환경변수(키) 유출. 1.106.5 로 올리기 전엔 금지
if (process.env.LITELLM_LICENSE || fileValues('LITELLM_LICENSE').length) fail('LITELLM_LICENSE 가 설정돼 있어요 → 지우세요 (GHSA-w4c7, 1.106.5 전까지 금지)');
const mk = value('LITELLM_MASTER_KEY');
// LiteLLM 은 sk-1234 만 막는다 → 빈 값 · 예시 값 · 짧은 값(sk- + 32자 미만)을 여기서 막는다. 값은 찍지 않는다
if (!mk || ['sk-local-change-me', 'sk-1234'].includes(mk) || !/^sk-[A-Za-z0-9_-]{32,}$/.test(mk)) {
  fail(`LITELLM_MASTER_KEY 를 새로 만들어 .env 에 넣으세요 → node -e "console.log('sk-'+require('crypto').randomBytes(32).toString('hex'))"`);
}

// 포트가 차 있으면 LiteLLM 1.106.2 는 말없이 다른 포트로 뜬다 → 먼저 확인
// (맥은 0.0.0.0:4000 에 누가 있어도 127.0.0.1:4000 listen 이 될 수 있다 → 접속도 한 번 해 본다)
const answers = () =>
  new Promise((ok) => {
    const c = net.connect({ port: PORT, host: '127.0.0.1' });
    c.setTimeout(500);
    c.once('connect', () => (c.destroy(), ok(true)));
    c.once('timeout', () => (c.destroy(), ok(false)));
    c.once('error', () => ok(false));
  });
const bindable = () =>
  new Promise((ok) => {
    const s = net.createServer().once('error', () => ok(false)).once('listening', () => s.close(() => ok(true)));
    s.listen(PORT, '127.0.0.1');
  });
const free = !(await answers()) && (await bindable());
if (!free) fail(`127.0.0.1:${PORT} 를 이미 누가 쓰고 있어요 → 그걸 먼저 끄세요`);

runUv('gateway', [
  'run', '--no-project', '--python', VENV,
  ...(existsSync(envFile) ? ['--env-file', envFile] : ['--no-env-file']),
  '--', BIN, '--config', CONFIG, '--host', '127.0.0.1', '--port', String(PORT),
], {
  cwd: ROOT,
  env: {
    // 원격 호출 끔 (ADR-0006 + r2): 가격표 · 블로그 · 정책 템플릿 · Anthropic beta 헤더 · autorouter 프리셋
    LITELLM_LOCAL_MODEL_COST_MAP: 'True',
    LITELLM_LOCAL_BLOG_POSTS: 'True',
    LITELLM_LOCAL_POLICY_TEMPLATES: 'True',
    LITELLM_LOCAL_ANTHROPIC_BETA_HEADERS: 'True',
    LITELLM_LOCAL_AUTOROUTER_PRESETS: 'True',
    PYTHON_DOTENV_DISABLED: '1', // LiteLLM 이 설치 폴더 위로 .env 를 스스로 찾지 않게 (.env 는 uv 가 한 번만)
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8', // 배너(█) · config 읽기 — 윈도우 cp949 에서 기동 실패 방지
  },
  drop: ['LITELLM_LICENSE'],
});
