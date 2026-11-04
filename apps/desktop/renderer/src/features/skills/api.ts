// 스킬 · 도구 목록. 제품 스킬 = conductor runtime/skills · 도구 = conductor 가 가진 툴 (승인 · 정책은 서버 몫)
import { call, isObj, json, num, str } from '../../lib/api';
import { dataUrl } from '../files/api';

export type ToolInfo = { name: string; label: string; description: string };
// builtin = 레포에 든 스타터 · used = 쓴 실행 수
export type SkillInfo = { name: string; label: string; description: string; tools: string[]; builtin: boolean; used: number };

export async function listTools(signal?: AbortSignal): Promise<ToolInfo[]> {
  const data = await json('/api/tools', signal);
  return Array.isArray(data)
    ? data.filter(isObj).map((t) => ({ name: str(t.name), label: str(t.label, str(t.name)), description: str(t.description) })).filter((t) => t.name)
    : [];
}

export async function listSkills(signal?: AbortSignal): Promise<SkillInfo[]> {
  const data = await json('/api/skills', signal);
  return Array.isArray(data)
    ? data.filter(isObj).map((x) => ({
        name: str(x.name), label: str(x.label, str(x.name)), description: str(x.description),
        tools: Array.isArray(x.tools) ? x.tools.filter((t): t is string => typeof t === 'string') : [],
        builtin: x.builtin === true, used: num(x.used) ?? 0,
      })).filter((x) => x.name)
    : [];
}

// 문서 디자인 견본 (conductor designs.py · make_file design) — 이름 · 한 줄 설명 · 대표 색 · 견본 그림 (data: 주소 · CSP)
export type DesignInfo = { id: string; label: string; description: string; accent: string };

export async function listDesigns(signal?: AbortSignal): Promise<DesignInfo[]> {
  const data = await json('/api/designs', signal);
  return Array.isArray(data)
    ? data.filter(isObj).map((x) => ({
        id: str(x.id), label: str(x.label, str(x.id)), description: str(x.description),
        accent: isObj(x.colors) && typeof x.colors.accent === 'string' && /^#[0-9a-f]{6}$/i.test(x.colors.accent) ? x.colors.accent : '',
      })).filter((x) => x.id)
    : [];
}

const previews = new Map<string, Promise<string | null>>();
export function designPreview(id: string): Promise<string | null> {
  let p = previews.get(id);
  if (!p) {
    p = call(`/api/designs/${encodeURIComponent(id)}/preview.png`).then((r) => r.blob()).then(dataUrl).catch(() => {
      previews.delete(id);
      return null;
    });
    previews.set(id, p);
  }
  return p;
}
