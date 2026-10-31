// 차트 부품 — 의존성 없이 인라인 SVG (ADR-0012 · dataviz 규칙). 그리기만 한다: 값은 prop, 누르기는 href · onSelect.
//   TimeSeriesChart = 날짜 흐름 (선 · 옅은 면 · 십자선 풍선 · ← → 키 · 표 보기)
//   BarList         = 가로 막대 목록 (이름 · 값 글 · 누르면 그 대상으로)
//   ShareBar        = 한 줄 비중 막대 + 범례 (조각마다 풍선 · 범례 = 값 · 비율)
//   Sparkline       = 숫자 카드 아래 작은 흐름 (장식 · 값은 카드 글이 말한다)
//   StatTile        = 숫자 카드 (라벨 · 값 · 지난 기간 대비 · 작은 흐름 · 누르면 그 화면)
// 규칙: 축은 하나 (두 척도 = 차트 둘) · 색 = --viz-N 순서 고정 (돌려쓰지 않는다 · 9번째부터 other) · 글자는 글자색 토큰만
// · 선 2px · 막대 끝 둥글게 · 조각 사이 2px 면 틈 · 풍선은 덤 (같은 값이 표 · 글로 늘 있다).
import { useCallback, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { cx, flag } from './cx';
import { UI_COPY } from './copy';
import { Icon, renderIcon, type IconLike } from './icons';

export type VizColor = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 'other';
export const vizColor = (c: VizColor | undefined) => (c === 'other' ? 'var(--viz-other)' : `var(--viz-${c ?? 1})`);
// 순서로 색 하나 (0부터). 8개를 넘으면 other — 9번째 색을 만들지 않는다
export const vizSlot = (i: number): VizColor => (i >= 0 && i < 8 ? ((i + 1) as VizColor) : 'other');

const KO = new Intl.NumberFormat('ko-KR');
const KO_SHORT = new Intl.NumberFormat('ko-KR', { notation: 'compact', maximumFractionDigits: 1 });
export const formatNumber = (v: number) => KO.format(v);
export const formatCompact = (v: number) => (Math.abs(v) < 1000 ? KO.format(Math.round(v * 10) / 10) : KO_SHORT.format(v));

// 그릴 칸의 너비 (px). 처음엔 fallback, 그다음 ResizeObserver.
// 콜백 ref = 칸이 새로 붙을 때마다 다시 지켜본다 (표 보기 → 차트 보기로 칸이 바뀌어도) · 떼어 낸 칸의 0 은 읽지 않는다
function useWidth<T extends HTMLElement>(fallback: number) {
  const [width, setWidth] = useState(fallback);
  const ro = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    ro.current?.disconnect();
    ro.current = null;
    if (!el) return;
    const read = () => {
      if (el.isConnected) setWidth(Math.max(0, Math.floor(el.getBoundingClientRect().width)));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    ro.current = new ResizeObserver(read);
    ro.current.observe(el);
  }, []);
  return [ref, width] as const;
}

// 깔끔한 눈금 (0 부터 · 정수 값이면 정수 눈금)
function niceTicks(max: number, count = 4, integer = true): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  let step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  if (integer) step = Math.max(1, Math.ceil(step));
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 1e6; v += step) ticks.push(Number(v.toFixed(6)));
  return ticks;
}

/* ── 날짜 흐름 ─────────────────────────────────────── */
export type ChartSeries = { id: string; label: string; values: readonly (number | null)[]; color?: VizColor };

export type TimeSeriesChartProps = {
  label: string; // 차트 이름 (묶음 이름 · 표 제목)
  x: readonly string[]; // 칸 (예: 날짜 '2026-11-01')
  xLabel?: (x: string, i: number) => string; // 축 · 풍선 · 표의 칸 글 (기본 = 그대로)
  xHeader?: string; // 표 첫 칸 머리 (기본 '날짜')
  series: readonly ChartSeries[];
  format?: (v: number) => string; // 풍선 · 표 값 (기본 = 1,234)
  axisFormat?: (v: number) => string; // 눈금 (기본 = 짧게 1.2천)
  height?: number; // 그림 높이 (아래 축 글 포함 · 기본 180)
  area?: boolean; // 첫 계열 아래 옅은 면
  integer?: boolean; // 값이 정수 (눈금도 정수 · 기본 true)
  legend?: boolean; // 기본 = 계열이 둘 이상일 때
  className?: string;
};

const PAD = { top: 10, right: 12, bottom: 24 };

export function TimeSeriesChart({
  label, x, xLabel = (v) => v, xHeader = UI_COPY.chartDate, series, format = formatNumber, axisFormat = formatCompact, height = 180,
  area, integer = true, legend, className,
}: TimeSeriesChartProps) {
  const [box, width] = useWidth<HTMLDivElement>(560);
  const [active, setActive] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const [focused, setFocused] = useState(false);
  const tableId = useId();
  const n = x.length;
  const max = Math.max(0, ...series.flatMap((s) => s.values.map((v) => v ?? 0)));
  const ticks = useMemo(() => niceTicks(max, 4, integer), [max, integer]);
  const top = ticks[ticks.length - 1] || 1;
  const left = Math.max(...ticks.map((t) => axisFormat(t).length)) * 7 + 10;
  const plotW = Math.max(10, width - left - PAD.right);
  const plotH = Math.max(10, height - PAD.top - PAD.bottom);
  const xAt = (i: number) => left + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const yAt = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 72)))); // 축 글 사이 72px 이상
  const showLegend = legend ?? series.length > 1;

  const pathOf = (vals: readonly (number | null)[]) => {
    let d = '';
    let pen = false;
    vals.forEach((v, i) => {
      if (v === null || v === undefined) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    if (n === 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const i = n <= 1 ? 0 : Math.round(((px - left) / plotW) * (n - 1));
    setActive(Math.min(n - 1, Math.max(0, i)));
  };
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (n === 0) return;
    const cur = active ?? n - 1;
    const next = { ArrowLeft: cur - 1, ArrowRight: cur + 1, Home: 0, End: n - 1 }[e.key];
    if (e.key === 'Escape') return setActive(null);
    if (next === undefined) return;
    e.preventDefault();
    setActive(Math.min(n - 1, Math.max(0, next)));
  };

  const readout = active === null ? '' : `${xLabel(x[active], active)}: ${series.map((s) => `${s.label} ${s.values[active] === null ? '—' : format(s.values[active] ?? 0)}`).join(', ')}`;
  const tipLeft = active === null ? 0 : xAt(active);
  const flip = tipLeft > width * 0.62;

  return (
    <figure className={cx('ui-chart', className)} data-table={flag(table)}>
      <div className="ui-chart-head">
        {showLegend && (
          <ul className="ui-legend" aria-label={UI_COPY.chartLegend}>
            {series.map((s) => (
              <li key={s.id}><i className="ui-legend-key" data-shape="line" style={{ background: vizColor(s.color) }} aria-hidden="true" />{s.label}</li>
            ))}
          </ul>
        )}
        <button type="button" className="ui-chart-toggle" aria-pressed={table} aria-controls={tableId} onClick={() => setTable((t) => !t)}>
          <Icon name={table ? 'waterfall' : 'grid'} size="xs" />
          {table ? UI_COPY.chartShowChart : UI_COPY.chartShowTable}
        </button>
      </div>
      {!table && (
        <div ref={box} className="ui-chart-plot" tabIndex={0} role="group" aria-label={`${label}. ${UI_COPY.chartKeys}`}
          onKeyDown={keys} onFocus={() => { setFocused(true); setActive((a) => a ?? (n ? n - 1 : null)); }}
          onBlur={() => { setFocused(false); setActive(null); }}>
          <svg width={width} height={height} aria-hidden="true" onPointerMove={pick} onPointerLeave={() => !focused && setActive(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line className={t === 0 ? 'ui-chart-base' : 'ui-chart-grid'} x1={left} x2={left + plotW} y1={yAt(t)} y2={yAt(t)} />
                <text className="ui-chart-tick" x={left - 8} y={yAt(t)} dy="0.32em" textAnchor="end">{axisFormat(t)}</text>
              </g>
            ))}
            {x.map((v, i) => (i % every === 0 || (i === n - 1 && (n - 1) % every > every / 2)) && (
              <text key={v} className="ui-chart-tick" x={xAt(i)} y={height - 6} textAnchor={n > 1 && i === 0 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle'}>
                {xLabel(v, i)}
              </text>
            ))}
            {area && series[0] && n > 1 && (
              <path className="ui-chart-area" style={{ fill: vizColor(series[0].color) }}
                d={`${pathOf(series[0].values.map((v) => v ?? 0))}L${xAt(n - 1).toFixed(1)},${yAt(0)}L${xAt(0).toFixed(1)},${yAt(0)}Z`} />
            )}
            {series.map((s) => (
              <path key={s.id} className="ui-chart-line" style={{ stroke: vizColor(s.color) }} d={pathOf(s.values)} />
            ))}
            {n === 1 && series.map((s) => s.values[0] !== null && (
              <circle key={s.id} className="ui-chart-dot" cx={xAt(0)} cy={yAt(s.values[0] ?? 0)} r={4} style={{ fill: vizColor(s.color) }} />
            ))}
            {active !== null && (
              <g>
                <line className="ui-chart-cross" x1={xAt(active)} x2={xAt(active)} y1={PAD.top} y2={PAD.top + plotH} />
                {series.map((s) => s.values[active] !== null && (
                  <circle key={s.id} className="ui-chart-dot" cx={xAt(active)} cy={yAt(s.values[active] ?? 0)} r={4} style={{ fill: vizColor(s.color) }} />
                ))}
              </g>
            )}
          </svg>
          {active !== null && (
            <div className="ui-chart-tip" data-flip={flag(flip)} style={{ left: tipLeft }} aria-hidden="true">
              <p className="ui-chart-tip-x">{xLabel(x[active], active)}</p>
              {series.map((s) => (
                <p key={s.id} className="ui-chart-tip-row">
                  <i className="ui-legend-key" data-shape="line" style={{ background: vizColor(s.color) }} />
                  <b className="ui-num">{s.values[active] === null ? '—' : format(s.values[active] ?? 0)}</b>
                  <span>{s.label}</span>
                </p>
              ))}
            </div>
          )}
          <span className="ui-sr" aria-live="polite">{focused ? readout : ''}</span>
        </div>
      )}
      <div id={tableId} className={table ? 'ui-chart-table ui-scroll' : 'ui-sr'}>
        <table className="ui-table" data-density="compact">
          <caption className="ui-sr">{label}</caption>
          <thead>
            <tr>
              <th scope="col">{xHeader}</th>
              {series.map((s) => <th key={s.id} scope="col">{s.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {x.map((v, i) => (
              <tr key={v}>
                <th scope="row">{xLabel(v, i)}</th>
                {series.map((s) => <td key={s.id} className="ui-num">{s.values[i] === null ? '—' : format(s.values[i] ?? 0)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

/* ── 가로 막대 목록 ─────────────────────────────────── */
export type BarItem = {
  key: string;
  label: ReactNode;
  sub?: ReactNode; // 이름 아래 옅은 한 줄
  value: number;
  valueText?: ReactNode; // 값 글 (기본 = format(value))
  aside?: ReactNode; // 값 옆 옅은 글 (예: 비율)
  href?: string; // 누르면 그 대상으로 (링크)
  onSelect?: () => void;
  color?: VizColor; // 기본 1 (한 계열 = 한 색 · 값으로 색을 바꾸지 않는다)
  icon?: IconLike;
};

export function BarList({ label, items, format = formatNumber, max, className }: {
  label: string;
  items: readonly BarItem[];
  format?: (v: number) => string;
  max?: number; // 막대 100% 기준 (기본 = 가장 큰 값)
  className?: string;
}) {
  const top = max ?? Math.max(0, ...items.map((i) => i.value));
  return (
    <ol className={cx('ui-barlist', className)} aria-label={label}>
      {items.map((it) => {
        const pct = top > 0 ? Math.max(it.value > 0 ? 1.5 : 0, (it.value / top) * 100) : 0;
        const inner = (
          <>
            <span className="ui-barlist-name">
              {renderIcon(it.icon, 'sm')}
              <span className="ui-barlist-text">
                <span className="ui-barlist-label ui-ell">{it.label}</span>
                {it.sub && <span className="ui-barlist-sub ui-ell">{it.sub}</span>}
              </span>
            </span>
            <span className="ui-barlist-value">
              <b className="ui-num">{it.valueText ?? format(it.value)}</b>
              {it.aside && <span className="ui-barlist-aside ui-num">{it.aside}</span>}
            </span>
            <span className="ui-barlist-track" aria-hidden="true">
              <span className="ui-barlist-fill" style={{ width: `${pct}%`, background: vizColor(it.color) }} />
            </span>
          </>
        );
        return (
          <li key={it.key}>
            {it.href ? (
              <a className="ui-barlist-row" href={it.href} data-interactive="">{inner}</a>
            ) : it.onSelect ? (
              <button type="button" className="ui-barlist-row" data-interactive="" onClick={it.onSelect}>{inner}</button>
            ) : (
              <div className="ui-barlist-row">{inner}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* ── 비중 막대 ──────────────────────────────────────── */
export type ShareItem = { key: string; label: string; value: number; valueText?: string; href?: string; color?: VizColor; icon?: IconLike };

export function ShareBar({ label, items, format = formatNumber, className }: {
  label: string;
  items: readonly ShareItem[]; // 순서 = 막대 왼쪽부터 · 범례 위부터
  format?: (v: number) => string;
  className?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [bar, width] = useWidth<HTMLDivElement>(400);
  const total = items.reduce((n, i) => n + Math.max(0, i.value), 0);
  const pctText = (v: number) => `${total ? Math.round((v / total) * 1000) / 10 : 0}%`;
  // 조각 왼쪽 위치 (px) — 2px 틈은 CSS gap
  const shown = items.filter((i) => i.value > 0);
  const gap = 2;
  const usable = Math.max(0, width - gap * Math.max(0, shown.length - 1));
  let at = 0;
  const segs = shown.map((it) => {
    const w = total ? (it.value / total) * usable : 0;
    const seg = { it, x: at, w };
    at += w + gap;
    return seg;
  });
  const h = hover === null ? null : segs.find((s) => s.it.key === items[hover]?.key) ?? null;

  return (
    <div className={cx('ui-share', className)}>
      <div ref={bar} className="ui-share-bar" aria-hidden="true" onPointerLeave={() => setHover(null)}>
        {segs.map((s) => (
          <span key={s.it.key} className="ui-share-seg" data-active={flag(h?.it.key === s.it.key)}
            style={{ left: s.x, width: Math.max(2, s.w), background: vizColor(s.it.color) }}
            onPointerEnter={() => setHover(items.indexOf(s.it))} />
        ))}
        {h && (
          <span className="ui-chart-tip" data-flip={flag(h.x + h.w / 2 > width * 0.62)} style={{ left: h.x + h.w / 2, top: -6 }}>
            <span className="ui-chart-tip-row">
              <i className="ui-legend-key" data-shape="rect" style={{ background: vizColor(h.it.color) }} />
              <b className="ui-num">{h.it.valueText ?? format(h.it.value)}</b>
              <span>{h.it.label} {pctText(h.it.value)}</span>
            </span>
          </span>
        )}
      </div>
      <ul className="ui-share-legend" aria-label={label}>
        {items.map((it, i) => {
          const inner = (
            <>
              <i className="ui-legend-key" data-shape="rect" style={{ background: vizColor(it.color) }} aria-hidden="true" />
              {renderIcon(it.icon, 'sm')}
              <span className="ui-share-name ui-ell">{it.label}</span>
              <b className="ui-num">{it.valueText ?? format(it.value)}</b>
              <span className="ui-share-pct ui-num">{pctText(it.value)}</span>
            </>
          );
          return (
            <li key={it.key} data-active={flag(hover === i)} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
              {it.href ? <a className="ui-share-row" href={it.href} onFocus={() => setHover(i)} onBlur={() => setHover(null)}>{inner}</a> : <span className="ui-share-row">{inner}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ── 작은 흐름 (숫자 카드 아래) ──────────────────────── */
export function Sparkline({ values, height = 28, className }: { values: readonly number[]; height?: number; className?: string }) {
  const [box, width] = useWidth<HTMLSpanElement>(120);
  const n = values.length;
  const max = Math.max(0, ...values);
  const pad = 4;
  const xAt = (i: number) => (n <= 1 ? width / 2 : pad + (i * (width - pad * 2)) / (n - 1));
  const yAt = (v: number) => height - pad - (max > 0 ? (v / max) * (height - pad * 2) : 0);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join('');
  return (
    <span ref={box} className={cx('ui-spark', className)} aria-hidden="true">
      {n > 0 && width > 0 && (
        <svg width={width} height={height}>
          <path className="ui-spark-line" d={d} />
          <circle className="ui-spark-dot" cx={xAt(n - 1)} cy={yAt(values[n - 1])} r={3} />
        </svg>
      )}
    </span>
  );
}

/* ── 숫자 카드 (지난 기간 대비 · 작은 흐름) ──────────── */
export type StatDelta = {
  text: string; // 예: '+12%' · '처음'
  dir: 'up' | 'down' | 'flat';
  tone?: 'good' | 'bad' | 'neutral'; // 오름이 좋은지는 부르는 쪽이 정한다 (실패율 = 오름이 나쁨)
  label?: string; // 화면 읽기용 전체 문장 (예: '지난 7일보다 12% 늘었어요')
};

export type StatTileProps = {
  label: ReactNode;
  value: ReactNode;
  delta?: StatDelta;
  deltaNote?: ReactNode; // 증감 옆 옅은 글 (예: '지난 7일 대비') — 증감이 없어도 줄은 남는다 (카드 높이가 같게)
  sub?: ReactNode; // 아래 한 줄 (자세한 숫자)
  trend?: readonly number[]; // 모두 0 이면 그리지 않는다
  icon?: IconLike;
  href?: string; // 누르면 그 화면 (카드 전체가 링크)
  className?: string;
  'data-kpi'?: string;
};

export function StatTile({ label, value, delta, deltaNote, sub, trend, icon, href, className, ...rest }: StatTileProps) {
  const inner = (
    <>
      <span className="ui-stat-label">{renderIcon(icon, 'sm')}{label}</span>
      <span className="ui-stat-value ui-kpi-value">{value}</span>
      {(delta || deltaNote) && (
        <span className="ui-kpi-foot">
          {delta && (
            <span className="ui-kpi-delta" data-tone={delta.tone ?? 'neutral'} title={delta.label}>
              {delta.dir !== 'flat' && <Icon name={delta.dir === 'up' ? 'arrow-up' : 'arrow-down'} size="xs" />}
              <span aria-hidden={delta.label ? true : undefined}>{delta.text}</span>
              {delta.label && <span className="ui-sr">{delta.label}</span>}
            </span>
          )}
          {deltaNote && <span className="ui-kpi-note" aria-hidden={delta?.label ? true : undefined}>{deltaNote}</span>}
        </span>
      )}
      {sub && <span className="ui-stat-sub">{sub}</span>}
      {trend && trend.length > 1 && trend.some((v) => v > 0) && <Sparkline values={trend} />}
    </>
  );
  return href ? (
    <a className={cx('ui-stat ui-kpi', className)} href={href} data-kpi={rest['data-kpi']}>{inner}</a>
  ) : (
    <div className={cx('ui-stat ui-kpi', className)} data-kpi={rest['data-kpi']}>{inner}</div>
  );
}

// 바깥에서 쓰는 작은 도우미 — 지난 기간 대비 (%) · 처음 = 지난 기간 0
export function deltaOf(now: number, before: number, { upIsGood = true, unit = '%' }: { upIsGood?: boolean; unit?: string } = {}): StatDelta | undefined {
  if (!before && !now) return undefined;
  if (!before) return { text: UI_COPY.deltaNew, dir: 'up', tone: 'neutral' };
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return { text: `0${unit}`, dir: 'flat', tone: 'neutral' };
  const dir = pct > 0 ? 'up' : 'down';
  return { text: `${pct > 0 ? '+' : ''}${pct}${unit}`, dir, tone: (pct > 0) === upIsGood ? 'good' : 'bad' };
}

