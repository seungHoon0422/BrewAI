// GET /api/admin/skills — 제품 스킬 카탈로그 (읽기 전용). MCP 서버 목록은 P3.
import { AdminApiError, call, isObj, num, str, strs } from '../../shared/http';

export type AdminSkill = {
  name: string; label: string; description: string; tools: string[]; version: string; source: string; builtin: boolean; used: number; lines: number;
};
export type SkillCatalog = { source: string; skills: AdminSkill[]; errors: { dir: string; code: string; message: string }[] };

export async function listAdminSkills(signal?: AbortSignal): Promise<SkillCatalog> {
  const data = await call('/api/admin/skills', { signal });
  if (!isObj(data) || !Array.isArray(data.skills)) throw new AdminApiError('server', 'bad_shape');
  return {
    source: str(data.source, 'runtime/skills'),
    skills: data.skills.filter(isObj).map((k) => ({
      name: str(k.name), label: str(k.label, str(k.name)), description: str(k.description), tools: strs(k.tools),
      version: str(k.version), source: str(k.source), builtin: k.builtin === true, used: num(k.used) ?? 0, lines: num(k.lines) ?? 0,
    })),
    errors: Array.isArray(data.errors)
      ? data.errors.filter(isObj).map((e) => ({ dir: str(e.dir), code: str(e.code), message: str(e.message) }))
      : [],
  };
}
