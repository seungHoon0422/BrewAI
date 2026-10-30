import { Button, Spinner, StatusDot, cx, type DotState } from '@brewai/ui';
import type { AdminModel } from '../api';
import { COPY } from '../copy';
import { ago, canProbe, failed, fixFor, latency } from '../derive';
import type { Probe, TestState } from '../hooks';

// tail = 뒤 꼬리 ('3분 전' · 방금 테스트했으면 '412ms'). result = 꼬리가 테스트 결과(응답 시간)인지 → 결과면 읽어 주고, 흐르는 시간이면 안 읽는다
type Line = { health: 'ok' | 'error' | 'unknown' | 'running'; dot: DotState | null; text: string; tail: string | null; result?: boolean; title?: string };

// 마지막 결과 한 줄 = 대화 · 연결 테스트 중 나중 것. 이 화면에서 방금 테스트했으면 그 결과 (정상 = 응답 시간 · 실패 = 이유)
export function healthLine(m: AdminModel, test: TestState | undefined, now: number): Line {
  if (test?.phase === 'running') return { health: 'running', dot: null, text: COPY.testing, tail: null };
  if (test?.phase === 'error') return { health: 'unknown', dot: 'warn', text: COPY.testError(test.down), tail: null, title: COPY.done.probeError(m.label, test.down) };
  const bad = failed(m);
  const at = bad ? m.last_error_at : m.last_ok_at;
  if (bad) {
    const err = m.last_error_code ? fixFor(m, m.last_error_code) : null;
    return { health: 'error', dot: 'warn', text: err?.short ?? COPY.healthBad, tail: ago(at, now), title: err?.hint };
  }
  if (!at) return { health: 'unknown', dot: 'idle', text: COPY.healthUnknown, tail: null };
  const fresh = test?.phase === 'done' && test.ok && test.at === m.last_ok_at;
  return { health: 'ok', dot: 'ok', text: COPY.healthOk, tail: fresh ? latency(test.ms) : ago(at, now), result: fresh, title: fresh ? COPY.okAt(ago(at, now) ?? '') : undefined };
}

// 점 + 글. live = 이 화면에서 테스트한 줄만 결과를 그 자리에서 읽어 준다 (role=status 는 화면 위 알림 줄 하나만).
// 흐르는 시간('2분 전')은 읽는 칸 밖 → 30초마다 · 다시 읽을 때마다 줄마다 읽어 대지 않는다
export function HealthText({ line, live = false }: { line: Line; live?: boolean }) {
  const tail = line.tail && <span className="tm"> · {line.tail}</span>;
  return (
    <span className="hl" data-health={line.health} title={line.title}>
      {line.dot ? <StatusDot size="sm" state={line.dot} /> : <Spinner size="xs" />}
      <span className="ht ui-ell" aria-live={live ? 'polite' : undefined}>{line.text}{line.result && tail}</span>
      {!line.result && tail}
    </span>
  );
}

// 연결 칸 = 마지막 결과 한 줄 + [테스트] (보이는 글 버튼). 누르면 그 자리에서: 돌림표 → '정상 · 412ms' | 이유 + 고치는 곳(둘째 줄).
// 표 · 후보 줄 = '테스트' · 자세히 페이지 머리(head) = '연결 테스트' + 한 줄만 (고치는 곳은 '연결' 카드에)
export function Health({ m, test, onProbe, now, head }: { m: AdminModel; test: TestState | undefined; onProbe: Probe; now: number; head?: boolean }) {
  const line = healthLine(m, test, now);
  const running = line.health === 'running';
  const fix = !head && line.health === 'error' ? line.title : undefined;
  return (
    <div className={cx('hcell', head && 'head')}>
      <div className="hrow">
        <HealthText line={line} live={test !== undefined} />
        {canProbe(m) && (
          // 도는 동안 = aria-disabled (진짜 disabled 면 포커스가 body 로 빠진다). 두 번 누름은 probe() 가 막는다
          <Button size="sm" className="hprobe" aria-disabled={running || undefined} title={COPY.probeTitle}
            aria-label={head ? undefined : COPY.probeLabel(m.label)} icon={head ? 'plug' : undefined} onClick={() => { if (!running) void onProbe(m); }}>
            {head ? COPY.probe : COPY.probeShort}
          </Button>
        )}
      </div>
      {fix && <span className="hfix" title={fix}>{fix}</span>}
    </div>
  );
}
