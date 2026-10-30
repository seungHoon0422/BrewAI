// 스킬 · 도구 목록. 제품 스킬 = conductor runtime/skills · 도구 = conductor 가 가진 툴 (승인 · 정책은 서버 몫)
import { isObj, json, num, str } from '../../lib/api';

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
