import type { ReactNode } from 'react';
import { Sources, St } from './parts';
import type { DocsData } from './types';

// 구성 = 빌드할 때 레포 파일에서 계산한 표 (package.json · .nvmrc · pyproject.toml · uv.lock · workflows · .npmrc · AGENTS.md)
export default function Stack({ data }: { data: DocsData }) {
  const s = data.stack;
  return (
    <>
      <Sec id="cmd" title="실행 명령" hint="루트 package.json scripts">
        <Table label="실행 명령" cols={['명령', '하는 일']}>
          {s.scripts.map((x) => (
            <tr key={x.name}>
              <td className="nw">
                <code>npm run {x.name}</code>
              </td>
              <td>
                <code>{x.cmd}</code>
              </td>
            </tr>
          ))}
        </Table>
      </Sec>

      <Sec id="ver" title="버전">
        <div className="cols">
          <Table label="런타임" cols={['런타임', '버전', '출처']}>
            {s.runtimes.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td className="nw">
                  <code>{r.value}</code>
                </td>
                <td className="from">{r.from}</td>
              </tr>
            ))}
          </Table>
          <Table label="파이썬 패키지" cols={['파이썬 (uv.lock)', '버전', '직접']}>
            {s.python.map((p) => (
              <tr key={p.name}>
                <td>{p.name}</td>
                <td className="nw">
                  <code>{p.version}</code>
                </td>
                <td>{p.direct ? <St tone="now">직접</St> : <span className="from">간접</span>}</td>
              </tr>
            ))}
          </Table>
        </div>
        <Table label="npm 패키지" cols={['npm 패키지', '버전', '쓰는 곳', '종류']} wide>
          {s.npm.map((p) => (
            <tr key={`${p.name}@${p.version}@${p.dev}`}>
              <td>{p.name}</td>
              <td className="nw">
                <code>{p.version}</code>
              </td>
              <td>{p.workspaces.join(', ')}</td>
              <td className="from">{p.dev ? '개발' : '실행'}</td>
            </tr>
          ))}
        </Table>
        <Table label="서비스" cols={['서비스', '경로', '상태', '버전']} wide>
          {s.services.map((x) => (
            <tr key={x.path}>
              <td>{x.label}</td>
              <td className="nw">
                <code>{x.path}</code>
              </td>
              <td>{x.exists ? <St tone="on">있음</St> : <St tone="off">예정{x.plan ? ` ${x.plan}` : ''}</St>}</td>
              <td>
                {x.deps.length > 0
                  ? x.deps.map((d) => (
                      <code key={d.name} className="dep">
                        {d.name} {d.version}
                      </code>
                    ))
                  : <span className="from">{x.exists ? '고정된 버전 없음' : '폴더가 생기면 여기서 읽습니다'}</span>}
              </td>
            </tr>
          ))}
        </Table>
      </Sec>

      <Sec id="dirs" title="폴더" hint="AGENTS.md 폴더 규칙">
        <Table label="폴더" cols={['경로', '역할', '상태']}>
          {s.folders.map((f) => (
            <tr key={f.path}>
              <td className="nw">
                <code>{f.path}/</code>
              </td>
              <td>{f.role ?? '—'}</td>
              <td>{f.exists ? <St tone="on">있음</St> : <St tone="off">예정</St>}</td>
            </tr>
          ))}
        </Table>
      </Sec>

      <Sec id="ci" title="CI" hint=".github/workflows">
        <div className="cols">
          {s.ci.map((w) => (
            <div key={w.file} className="ci">
              <div className="ci-head">
                <b>{w.name}</b>
                <code>{w.file.replace('.github/workflows/', '')}</code>
                <span className="from">
                  {w.on.join(', ')}
                  {w.runsOn && `, ${w.runsOn}`}
                </span>
              </div>
              <Table label={`${w.name} 단계`} cols={['단계', '실행']}>
                {w.steps.map((st, i) => (
                  <tr key={i}>
                    <td>{st.name ?? (st.uses ? st.uses.split('@')[0] : `단계 ${i + 1}`)}</td>
                    <td>
                      {st.run && <code>{st.run}</code>}
                      {st.uses && (
                        <span className="uses">
                          <code title={st.uses}>{st.uses.replace(/@([0-9a-f]{7})[0-9a-f]{33}$/, '@$1…')}</code>
                          {st.pin && <span className="from"> {st.pin}</span>}
                          {st.sha ? <St tone="on">SHA 고정</St> : <St tone="warn">태그</St>}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
            </div>
          ))}
        </div>
      </Sec>

      <Sec id="supply" title="공급망" hint="AGENTS.md 공급망 규칙의 실제 값">
        <Table label="공급망" cols={['규칙', '값', '출처']}>
          {s.supply.map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td>
              <td>
                <code>{r.value}</code>
              </td>
              <td className="from">{r.from}</td>
            </tr>
          ))}
          {s.banned.length > 0 && (
            <tr>
              <td>LiteLLM 금지 버전</td>
              <td>
                <span className="chips inline">
                  {s.banned.map((v) => (
                    <St key={v} tone="warn">
                      {v}
                    </St>
                  ))}
                </span>
              </td>
              <td className="from">AGENTS.md (악성 배포 이력)</td>
            </tr>
          )}
        </Table>
      </Sec>

      <Sources files={['package.json', '워크스페이스 package.json', '.nvmrc', '.npmrc', 'pyproject.toml', 'uv.lock', '.github/workflows/', 'AGENTS.md']} />
    </>
  );
}

function Sec({ id, title, hint, children }: { id: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="dsec" aria-labelledby={`stack-${id}`}>
      <h2 id={`stack-${id}`}>
        {title} {hint && <span className="hint">{hint}</span>}
      </h2>
      {children}
    </section>
  );
}

function Table({ label, cols, wide = false, children }: { label: string; cols: string[]; wide?: boolean; children: ReactNode }) {
  return (
    <div className={wide ? 'table wide' : 'table'}>
      <table aria-label={label}>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
