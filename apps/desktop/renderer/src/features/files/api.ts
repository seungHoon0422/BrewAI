// 파일 (slice 07 · ADR-0015) — 올리기 · 목록 · 지우기 · 전달 계획 · 미리보기. 판정은 서버 (conductor api_files.py · files.py).
// 올리기 = PUT /api/files 본문 그대로 (바이트를 대화 요청에 싣지 않는다 · 대화엔 id 만).
import { ApiError, call, isObj, json, list, num, send, str, strOrNull } from '../../lib/api';
import { bridge, type SaveResult } from '../../lib/bridge';

export type FileKind = 'image' | 'pdf' | 'text' | 'docx' | 'xlsx' | 'pptx';
export type Where = { kind: 'thread' | 'project' | 'draft'; id: string | null; title: string | null };
export type FileItem = {
  id: string; name: string; kind: FileKind; mime: string; size: number; pages: number | null; text_tokens: number;
  space_id: string; project_id: string | null; thread_id: string | null; run_id: string | null; owner_name: string | null; created_at: string;
  where: Where;
};
export type Mode = 'original' | 'text' | 'outline' | 'blocked';
export type Plan = { id: string; mode: Mode; tokens: number; reason: string | null };

export const MAX_BYTES = 25 * 1024 * 1024; // files.py MAX_BYTES 와 같게 (넘으면 보내기 전에 막는다 · 판정은 서버)
const KINDS: FileKind[] = ['image', 'pdf', 'text', 'docx', 'xlsx', 'pptx'];
const MODES: Mode[] = ['original', 'text', 'outline', 'blocked'];

export function toFile(v: Record<string, unknown>): FileItem {
  const w = isObj(v.where) ? v.where : {};
  const wk = w.kind === 'thread' || w.kind === 'project' ? w.kind : 'draft';
  return {
    id: str(v.id), name: str(v.name, '파일'), kind: KINDS.find((k) => k === v.kind) ?? 'text', mime: str(v.mime), size: num(v.size) ?? 0,
    pages: num(v.pages), text_tokens: num(v.text_tokens) ?? 0, space_id: str(v.space_id), project_id: strOrNull(v.project_id),
    thread_id: strOrNull(v.thread_id), run_id: strOrNull(v.run_id), owner_name: strOrNull(v.owner_name), created_at: str(v.created_at),
    where: { kind: wk, id: strOrNull(w.id), title: strOrNull(w.title) },
  };
}

export async function uploadFile(file: Blob, name: string, q: { space?: string | null; project?: string | null }, signal?: AbortSignal): Promise<FileItem> {
  const p = new URLSearchParams({ name });
  if (q.space) p.set('space', q.space);
  if (q.project) p.set('project', q.project);
  const res = await call(`/api/files?${p}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream', accept: 'application/json' }, body: file, signal });
  const data: unknown = await res.json().catch(() => null);
  if (!isObj(data)) throw new ApiError('server', 'bad_shape');
  return toFile(data);
}

export async function listFiles(q: { space?: string | null; project?: string | null; thread?: string | null }, signal?: AbortSignal): Promise<FileItem[]> {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v) p.set(k, v);
  return list(await json(`/api/files?${p}`, signal)).map(toFile);
}

export const deleteFile = (id: string) => send(`/api/files/${encodeURIComponent(id)}`, 'DELETE');

export async function planFiles(model: string | null, files: string[]): Promise<Plan[]> {
  if (!files.length) return [];
  const data = await send('/api/files/plan', 'POST', { model, files });
  return list(data).map((p) => ({
    id: str(p.id), mode: MODES.find((m) => m === p.mode) ?? 'text', tokens: num(p.tokens) ?? 0, reason: strOrNull(p.reason),
  }));
}

// 이미지 미리보기 = 우리 API 로 받아 data: 주소로 (CSP img-src 'self' data: · 바깥 주소 0). 앱이 켜 있는 동안 한 번만
const thumbs = new Map<string, Promise<string | null>>();
export function thumbOf(id: string): Promise<string | null> {
  let p = thumbs.get(id);
  if (!p) {
    p = call(`/api/files/${encodeURIComponent(id)}/content`).then((r) => r.blob()).then((b) => dataUrl(b)).catch(() => {
      thumbs.delete(id);
      return null;
    });
    thumbs.set(id, p);
  }
  return p;
}

export const dataUrl = (blob: Blob) =>
  new Promise<string | null>((ok) => {
    const r = new FileReader();
    r.onload = () => ok(typeof r.result === 'string' && r.result.startsWith('data:image/') ? r.result : null);
    r.onerror = () => ok(null);
    r.readAsDataURL(blob);
  });

// 만든 파일 (make_file 결과 = 답의 도구 칸) — {id, name, kind, size} · 모양이 틀리면 null
export type MadeFile = { id: string; name: string; kind: FileKind; size: number };
export function madeFile(result: unknown): MadeFile | null {
  const f = isObj(result) && isObj(result.file) ? result.file : null;
  if (!f || typeof f.id !== 'string' || typeof f.name !== 'string') return null;
  return { id: f.id, name: f.name, kind: KINDS.find((k) => k === f.kind) ?? 'text', size: num(f.size) ?? 0 };
}

// 저장 = 우리 API 에서 받아 → main 의 저장 대화상자 (어디에 쓸지는 사람이 고른다 · 데스크톱만). 다리 없음(브라우저) = 내려받기 링크
export async function saveFile(f: { id: string; name: string }): Promise<SaveResult> {
  let blob: Blob;
  try {
    blob = await (await call(`/api/files/${encodeURIComponent(f.id)}/content`)).blob();
  } catch (e) {
    return { ok: false, code: e instanceof ApiError && e.kind === 'not_found' ? 'gone' : 'fetch_failed' };
  }
  if (!bridge?.files) {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: f.name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { ok: true, name: f.name };
  }
  try {
    return await bridge.files.save({ name: f.name, bytes: new Uint8Array(await blob.arrayBuffer()) });
  } catch {
    return { ok: false, code: 'write_failed' };
  }
}

// 미리보기 서랍 (PDF 쪽 그림 · GET /api/files/{id}/pages/{n} · 1부터) = data: 주소 (CSP img-src 'self' data:) · 앱이 켜 있는 동안 한 번만
const pages = new Map<string, Promise<string | null>>();
export function pageOf(id: string, n: number): Promise<string | null> {
  const key = `${id}:${n}`;
  let p = pages.get(key);
  if (!p) {
    p = call(`/api/files/${encodeURIComponent(id)}/pages/${n}`).then((r) => r.blob()).then((b) => dataUrl(b)).catch(() => {
      pages.delete(key);
      return null;
    });
    pages.set(key, p);
  }
  return p;
}

export async function getFile(id: string, signal?: AbortSignal): Promise<FileItem> {
  const d = await json(`/api/files/${encodeURIComponent(id)}`, signal);
  if (!isObj(d)) throw new ApiError('server', 'bad_shape');
  return toFile(d);
}
