import { Button, LinkButton } from '@brewai/ui';
import type { GatewayInfo } from '../api';
import { COPY } from '../copy';
import { ago } from '../derive';

// 동기화 줄: 마지막 동기화 시각 + 동기화 · 모두 시험 · LiteLLM 에서 추가 (등록은 LiteLLM 에서만 — 새 탭)
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
  const last = ago(gateway?.last_sync_at ?? null, now);
  return (
    <div className="msync">
      <span className="msync-at">
        {last ? <>{COPY.lastSync} <time dateTime={gateway?.last_sync_at ?? undefined}>{last}</time></> : COPY.neverSynced}
      </span>
      <span className="msync-btns">
        <Button icon="refresh" loading={syncing} disabled={loading} title={COPY.syncTitle} onClick={onSync}>
          {syncing ? COPY.syncing : COPY.sync}
        </Button>
        <Button icon="plug" disabled={probing || !canProbeAll} title={COPY.probeAllTitle} onClick={onProbeAll}>
          {COPY.probeAll}
        </Button>
        {gateway?.ui_url ? (
          <LinkButton icon="external" href={gateway.ui_url} target="_blank" rel="noopener noreferrer" title={COPY.addTitle(gateway.ui_url)}>
            {COPY.addInLitellm}
          </LinkButton>
        ) : (
          <Button icon="external" disabled title={COPY.addOffTitle}>
            {COPY.addInLitellm}
          </Button>
        )}
      </span>
    </div>
  );
}
