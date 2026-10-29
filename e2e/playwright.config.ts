import { defineConfig } from '@playwright/test';
import path from 'node:path';

// E2E = 기능이 끝난 시점에 돈다 (금요일 데모 스크립트). 전체 = npm run e2e (데스크톱·관리자 빌드 → 테스트)
// 브라우저: 맥 = Chrome · 윈도우 = Edge (PC에 깔린 것) · 그 밖(CI) = Playwright 번들 Chromium
const channel = process.platform === 'darwin' ? 'chrome' : process.platform === 'win32' ? 'msedge' : undefined;
const browser = { browserName: 'chromium', channel } as const;

export default defineConfig({
  testDir: '.',
  outputDir: 'test-results', // 스크린샷 = test-results/shots/
  reporter: [['list']],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', testMatch: 'desktop.spec.ts' },
    { name: 'admin', testMatch: 'admin.spec.ts', use: { ...browser, baseURL: 'http://localhost:4174' } },
    { name: 'web', testMatch: 'web.spec.ts', use: browser },
  ],
  // 관리자 빌드본 (vite preview). webServer 는 프로젝트별로 못 나눠서 --project=web 만 돌려도 뜬다
  webServer: {
    command: 'npm run preview -w apps/admin',
    cwd: path.resolve(__dirname, '..'),
    url: 'http://localhost:4174',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
