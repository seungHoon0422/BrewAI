// 입력창 첨부 (보내기 전) — 고르면 바로 올린다 → 칩 (올리는 중 · 됨 · 실패). 입력창마다 따로 (key = 대화 id · 새 대화 = 'new').
// 보내면 take() 로 꺼내 그 턴의 첨부가 된다. 전달 배지 = usePlans (모델이 바뀌면 다시 묻는다 · 판정은 서버 files.plan).
import { useEffect, useState } from 'react';
import { codeOf } from '../../lib/api';
import { createStore } from '../../lib/store';
import { MAX_BYTES, dataUrl, planFiles, uploadFile, type FileItem, type Plan } from './api';
import { fileError } from './copy';

export type Draft = {
  local: string; name: string; size: number; status: 'uploading' | 'ready' | 'error'; error: string | null; file: FileItem | null;
  preview: string | null; // 이미지 = 고른 파일에서 바로 (data: 주소)
  resized: boolean; // 큰 이미지를 긴 쪽 MAX_SIDE 로 줄여 올렸다
};

// 이미지는 올리기 전에 긴 쪽 2,048px 로 줄인다: 제공사 한도(Claude = 한 변 8,000px) 밖 거절을 막고, 모델은 어차피 줄여서 본다
// (Claude ≈ 1,568px · OpenAI ≈ 2,048px). GIF 는 움직임이 깨져서 그대로. 실패하면 원본 그대로 (서버가 판정)
const MAX_SIDE = 2048;
async function shrink(f: File): Promise<{ blob: Blob; resized: boolean }> {
  if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return { blob: f, resized: false };
  try {
    const bmp = await createImageBitmap(f);
    const scale = MAX_SIDE / Math.max(bmp.width, bmp.height);
    if (scale >= 1) {
      bmp.close();
      return { blob: f, resized: false };
    }
    const [w, h] = [Math.round(bmp.width * scale), Math.round(bmp.height * scale)];
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    return { blob: await canvas.convertToBlob({ type: f.type, quality: 0.92 }), resized: true };
  } catch {
    return { blob: f, resized: false };
  }
}
type State = { drafts: Record<string, Draft[]> };
const store = createStore<State>({ drafts: {} });
const EMPTY: Draft[] = [];

export const useDrafts = (key: string) => store.use((s) => s.drafts[key] ?? EMPTY);

function patch(key: string, local: string, fn: (d: Draft) => Draft) {
  store.set((s) => {
    const list = s.drafts[key];
    if (!list?.some((d) => d.local === local)) return s;
    return { drafts: { ...s.drafts, [key]: list.map((d) => (d.local === local ? fn(d) : d)) } };
  });
}

export function addFiles(key: string, picked: Iterable<File>, scope: { space: string | null; project: string | null }) {
  for (const f of picked) {
    const local = crypto.randomUUID();
    const tooBig = f.size > MAX_BYTES;
    const d: Draft = { local, name: f.name || '파일', size: f.size, status: tooBig ? 'error' : 'uploading', error: tooBig ? fileError('file_too_large') : null,
      file: null, preview: null, resized: false };
    store.set((s) => ({ drafts: { ...s.drafts, [key]: [...(s.drafts[key] ?? []), d] } }));
    if (tooBig) continue;
    if (f.type.startsWith('image/')) void dataUrl(f).then((preview) => patch(key, local, (x) => ({ ...x, preview })));
    void shrink(f).then(({ blob, resized }) => {
      if (resized) patch(key, local, (x) => ({ ...x, size: blob.size, resized }));
      return uploadFile(blob, d.name, { space: scope.space, project: null });
    }).then(
      (file) => patch(key, local, (x) => ({ ...x, status: 'ready', file })),
      (e) => patch(key, local, (x) => ({ ...x, status: 'error', error: fileError(codeOf(e)) })),
    );
  }
}

export function removeDraft(key: string, local: string) {
  store.set((s) => ({ drafts: { ...s.drafts, [key]: (s.drafts[key] ?? []).filter((d) => d.local !== local) } }));
}

export const uploading = (key: string) => (store.get().drafts[key] ?? []).some((d) => d.status === 'uploading');

// 보낼 때: 다 올린 것만 꺼내고 입력창 칩을 비운다 (실패한 칩도 같이 비운다)
export function take(key: string): FileItem[] {
  const list = store.get().drafts[key] ?? [];
  store.set((s) => ({ drafts: { ...s.drafts, [key]: [] } }));
  return list.flatMap((d) => (d.status === 'ready' && d.file ? [d.file] : []));
}

// 칩마다 전달 계획 (모델 · 파일이 바뀔 때만 다시 묻는다)
export function usePlans(ids: string[], model: string | null): Record<string, Plan> {
  const [plans, setPlans] = useState<Record<string, Plan>>({});
  const key = `${model ?? ''}|${ids.join(',')}`;
  useEffect(() => {
    if (!ids.length) return setPlans({});
    let live = true;
    planFiles(model, ids).then(
      (rows) => live && setPlans(Object.fromEntries(rows.map((p) => [p.id, p]))),
      () => live && setPlans({}),
    );
    return () => {
      live = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return plans;
}
