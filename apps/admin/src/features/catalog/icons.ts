// 서버 아이콘 = conductor 가 받아 둔 서버 사이트 그림 (GET …/icon · 200 그림 · 204 없음 · 같은 출처 쿠키). 콘솔은 바깥 사이트를 직접 부르지 않는다.
// 받은 그림 → data: 주소 (깨진 그림 · 204 를 <img> 로 받지 않게 = 콘솔 오류 없음) · 같은 경로는 한 번만. 없음 = null (화면은 첫 글자)
import { useEffect, useState } from 'react';
import { API_URL } from '../../shared/http';

const MAX = 64 * 1024; // conductor connectors/icons.py MAX_BYTES
const cache = new Map<string, Promise<string | null>>();
const done = new Map<string, string | null>();

const toDataUrl = (blob: Blob) =>
  new Promise<string | null>((ok) => {
    const r = new FileReader();
    r.onload = () => ok(typeof r.result === 'string' && r.result.startsWith('data:image/') ? r.result : null);
    r.onerror = () => ok(null);
    r.readAsDataURL(blob);
  });

async function load(path: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, { credentials: 'same-origin', headers: { accept: 'image/*' } });
    if (res.status !== 200) return null;
    const blob = await res.blob();
    if (!/^image\/(png|x-icon|vnd\.microsoft\.icon|webp|gif|jpeg)$/.test(blob.type) || !blob.size || blob.size > MAX) return null;
    return await toDataUrl(blob);
  } catch {
    cache.delete(path); // 접속 실패 = 다음에 다시
    return null;
  }
}

function iconSrc(path: string): Promise<string | null> {
  let p = cache.get(path);
  if (!p) {
    p = load(path).then((src) => {
      if (cache.has(path)) done.set(path, src);
      return src;
    });
    cache.set(path, p);
  }
  return p;
}

export function useIconSrc(path: string | null): string | null {
  const [src, setSrc] = useState<string | null>(() => (path ? done.get(path) ?? null : null));
  useEffect(() => {
    if (!path) return setSrc(null);
    let live = true;
    setSrc(done.get(path) ?? null);
    void iconSrc(path).then((s) => { if (live) setSrc(s); });
    return () => { live = false; };
  }, [path]);
  return src;
}
