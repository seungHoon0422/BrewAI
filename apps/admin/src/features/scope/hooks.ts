import { useContext, useEffect, useMemo } from 'react';
import { ScopeContext, type ScopeState } from './context';
import { visiblePath, type ScopePath } from './model';

export function useScope(): ScopeState {
  const ctx = useContext(ScopeContext);
  if (!ctx) throw new Error('useScope: <ScopeProvider> 밖에서 불렀다');
  return ctx;
}

// 화면에 보일 경로 (조직이 하나면 조직 칸을 뺀 것)
export function useScopePath(): ScopePath {
  const { path, tenants } = useScope();
  return useMemo(() => visiblePath(path, { tenants }), [path, tenants]);
}

// 화면이 자기 자원의 path 를 올린다 (떠나면 비운다). path 는 API 응답 그대로 — 화면이 층을 조립하지 않는다
export function usePublishScopePath(path: ScopePath | null | undefined) {
  const { setPath } = useScope();
  const key = path ? path.map((c) => `${c.kind}:${c.id}:${c.name}`).join('/') : '';
  useEffect(() => {
    setPath(path ?? []);
    return () => setPath([]);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}
