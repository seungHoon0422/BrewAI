import { Button, LinkButton } from '@brewai/ui';
import type { GatewayInfo } from '../api';
import { COPY } from '../copy';
import { ago } from '../derive';

// 마지막 동기화 시각 (탭 줄 오른쪽 · 모델 추가 2단계)
export function LastSync({ gateway, now }: { gateway: GatewayInfo | null; now: number }) {
  const last = ago(gateway?.last_sync_at ?? null, now);
  return (
    <span className="msync-at">
      {last ? <>{COPY.lastSync} <time dateTime={gateway?.last_sync_at ?? undefined}>{last}</time></> : COPY.neverSynced}
    </span>
  );
}

export function SyncButton({ syncing, loading, onSync }: { syncing: boolean; loading: boolean; onSync: () => void }) {
  return (
    <Button size="sm" icon="refresh" loading={syncing} disabled={loading} title={COPY.syncTitle} onClick={onSync}>
      {syncing ? COPY.syncing : COPY.sync}
    </Button>
  );
}

// LiteLLM Admin UI 새 탭 (등록은 LiteLLM 에서만). 주소를 모르면 (conductor 꺼짐) 못 누르는 버튼
export function AddInLitellm({ gateway }: { gateway: GatewayInfo | null }) {
  return gateway?.ui_url ? (
    <LinkButton variant="primary" icon="external" href={gateway.ui_url} target="_blank" rel="noopener noreferrer" title={COPY.addTitle(gateway.ui_url)}>
      {COPY.addInLitellm}
    </LinkButton>
  ) : (
    <Button icon="external" disabled title={COPY.addOffTitle}>
      {COPY.addInLitellm}
    </Button>
  );
}

// 모델 목록 탭 줄 오른쪽: 마지막 동기화 · 동기화 · 모두 시험
export function SyncBar({ gateway, now, syncing, loading, canProbeAll, probing, onSync, onProbeAll }: {
  gateway: GatewayInfo | null;
  now: number;
  syncing: boolean;
  loading: boolean;
  canProbeAll: boolean;
  probing: boolean;
  onSync: () => void;
  onProbeAll: () => void;
}) {
  return (
    <span className="msync">
      <LastSync gateway={gateway} now={now} />
      <SyncButton syncing={syncing} loading={loading} onSync={onSync} />
      <Button size="sm" icon="plug" disabled={probing || !canProbeAll} title={COPY.probeAllTitle} onClick={onProbeAll}>
        {COPY.probeAll}
      </Button>
    </span>
  );
}
