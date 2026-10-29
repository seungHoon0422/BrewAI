import { Icon } from '../icons';
import { Missing, Rich, Sources, St, type Tone } from './parts';
import type { DocsData, PhaseState } from './types';

const PHASE: Record<PhaseState, { label: string; tone: Tone }> = {
  done: { label: '완료', tone: 'on' },
  now: { label: '진행 중', tone: 'now' },
  next: { label: '예정', tone: 'off' },
};

// 진행 현황 = HANDOFF.md + docs/roadmap.json + docs/slices (번호가 가장 큰 것)
export default function Progress({ data }: { data: DocsData }) {
  const h = data.handoff;
  const r = data.roadmap;
  const s = data.slice;
  const done = s?.done.filter((d) => d.done).length ?? 0;
  const total = s?.done.length ?? 0;

  return (
    <>
      {h && h.pending.length > 0 && (
        <section className="flag" aria-labelledby="pending-title">
          <h2 id="pending-title">
            <Icon name="alert" />
            결정 대기 {h.pending.length}건
          </h2>
          <ol>
            {h.pending.map((p, i) => (
              <Rich key={i} as="li" html={p} />
            ))}
          </ol>
        </section>
      )}

      <div className="cols">
        <section className="dsec" aria-labelledby="now-title">
          <h2 id="now-title">지금</h2>
          {h ? (
            <dl className="kv kv2">
              <div>
                <dt>마지막 갱신</dt>
                <dd>{h.updated ? <Rich html={h.updated} /> : '—'}</dd>
              </div>
              <div>
                <dt>활성 브랜치</dt>
                <dd>{h.branch ? <Rich html={h.branch} /> : '—'}</dd>
              </div>
              <div>
                <dt>Phase</dt>
                <dd>
                  <ul className="lines">
                    {h.phase.map((p, i) => (
                      <Rich key={i} as="li" html={p} />
                    ))}
                  </ul>
                </dd>
              </div>
              <div>
                <dt>막힘</dt>
                <dd>
                  {h.blocked.length === 0 ? (
                    <St tone="on">없음</St>
                  ) : (
                    <ul className="lines warn">
                      {h.blocked.map((b, i) => (
                        <Rich key={i} as="li" html={b} />
                      ))}
                    </ul>
                  )}
                </dd>
              </div>
              <div>
                <dt>결정 대기</dt>
                <dd>{h.pending.length === 0 ? <St tone="on">없음</St> : <St tone="warn">{h.pending.length}건 · 위 칸</St>}</dd>
              </div>
              {h.rows.map((row) => (
                <div key={row.key}>
                  <dt>{row.key}</dt>
                  <dd>
                    <Rich html={row.value} />
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <Missing file="HANDOFF.md" />
          )}
        </section>

        <section className="dsec" aria-labelledby="next-title">
          <h2 id="next-title">다음 할 일</h2>
          {h && h.next.length > 0 ? (
            <ol className="steps">
              {h.next.map((n, i) => (
                <Rich key={i} as="li" html={n} />
              ))}
            </ol>
          ) : (
            <p className="missing">없음</p>
          )}
        </section>
      </div>

      <section className="dsec" aria-labelledby="slice-title">
        <h2 id="slice-title">현재 slice</h2>
        {s ? (
          <div className="panel slice">
            <div className="slice-head">
              <span className="rid">slice {s.num}</span>
              <h3>{s.title}</h3>
              <code>{s.branch}</code>
              {s.criteria.map((c) => (
                <St key={c} tone="off">
                  {c}
                </St>
              ))}
            </div>
            {s.goal && <Rich as="p" className="goal" html={s.goal} />}
            {total > 0 && (
              <>
                <div className="prog">
                  <span className="bar" aria-hidden="true">
                    <i style={{ width: `${(done / total) * 100}%` }} />
                  </span>
                  <span>
                    done <b>{done}/{total}</b>
                  </span>
                </div>
                <ul className="check" aria-label={`done ${done}/${total}`}>
                  {s.done.map((d, i) => (
                    <li key={i} className={d.done ? 'done' : undefined}>
                      <Icon name={d.done ? 'check' : 'circle'} />
                      <span className="sr">{d.done ? '완료: ' : '남음: '}</span>
                      <Rich html={d.html} />
                    </li>
                  ))}
                </ul>
              </>
            )}
            <details className="more">
              <summary>slice 문서 전체 보기</summary>
              <Rich as="div" className="md" html={s.html} />
            </details>
          </div>
        ) : (
          <Missing file="docs/slices/" />
        )}
      </section>

      <section className="dsec" aria-labelledby="road-title">
        <h2 id="road-title">
          로드맵 {r?.updated && <span className="hint">갱신 {r.updated}</span>}
        </h2>
        {r ? (
          <>
            <ol className="timeline">
              {r.phases.map((p) => (
                <li key={p.id} className={`ph ${p.state}`}>
                  <div className="ph-card">
                    <div className="ph-head">
                      <span className="rid">{p.id}</span>
                      <b>{p.name}</b>
                      {p.weeks !== null && <span className="hint">{p.weeks}주</span>}
                      <St tone={PHASE[p.state].tone}>{PHASE[p.state].label}</St>
                    </div>
                    <p className="ph-goal">{p.goal}</p>
                    {p.criteria.length > 0 && (
                      <details open={p.state === 'now'}>
                        <summary>
                          완료 기준 {p.criteria.length}개 · passes <code>{String(p.passes)}</code>
                        </summary>
                        <ul className="crit">
                          {p.criteria.map((c, i) => (
                            <li key={c.id || i}>
                              <span className="rid">{c.id}</span>
                              <span>{c.text}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            {r.rule && (
              <details className="more">
                <summary>passes 판정 규칙</summary>
                <p className="rule-text">{r.rule}</p>
              </details>
            )}
          </>
        ) : (
          <Missing file="docs/roadmap.json" />
        )}
      </section>

      {h && (
        <>
          <section className="dsec" aria-labelledby="settled-title">
            <h2 id="settled-title">확정</h2>
            <ul className="chips">
              {h.settled.map((x, i) => (
                <Rich key={i} as="li" className="chip" html={x} />
              ))}
            </ul>
          </section>

          <div className="cols">
            <section className="dsec" aria-labelledby="log-title">
              <h2 id="log-title">🕘 최근 기록</h2>
              <ol className="log">
                {h.log.map((l, i) => (
                  <li key={i}>
                    {l.date ? <time dateTime={l.date}>{l.date}</time> : <span />}
                    <Rich html={l.html} />
                  </li>
                ))}
              </ol>
            </section>
            <section className="dsec" aria-labelledby="memo-title">
              <h2 id="memo-title">📥 사용자 메모</h2>
              {h.memo.length > 0 ? (
                <ul className="steps plain">
                  {h.memo.map((m, i) => (
                    <Rich key={i} as="li" html={m} />
                  ))}
                </ul>
              ) : (
                <p className="missing">없음</p>
              )}
            </section>
          </div>
        </>
      )}

      <Sources files={['HANDOFF.md', 'docs/roadmap.json', s?.file ?? 'docs/slices/']} />
    </>
  );
}
