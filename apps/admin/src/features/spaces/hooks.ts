// 스페이스 탭 상태 = 서버 목록 + 거르기 (조직 · 보관 · 이름) + 연 줄
import { useMemo, useState } from 'react';
import { useLoad } from '../../shared/load';
import { listAdminSpaces, type AdminSpace } from './api';

export function useSpaces() {
  return useLoad(listAdminSpaces);
}

export function useSpaceView(rows: readonly AdminSpace[]) {
  const [org, setOrg] = useState(''); // '' = 모든 조직
  const [archived, setArchived] = useState(false);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const orgs = useMemo(() => {
    const seen = new Map<string, string>();
    rows.forEach((s) => seen.set(s.org_id, s.org_name));
    return [...seen].map(([value, label]) => ({ value, label }));
  }, [rows]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((s) => (!org || s.org_id === org) && (archived || !s.archived_at) && (!q || s.name.toLowerCase().includes(q)));
  }, [rows, org, archived, query]);
  return { org, setOrg, archived, setArchived, query, setQuery, orgs, shown, open: rows.find((s) => s.id === openId) ?? null, setOpenId };
}
