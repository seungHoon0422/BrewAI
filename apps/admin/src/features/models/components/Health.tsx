import { Button, LinkButton, StatusDot, cx } from '@brewai/ui';
import type { AdminModel } from '../api';
import { COPY } from '../copy';
import { ago, canProbe, failed, fixFor } from '../derive';
import type { Probe } from '../hooks';

// 연결 칸: 마지막 결과(대화 · 연결 시험 중 나중 것) 한 줄 + '연결 시험'. 고치는 곳은 툴팁 · 서랍(wide)에
export function Health({ m, busy, onProbe, now, label = COPY.probeLabel(m.label), wide, fixUrl }: {
  m: AdminModel; busy: boolean; onProbe: Probe; now: number; label?: string; wide?: boolean; fixUrl?: string;
}) {
  const bad = failed(m);
  const at = bad ? m.last_error_at : m.last_ok_at;
  const err = bad && m.last_error_code ? fixFor(m, m.last_error_code) : null;
  return (
    <div className={cx('hcell', wide && 'wide')}>
      <span className="hl" data-health={bad ? 'error' : at ? 'ok' : 'unknown'} title={err ? err.hint : undefined}>
        <StatusDot size="sm" state={bad ? 'warn' : at ? 'ok' : 'idle'} />
        {bad ? err?.short ?? COPY.healthBad : at ? COPY.healthOk : COPY.healthUnknown}
        {at && <span className="tm"> · {ago(at, now)}</span>}
      </span>
      {wide && err && <span className="hhint">{err.hint}</span>}
      {(canProbe(m) || (wide && err?.litellm && fixUrl)) && (
        <span className="hbtns">
          {canProbe(m) && (
            <Button size="sm" loading={busy} aria-label={label} title={COPY.probeTitle} onClick={() => void onProbe(m)}>
              {COPY.probe}
            </Button>
          )}
          {wide && err?.litellm && fixUrl && (
            <LinkButton size="sm" icon="external" href={fixUrl} target="_blank" rel="noopener noreferrer" title={COPY.addTitle(fixUrl)}>
              {COPY.fixInLitellm}
            </LinkButton>
          )}
        </span>
      )}
    </div>
  );
}
