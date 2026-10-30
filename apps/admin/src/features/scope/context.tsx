// 지금 보고 있는 범위 (화면 머리 breadcrumb 가 그린다). 화면은 API 가 준 path 를 usePublishScopePath 로 올리기만 한다.
import { createContext, useMemo, useState, type ReactNode } from 'react';
import type { ScopePath } from './model';

export type ScopeState = {
  path: ScopePath;
  setPath: (path: ScopePath) => void;
  tenants?: number; // 볼 수 있는 조직 수 (모르면 undefined → 조직 칸을 숨기지 않는다)
  setTenants: (n: number | undefined) => void;
};

export const ScopeContext = createContext<ScopeState | null>(null);

export function ScopeProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState<ScopePath>([]);
  const [tenants, setTenants] = useState<number | undefined>(undefined);
  const value = useMemo(() => ({ path, setPath, tenants, setTenants }), [path, tenants]);
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}
