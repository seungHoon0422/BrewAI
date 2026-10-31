import { Button, Meta, Spinner, StatusDot, cx, type DotState } from '@brewai/ui';
import { ago, dateTimeText } from '../../../shared/format';
import type { AdminServer } from '../api';
import { MCP_COPY as C } from '../copy';
import { testCodeText, type TestState } from '../hooks';

// 연결 칸 = 점 + 결과 한 줄 (+ 꼬리: 도구 수 · 응답 시간 · 마지막 확인) [테스트]. 방금 테스트했으면 그 결과, 아니면 서버에 남은 마지막 결과
type Line = { dot: DotState | null; text: string; tail: (string | null)[]; title?: string; health: 'ok' | 'error' | 'unknown' | 'running' };

export function testLine(s: AdminServer, test: TestState | undefined, now: number): Line {
  if (test?.phase === 'running') return { dot: null, text: C.testing, tail: [], health: 'running' };
  if (test?.phase === 'error') return { dot: 'warn', text: C.testError, tail: [], title: test.text, health: 'unknown' };
  if (test?.phase === 'done') {
    const r = test.r;
    const ms = r.duration_ms !== null ? C.ms(r.duration_ms) : null;
    if (!r.ok) return { dot: 'warn', text: r.code ? testCodeText(r.code) : C.testFailed, tail: [ms], health: 'error' };
    if (r.code === 'needs_login') return { dot: 'ok', text: C.testNeedsLogin, tail: [ms], title: C.testNeedsLoginTitle, health: 'ok' };
    return { dot: 'ok', text: C.testOk, tail: [r.tool_count !== null ? C.testTools(r.tool_count) : null, ms], health: 'ok' };
  }
  const when = ago(s.last_checked_at, now);
  if (s.last_error) return { dot: 'warn', text: testCodeText(s.last_error), tail: [when], title: dateTimeText(s.last_checked_at) ?? undefined, health: 'error' };
  if (when) return { dot: 'ok', text: C.testOk, tail: [when], title: C.lastChecked(dateTimeText(s.last_checked_at) ?? when), health: 'ok' };
  return { dot: 'idle', text: C.never, tail: [], health: 'unknown' };
}

// live = 이 화면에서 누른 결과만 그 자리에서 읽어 준다 (흐르는 시간은 읽지 않는다)
export function TestCell({ s, test, now, onTest, head }: { s: AdminServer; test: TestState | undefined; now: number; onTest: (s: AdminServer) => void; head?: boolean }) {
  const line = testLine(s, test, now);
  const running = line.health === 'running';
  return (
    <div className={cx('mcp-test', head && 'head')}>
      <span className="mcp-hl" data-health={line.health} title={line.title}>
        {line.dot ? <StatusDot size="sm" state={line.dot} /> : <Spinner size="xs" />}
        <span className="mcp-ht" aria-live={test !== undefined ? 'polite' : undefined}>
          {line.text}
          {test?.phase === 'done' && <Meta className="mcp-tail" items={line.tail} />}
        </span>
        {test?.phase !== 'done' && <Meta className="mcp-tail" items={line.tail} />}
      </span>
      {/* 도는 동안 = aria-disabled (진짜 disabled 면 포커스가 body 로 빠진다) */}
      <Button size="sm" className="mcp-probe" aria-disabled={running || undefined} icon={head ? 'plug' : undefined}
        aria-label={head ? undefined : C.probeLabel(s.name)} onClick={() => { if (!running) onTest(s); }}>
        {head ? C.probe : C.probeShort}
      </Button>
    </div>
  );
}
