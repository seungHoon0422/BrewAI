import type { ServerResponse } from 'node:http';
import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import brewaiDocs from './docs-plugin.ts';

// 관리자 콘솔 = 별도 SPA. 해시 라우팅이라 base './' 로 어느 경로에 올려도 열린다.
// 포트는 package.json 스크립트에 고정 (dev 5174 · preview 4174)
// brewaiDocs = 문서 메뉴 데이터 (레포 파일 → virtual:brewai-docs, dev 에선 바뀌면 다시 읽음)
//
// /api = conductor 로 넘긴다 (dev · preview 둘 다, ADR-0010). 콘솔과 conductor 가 같은 출처가 되어
// HttpOnly 관리자 쿠키가 1st-party 로 붙고, 관리자 Google 콜백(CONDUCTOR_ADMIN_URL/api/auth/google/callback)도 여기로 온다.
// 대상 = VITE_BREWAI_API_URL (scripts/dev-all.mjs 가 conductor 포트를 바꾸면 넣는다) · 기본 http://127.0.0.1:8787.
// 브라우저 코드는 이 값을 쓰지 않는다 (요청은 늘 같은 출처 '/api/…').
const target = (process.env.VITE_BREWAI_API_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');

const api: ProxyOptions = {
  target,
  changeOrigin: true, // Host = conductor (TrustedHost). Origin 은 그대로 → conductor 가 관리자 출처인지 본다
  xfwd: true, // X-Forwarded-For = 진짜 브라우저 주소 (uvicorn 은 127.0.0.1 proxy 를 믿는다) → 로그인 시도 제한이 사람마다 IP 를 본다
  configure(proxy) {
    // conductor 가 꺼져 있으면 빈 502 대신 {detail: conductor_unreachable} → 화면이 'conductor 에 연결할 수 없어요' 로 읽는다
    proxy.on('error', (_err, _req, res) => {
      const out = res as ServerResponse;
      if (!('req' in out) || out.headersSent || out.writableEnded) return;
      out.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ detail: 'conductor_unreachable' }));
    });
  },
};

export default defineConfig({
  base: './',
  plugins: [react(), brewaiDocs()],
  server: { proxy: { '/api': api } },
  preview: { proxy: { '/api': api } },
});
