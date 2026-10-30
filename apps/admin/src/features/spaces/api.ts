// 스페이스 = conductor GET /api/admin/spaces (읽기 전용). 공유 스페이스만 줄로 · 내 스페이스(개인)는 개수만 — 내용은 본인만 본다 (ADR-0011).
// 대화 내용 · 제목은 관리자 API 에 없다. 멤버 · 보관은 스페이스 관리자가 데스크톱 앱에서 바꾼다 (관리자 API 에 바꾸는 경로 없음).
import { call, expectObj, num, objs, str, strOrNull } from '../../shared/http';
import { parsePath, pathOf, type ScopePath } from '../scope/model';

export type Visibility = 'open' | 'private'; // 조직 누구나 찾아 들어옴 · 초대된 멤버만
export type AdminSpace = {
  id: string;
  org_id: string;
  org_name: string;
  name: string;
  description: string;
  visibility: Visibility;
  archived_at: string | null;
  created_at: string;
  member_count: number;
  project_count: number;
  path: ScopePath; // [조직, 스페이스] — 서버가 path 를 주면 그것, 아니면 범위 모델로 만든다
};
export type SpaceDirectory = { shared: AdminSpace[]; personal_count: number };

export async function listAdminSpaces(signal?: AbortSignal): Promise<SpaceDirectory> {
  const d = expectObj(await call('/api/admin/spaces', { signal }));
  return {
    shared: objs(d.shared).map((s) => {
      const id = str(s.id);
      const org_id = str(s.org_id);
      const name = str(s.name);
      const org_name = str(s.org_name);
      return {
        id, org_id, org_name, name,
        description: str(s.description),
        visibility: s.visibility === 'private' ? 'private' : 'open',
        archived_at: strOrNull(s.archived_at),
        created_at: str(s.created_at),
        member_count: num(s.member_count) ?? 0,
        project_count: num(s.project_count) ?? 0,
        path: parsePath(s.path) ?? pathOf(['tenant', org_id, org_name], ['membership', id, name]),
      };
    }),
    personal_count: num(d.personal_count) ?? 0,
  };
}
