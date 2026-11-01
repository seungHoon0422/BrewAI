// 숫자 · 시간을 읽는 말로 (여러 기능이 같이 쓴다). 결정적 — 같은 값이면 같은 글 (테스트가 본다).

// 1234567 → 1,234,567 (천 단위 쉼표 · 토큰 · 횟수 · 글자 수)
export const count = (n: number) => n.toLocaleString('ko-KR');

// 128000 → 128K · 1000000 → 1M
export const tokensShort = (n: number | null | undefined) =>
  n == null ? null : n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n);

// 걸린 시간: 0.4초 · 12초 · 1분 5초
export function seconds(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '';
  const s = Math.max(0, ms) / 1000;
  if (s < 10) return `${s.toFixed(1)}초`;
  if (s < 60) return `${Math.round(s)}초`;
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return r ? `${m}분 ${r}초` : `${m}분`;
}

// '방금' · '3분 전' · '2시간 전' · '10월 28일'
export function ago(iso: string | null | undefined, now = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '';
  const s = Math.round((now - t) / 1000);
  if (s < 45) return '방금';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}분 전`;
  if (s < 86400) return `${Math.round(s / 3600)}시간 전`;
  const d = new Date(t);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

// 대화 제목 = 첫 줄 (80자까지)
export const titleOf = (text: string) => {
  const line = text.split('\n').map((l) => l.trim()).find(Boolean) ?? text.trim();
  return line.length <= 80 ? line : `${line.slice(0, 79)}…`;
};
