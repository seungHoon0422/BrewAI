import { useEffect, useState } from 'react';
import { isConductorDown } from '../../shared/http';
import { listAdminSkills, type SkillCatalog } from './api';
import { CATALOG_COPY as C } from './copy';

export type SkillLoad = { kind: 'loading' } | { kind: 'ok'; data: SkillCatalog } | { kind: 'error'; text: string };

export function useSkills() {
  const [state, setState] = useState<SkillLoad>({ kind: 'loading' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const ctrl = new AbortController();
    setState({ kind: 'loading' });
    listAdminSkills(ctrl.signal).then(
      (data) => setState({ kind: 'ok', data }),
      (e) => {
        if ((e as Error).name === 'AbortError') return;
        setState({ kind: 'error', text: isConductorDown(e) ? C.conductorDown : C.loadFailed });
      },
    );
    return () => ctrl.abort();
  }, [tick]);
  return { state, retry: () => setTick((t) => t + 1) };
}
