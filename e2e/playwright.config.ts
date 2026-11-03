import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { ADMIN_STATE } from './auth';
import { ADMIN_DEV_URL, ADMIN_URL, ADMIN_USER, API, GATEWAY, GATEWAY_KEY, GATEWAY_RECORD, MCP, MCP_SECRET_KEY, OIDC, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET } from './env';

// E2E = 기능이 끝난 시점에 돈다 (금요일 데모 스크립트). 전체 = npm run e2e (데스크톱·관리자 빌드 → 테스트)
// 브라우저: 맥 = Chrome · 윈도우 = Edge (PC에 깔린 것) · 그 밖(CI) = Playwright 번들 Chromium
// 로그인한 세계 (ADR-0010): conductor 는 빈 DB 에 E2E 첫 관리자를 만들고, 스펙은 진짜 로그인으로 토큰 · 쿠키를 받는다 (e2e/auth.ts)
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
    // 데스크톱 (Electron): 셸 · 대화 · 로그인 · 가입 · Google · 스페이스 · 프로젝트 · 계정 · 앱 연결(MCP)
    { name: 'desktop', testMatch: /[\\/](desktop|chat(-[a-z]+)?|auth(-[a-z]+)?|mcp(-[a-z]+)+|spaces|projects|account)\.spec\.ts$/ },
    // 관리자 콘솔: 한 번 로그인해 둔 쿠키를 쓴다 (로그인 · 로그아웃 자체를 보는 스펙은 빈 상태로 시작)
    { name: 'admin-login', testMatch: 'admin.setup.ts', use: { ...browser, baseURL: ADMIN_URL } },
    {
      name: 'admin',
      testMatch: /[\\/]admin(-[a-z]+)?\.spec\.ts$/,
      dependencies: ['admin-login'],
      use: { ...browser, baseURL: ADMIN_URL, storageState: ADMIN_STATE },
    },
    // UI 부품 모음 (#/ui) = 관리자 개발 서버에만 있다 (빌드에서 빠짐)
    { name: 'ui', testMatch: 'ui-gallery.spec.ts', use: { ...browser, baseURL: ADMIN_DEV_URL } },
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
      env: { FAKE_GATEWAY_KEY: GATEWAY_KEY, FAKE_GATEWAY_DELAY: '40', FAKE_GATEWAY_RECORD: GATEWAY_RECORD },
    },
    {
      name: 'oidc',
      command: `node e2e/mock/oidc.mjs --port ${new URL(OIDC).port}`,
      cwd: ROOT,
      url: `${OIDC}/health`,
      reuseExistingServer: false,
      timeout: 15_000,
      // 기본 계정 = @gmail.com (Google 이 권위 → 같은 이메일이면 자동 연결). 스펙이 /__fake/account 로 바꾼다
      env: { FAKE_OIDC_CLIENT_ID: OIDC_CLIENT_ID, FAKE_OIDC_CLIENT_SECRET: OIDC_CLIENT_SECRET, FAKE_OIDC_ISSUER: OIDC },
    },
    {
      name: 'mcp',
      command: `node e2e/mock/mcp.mjs --port ${new URL(MCP).port}`,
      cwd: ROOT,
      url: `${MCP}/health`,
      reuseExistingServer: false,
      timeout: 15_000,
      // 허용 화면 없이 바로 code (스펙이 화면을 보려면 /__fake 로 끄지 말고 이 줄만 빼고 돌린다) · 기본 계정 alice (/__fake/account 로 바꿈)
      env: { FAKE_MCP_AUTO_APPROVE: '1' },
    },
    {
      name: 'api',
      command: 'node scripts/api.mjs',
      cwd: ROOT,
      url: `${API}/healthz`,
      reuseExistingServer: false, // 개발용 conductor(진짜 게이트웨이)가 8787 에 떠 있으면 바로 실패 = 안전
      timeout: 120_000, // 첫 실행은 uv 가 의존성을 받는다
      env: {
        BREWAI_E2E: '1', // scripts/api.mjs: .env 안 읽음 · OTel 끔 · conductor: loopback http mock OIDC 허용
        // 셸에 export 된 개발용 값이 E2E 를 바꾸지 않게 고정 (빈 값 = 쓰지 않음)
        CONDUCTOR_PORT: new URL(API).port,
        CONDUCTOR_DEFAULT_MODEL: '',
        // 모델 노출 · 대화 · 계정 DB = 메모리 (E2E 마다 새로 · 개발용 .data/ 를 건드리지 않음)
        CONDUCTOR_DB_PATH: ':memory:',
        // 첫 동기화 때 노출할 모델 (실제 기본값은 키 없는 brewai-mock). mock 의 채팅 모델 둘 = 노출, fake-embed = 숨김
        CONDUCTOR_BOOTSTRAP_MODELS: 'fake-chat-small,fake-chat-large',
        LLM_GATEWAY_UI_URL: '',
        CONDUCTOR_DESKTOP_ORIGINS: 'app://brewai',
        BREWAI_ENV_FILE: '',
        LLM_GATEWAY_URL: GATEWAY,
        LLM_GATEWAY_KEY: GATEWAY_KEY,
        CONDUCTOR_ADMIN_ORIGINS: new URL(ADMIN_URL).origin,
        // 빈 DB → 첫 관리자 · 기본 조직 '우리 팀' · 내 스페이스
        BREWAI_ADMIN_EMAIL: ADMIN_USER.email,
        BREWAI_ADMIN_PASSWORD: ADMIN_USER.password,
        CONDUCTOR_PASSWORD_MIN: '', // 기본 15
        // Google = 가짜 OIDC. 콜백: 데스크톱 = 이 conductor · 관리자 = 콘솔(preview proxy)
        GOOGLE_CLIENT_ID: OIDC_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: OIDC_CLIENT_SECRET,
        GOOGLE_ISSUER: OIDC,
        CONDUCTOR_PUBLIC_URL: API,
        CONDUCTOR_ADMIN_URL: ADMIN_URL,
        // MCP (ADR-0013): 가짜 MCP 가 http://127.0.0.1 → loopback 허용 (E2E 전용) · 금고 키 = E2E 고정값
        CONDUCTOR_MCP_ALLOW_LOOPBACK: '1',
        // 추천 서버 = 가짜 MCP 주소만 든 파일 (진짜 목록의 실제 서비스 주소로 나가지 않게)
        CONDUCTOR_MCP_PRESETS: path.join(ROOT, 'e2e', 'mock', 'mcp-presets.json'),
        CONDUCTOR_SECRET_KEY: MCP_SECRET_KEY,
        CONDUCTOR_SECRET_KEY_ID: 'e2e',
        CONDUCTOR_SECRET_KEYS_OLD: '',
      },
    },
    {
      name: 'admin',
      command: 'npm run preview -w apps/admin', // 관리자 빌드본 (vite preview 4174)
      cwd: ROOT,
      url: ADMIN_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { VITE_BREWAI_API_URL: API }, // /api proxy 대상 = E2E conductor
    },
    {
      name: 'admin-dev',
      command: `npm exec -w apps/admin -- vite --port ${new URL(ADMIN_DEV_URL).port} --strictPort`, // 개발 서버 = #/ui 부품 모음
      cwd: ROOT,
      url: ADMIN_DEV_URL,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_BREWAI_API_URL: API }, // /api proxy 대상 = E2E conductor
    },
  ],
});
