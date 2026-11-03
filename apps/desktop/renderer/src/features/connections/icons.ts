// 앱 아이콘 = conductor 가 받아 둔 서버 사이트 그림 (GET …/icon · 200 그림 · 204 없음). 데스크톱은 우리 API 만 부른다 (CSP connect-src)
// → 받은 그림을 data: 주소로 바꿔 <img> 에 (CSP img-src 'self' data: 그대로 · 바깥 주소 0). 같은 경로는 앱이 켜 있는 동안 한 번만.
// 없음 · 그림 아님 · 너무 큼 = null (화면은 머리글자). 접속 실패는 캐시하지 않는다 (다음에 다시)
import { useEffect, useState } from 'react';
import { call } from '../../lib/api';

const MAX = 64 * 1024; // conductor connectors/icons.py MAX_BYTES 와 같게
const cache = new Map<string, Promise<string | null>>();
const done = new Map<string, string | null>(); // 다 받은 것 (처음 그릴 때 깜빡이지 않게)

const toDataUrl = (blob: Blob) =>
  new Promise<string | null>((ok) => {
    const r = new FileReader();
    r.onload = () => ok(typeof r.result === 'string' && r.result.startsWith('data:image/') ? r.result : null);
    r.onerror = () => ok(null);
    r.readAsDataURL(blob);
  });

async function load(path: string): Promise<string | null> {
  try {
    const res = await call(path, { headers: { accept: 'image/png,image/x-icon,image/webp,image/gif,image/jpeg' } });
    if (res.status !== 200) return null;
    const blob = await res.blob();
    if (!/^image\/(png|x-icon|vnd\.microsoft\.icon|webp|gif|jpeg)$/.test(blob.type) || !blob.size || blob.size > MAX) return null;
    return await toDataUrl(blob);
  } catch {
    cache.delete(path);
    return null;
  }
}

export function iconSrc(path: string): Promise<string | null> {
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

// path = null → 받지 않는다 (머리글자만)
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
