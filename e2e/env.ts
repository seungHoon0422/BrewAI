import os from 'node:os';
import path from 'node:path';

// E2E 주소 · 계정 한곳에. API = 데스크톱 기본값과 같다. 관리자 콘솔은 /api 를 Vite proxy 로 넘긴다 (같은 출처 · 쿠키).
export const API = 'http://127.0.0.1:8787';
export const GATEWAY = 'http://127.0.0.1:4010';
export const GATEWAY_KEY = 'sk-e2e-gateway'; // mock 전용 가짜 키 (진짜 키 아님)
export const ADMIN_URL = 'http://localhost:4174'; // 관리자 빌드본 (vite preview)
export const ADMIN_DEV_URL = 'http://localhost:4175'; // 관리자 개발 서버 = UI 부품 모음 #/ui (빌드에서 빠지는 화면)
export const OIDC = 'http://127.0.0.1:4011'; // 가짜 Google (e2e/mock/oidc.mjs)
export const OIDC_CLIENT_ID = 'brewai-e2e.apps.googleusercontent.com';
export const OIDC_CLIENT_SECRET = 'e2e-google-secret'; // mock 전용 (진짜 값 아님)
export const MCP = 'http://127.0.0.1:4014'; // 가짜 MCP + OAuth (e2e/mock/mcp.mjs) · OAuth 서버 = MCP/mcp · 인증 없음 = MCP/noauth/mcp
// mock 게이트웨이가 받은 요청 기록 (JSONL · Authorization 가림) — mcp-tokens 가 요청에 실린 도구를 센다
export const GATEWAY_RECORD = path.join(os.tmpdir(), 'brewai-e2e-gateway.jsonl');
export const MCP_SECRET_KEY = 'ZTJlLWJyZXdhaS1tY3AtdmF1bHQta2V5LTAwMDAwMDE'; // conductor 금고 키 (E2E 전용 32바이트 · 진짜 값 아님)

// 첫 관리자 = conductor 가 빈 DB 에 만든다 (BREWAI_ADMIN_EMAIL · PASSWORD). E2E 전용 값 (비밀번호 15자 이상)
export const ADMIN_USER = { email: 'e2e-admin@brewai.test', password: 'e2e admin password 0001', name: 'e2e-admin' } as const;
// 모든 테스트 계정의 비밀번호 (15자 이상 · 조합 규칙 없음)
export const PASSWORD = 'correct horse battery staple';
