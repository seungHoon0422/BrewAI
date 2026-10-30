// 설정 화면 문구 (읽기 전용 · 값은 서버 설정에서 온다 — 콘솔은 키 · 비밀값을 갖지 않는다)
export const SETTINGS_ROWS = [
  { key: 'gateway', label: '게이트웨이 URL', value: '미설정', from: ['서버 .env · ', 'LLM_GATEWAY_URL'] },
  { key: 'langfuse', label: 'Langfuse 리전', value: '미정(JP 추천)', from: ['결정 대기 · 한국 리전 없음'] },
  { key: 'retention', label: '데이터 보관', value: '—', from: ['P6에서 정책과 함께'] },
] as const;
