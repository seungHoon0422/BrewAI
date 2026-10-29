// scripts/api.mjs — npm run api: conductor (FastAPI · uvicorn) 를 127.0.0.1:8787 에.
// .env 가 있으면 uv 가 읽는다 (--env-file). 셸에 이미 있는 값이 이긴다 (uv 동작).
// E2E(BREWAI_E2E=1)는 .env 를 안 읽는다 → 진짜 키·Langfuse 로 안 나간다. 게이트웨이는 Playwright 가 띄운 mock.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runUv } from './run-uv.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// .env 대신 다른 파일: BREWAI_ENV_FILE=<경로> (시험용). 없으면 레포 .env
const envFile = process.env.BREWAI_ENV_FILE ? path.resolve(process.env.BREWAI_ENV_FILE) : path.join(ROOT, '.env');
const e2e = process.env.BREWAI_E2E === '1';
const port = process.env.CONDUCTOR_PORT ?? '8787';
if (!e2e && process.env.BREWAI_ENV_FILE && !existsSync(envFile)) {
  console.error(`[api] BREWAI_ENV_FILE 파일이 없어요: ${envFile}`);
  process.exit(1);
}

runUv('api', [
  'run', '--locked',
  ...(e2e || !existsSync(envFile) ? ['--no-env-file'] : ['--env-file', envFile]),
  '--', 'uvicorn', '--factory', 'conductor.app:create_app', '--host', '127.0.0.1', '--port', port,
], {
  cwd: ROOT,
  env: {
    PYDANTIC_AI_NO_BANNER: '1', // 배너 = 홍보 + 유니코드 (윈도우 cp949 파이프에서 위험)
    PYTHONIOENCODING: 'utf-8',
    ...(e2e ? { OTEL_SDK_DISABLED: 'true' } : {}),
  },
});
