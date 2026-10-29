// 데스크톱이 부를 수 있는 유일한 서버 = conductor API 출처 하나. main.js 와 scripts/dev.mjs 가 같이 쓴다.
// BREWAI_API_URL (기본 http://127.0.0.1:8787) → 검사 → 출처(origin)만. 경로·쿼리·계정은 버린다.
// 허용: http://127.0.0.1:<포트> · http://localhost:<포트> · https://<아무 호스트>. 그 밖은 null (= API 막힘, 화면은 '연결할 수 없어요').
// 배포본(app.isPackaged)은 환경변수를 안 본다 → 기본값. 배포판 백엔드는 P2 전에 ADR (ADR-0007 미룸).
const DEFAULT_API_URL = 'http://127.0.0.1:8787';
const LOOPBACK = new Set(['127.0.0.1', 'localhost']); // [::1] 은 CSP host-source 로 못 적어서 뺀다

function apiOrigin(raw, { packaged = false, warn = console.warn } = {}) {
  const value = packaged || !raw ? DEFAULT_API_URL : raw;
  try {
    const url = new URL(value);
    const okScheme = url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname));
    if (okScheme && !url.username && !url.password) {
      if (url.pathname !== '/' || url.search || url.hash) warn('[brewai] BREWAI_API_URL 의 경로·쿼리는 버려요:', value);
      return url.origin; // 'http://127.0.0.1:8787' (기본 포트면 포트 없이)
    }
  } catch {}
  warn('[brewai] BREWAI_API_URL 무시:', value);
  return null;
}

module.exports = { apiOrigin, DEFAULT_API_URL };
