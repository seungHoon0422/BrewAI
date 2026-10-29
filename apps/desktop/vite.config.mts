// 렌더러 빌드: renderer/ → dist/ (main.js 가 app://brewai 로 띄운다). base './' = 상대 경로.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const { version } = JSON.parse(readFileSync(here('./package.json'), 'utf8')) as { version: string };

export default defineConfig({
  root: here('./renderer'), // 실행 위치와 상관없이 renderer/
  base: './',
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: { outDir: '../dist', emptyOutDir: true },
});
