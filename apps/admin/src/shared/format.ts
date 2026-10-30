// 시각 · 날짜 글 (문구는 copy.ts COMMON_COPY). 서버 시각 = ISO 문자열
import { COMMON_COPY as C } from './copy';

const parse = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);

// '방금' · '3분 전' · '2시간 전' · '4일 전' · 그 뒤로는 날짜. 없으면 null
export function ago(iso: string | null | undefined, now = Date.now()): string | null {
  const t = parse(iso);
  if (!Number.isFinite(t)) return null;
  const s = Math.round((now - t) / 1000);
  if (s < 45) return C.ago.now;
  if (s < 3600) return C.ago.min(Math.max(1, Math.round(s / 60)));
  if (s < 86400) return C.ago.hour(Math.round(s / 3600));
  if (s < 7 * 86400) return C.ago.day(Math.round(s / 86400));
  return dateText(iso);
}

// 남은 시간 ('6일 남음' · '25분 남음' · '지남')
export function left(iso: string | null | undefined, now = Date.now()): string | null {
  const t = parse(iso);
  if (!Number.isFinite(t)) return null;
  const s = Math.round((t - now) / 1000);
  if (s <= 0) return C.until.passed;
  const text = s < 3600 ? C.until.min(Math.max(1, Math.round(s / 60))) : s < 86400 ? C.until.hour(Math.round(s / 3600)) : C.until.day(Math.round(s / 86400));
  return C.until.left(text);
}

export function dateText(iso: string | null | undefined): string | null {
  const t = parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }) : null;
}

export function dateTimeText(iso: string | null | undefined): string | null {
  const t = parse(iso);
  return Number.isFinite(t)
    ? new Date(t).toLocaleString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;
}
