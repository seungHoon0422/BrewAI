// 게이트웨이 카드 = conductor GET /api/admin/models 의 실제 결과 (모델 화면과 같은 호출 · 읽기 전용)
import { useEffect, useState } from 'react';
import { loadErrorOf, type LoadError } from '../../shared/http';
import { listAdminModels, type AdminModel } from '../models/api';
import { EXPOSED, GATEWAY, GATEWAY_DOWN, OVERVIEW_COPY as C, type Stat } from './copy';

export type GatewayLoad = { kind: 'loading' } | { kind: 'ok'; rows: AdminModel[] } | { kind: 'error'; error: LoadError };

export function useGateway(): GatewayLoad {
  const [gateway, setGateway] = useState<GatewayLoad>({ kind: 'loading' });
  useEffect(() => {
    const ctrl = new AbortController();
    listAdminModels(ctrl.signal).then(
      (rows) => setGateway({ kind: 'ok', rows }),
      (e) => {
        const error = loadErrorOf(e);
        if (error) setGateway({ kind: 'error', error });
      },
    );
    return () => ctrl.abort();
  }, []);
  return gateway;
}

export function gatewayStats(g: GatewayLoad): Stat[] {
  if (g.kind === 'loading') {
    return [
      { label: GATEWAY, value: C.checking, sub: C.litellm, icon: 'plug' },
      { label: EXPOSED, value: '—', sub: C.exposedLoading, icon: 'cube' },
    ];
  }
  if (g.kind === 'error') {
    return [
      { label: GATEWAY, ...GATEWAY_DOWN[g.error], icon: 'plug' },
      { label: EXPOSED, value: '—', sub: C.afterGateway, icon: 'cube' },
    ];
  }
  // 게이트웨이에 지금 있는 모델만 센다 (사라진 모델은 따로)
  const present = g.rows.filter((r) => r.status === 'present');
  const shown = present.filter((r) => r.state === 'exposed').length;
  const candidates = present.filter((r) => r.state === 'candidate').length;
  const missing = g.rows.length - present.length;
  const providers = new Set(present.map((r) => r.provider)).size;
  return [
    { label: GATEWAY, value: C.connected, sub: C.gatewaySub(present.length, providers), icon: 'plug' },
    { label: EXPOSED, value: String(shown), sub: C.exposedSub(candidates, present.length - shown - candidates, missing), icon: 'cube' },
  ];
}
