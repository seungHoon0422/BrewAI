import { cx } from '@brewai/ui';
import { COPY, type StateFilter } from '../copy';
import type { Counts } from '../derive';

type CardKey = Exclude<StateFilter, 'all'>;
type Tone = 'info' | 'bad';

// 요약 카드 = 누르면 그 상태만 (상태 거르개와 같은 값). 모양 = @brewai/ui StatCard 와 같은 클래스(ui-stat*)
// + E2E 고리(.mstat[data-card] · .v · .sub · 숫자 색 클래스 info|bad)를 그대로 둔다.
function SummaryCard({ k, label, value, sub, pressed, tone, onPick }: {
  k: CardKey; label: string; value: number | string; sub: string; pressed: boolean; tone?: Tone; onPick: (f: CardKey) => void;
}) {
  return (
    <button type="button" className="ui-stat mstat" data-card={k} aria-pressed={pressed} onClick={() => onPick(k)}
      title={pressed ? COPY.card.toAll : COPY.card.only(label)}>
      <span className="ui-stat-label k">{label}</span>
      <span className={cx('ui-stat-value ui-num v', tone, value === '—' && 'none')} data-tone={tone === 'bad' ? 'danger' : tone}>{value}</span>
      <span className="ui-stat-sub sub">{sub}</span>
    </button>
  );
}

export function SummaryCards({ counts, ready, filter, onPick }: { counts: Counts; ready: boolean; filter: StateFilter; onPick: (f: CardKey) => void }) {
  const n = (v: number) => (ready ? v : '—'); // 불러오는 중 · 오류면 숫자를 안 보인다
  const c = COPY.card;
  return (
    <div className="mstats">
      <SummaryCard k="exposed" label={c.exposed.label} value={n(counts.exposed)} sub={c.exposed.sub} pressed={filter === 'exposed'} onPick={onPick} />
      <SummaryCard k="candidate" label={c.candidate.label} value={n(counts.candidate)} sub={c.candidate.sub} pressed={filter === 'candidate'}
        tone={counts.candidate > 0 ? 'info' : undefined} onPick={onPick} />
      <SummaryCard k="hidden" label={c.hidden.label} value={n(counts.hidden + counts.missing)} pressed={filter === 'hidden'} onPick={onPick}
        sub={counts.missing > 0 ? c.hidden.subMissing(counts.missing) : c.hidden.sub} />
      <SummaryCard k="problem" label={c.problem.label} value={n(counts.problem)} pressed={filter === 'problem'}
        sub={counts.problem > 0 ? c.problem.subBad : counts.untested > 0 ? c.problem.subUntested(counts.untested) : c.problem.subClean}
        tone={counts.problem > 0 ? 'bad' : undefined} onPick={onPick} />
    </div>
  );
}
