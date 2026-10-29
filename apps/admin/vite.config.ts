import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 관리자 콘솔 = 별도 SPA. 해시 라우팅이라 base './' 로 어느 경로에 올려도 열린다.
// 포트는 package.json 스크립트에 고정 (dev 5174 · preview 4174)
export default defineConfig({
  base: './',
  plugins: [react()],
});
