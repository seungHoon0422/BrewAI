import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { ADMIN_URL, API, GATEWAY, GATEWAY_KEY } from './env';

// E2E = 기능이 끝난 시점에 돈다 (금요일 데모 스크립트). 전체 = npm run e2e (데스크톱·관리자 빌드 → 테스트)
// 브라우저: 맥 = Chrome · 윈도우 = Edge (PC에 깔린 것) · 그 밖(CI) = Playwright 번들 Chromium
const ROOT = path.resolve(__dirname, '..');
const channel = process.platform === 'darwin' ? 'chrome' : process.platform === 'win32' ? 'msedge' : undefined;
const browser = { browserName: 'chromium', channel } as const;

export default defineConfig({
  testDir: '.',
  outputDir: 'test-results', // 스크린샷 = test-results/shots/
  reporter: [['list']],
  fullyParallel: false,
  workers: 1, // conductor · mock 하나를 같이 쓴다
  forbidOnly: !!process.env.CI,
  use: { trace: 'retain-on-failure' },
  globalSetup: './global-setup.ts',
  projects: [
    { name: 'desktop', testMatch: /(desktop|chat)\.spec\.ts/ },
    { name: 'admin', testMatch: /admin(-models)?\.spec\.ts/, use: { ...browser, baseURL: ADMIN_URL } },
    { name: 'web', testMatch: 'web.spec.ts', use: browser },
  ],
  // 배열 순서대로 하나씩 뜬다 (앞 url 이 준비된 뒤 다음). 프로젝트별로 못 나눠서 --project=web 만 돌려도 다 뜬다.
  // 명령은 모두 `node …` / `npm …` — Playwright 는 shell:true(윈도우 cmd.exe)로 띄우므로 셸 문법을 쓰지 않는다
  webServer: [
    {
      name: 'gateway',
      command: `node e2e/mock/gateway.mjs --port ${new URL(GATEWAY).port}`,
      cwd: ROOT,
      url: `${GATEWAY}/health/liveliness`,
      reuseExistingServer: false, // 남이 띄운 서버(진짜 LiteLLM 등)를 절대 재사용하지 않는다
      timeout: 15_000,
      env: { FAKE_GATEWAY_KEY: GATEWAY_KEY, FAKE_GATEWAY_DELAY: '40' },
    },
    {
      name: 'api',
      command: 'node scripts/api.mjs',
      cwd: ROOT,
      url: `${API}/healthz`,
      reuseExistingServer: false, // 개발용 conductor(진짜 게이트웨이)가 8787 에 떠 있으면 바로 실패 = 안전
      timeout: 120_000, // 첫 실행은 uv 가 의존성을 받는다
      env: {
        BREWAI_E2E: '1', // scripts/api.mjs: .env 안 읽음 · OTel 끔
        // 셸에 export 된 개발용 값이 E2E 를 바꾸지 않게 고정 (빈 값 = 쓰지 않음)
        CONDUCTOR_PORT: new URL(API).port,
        CONDUCTOR_DEFAULT_MODEL: '',
        CONDUCTOR_DESKTOP_ORIGINS: 'app://brewai',
        BREWAI_ENV_FILE: '',
        LLM_GATEWAY_URL: GATEWAY,
        LLM_GATEWAY_KEY: GATEWAY_KEY,
        CONDUCTOR_ADMIN_ORIGINS: new URL(ADMIN_URL).origin,
      },
    },
    {
      name: 'admin',
      command: 'npm run preview -w apps/admin', // 관리자 빌드본 (vite preview 4174)
      cwd: ROOT,
      url: ADMIN_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
