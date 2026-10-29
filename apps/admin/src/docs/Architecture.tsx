import type { ReactNode } from 'react';
import { Icon } from '../icons';
import { Sources, St } from './parts';
import type { ArchPath, DocsData } from './types';

// 목표 아키텍처 = AGENTS.md · ADR-0001~0007 · REPORT §03. 칸마다 상태는 빌드할 때 레포에서 계산:
// path 가 있으면 '있음', 없으면 '예정 · <완료 기준>'. path 가 없는 칸은 그 기준의 phase 가 passes 면 '있음'
type Kind = 'build' | 'borrow' | 'ext';
type BoxDef = { title: string; sub: string; kind: Kind; path?: ArchPath; plan?: string };

const SURFACES: BoxDef[] = [
  { title: '데스크톱 앱', sub: 'Electron · 사용자 앱 · 먼저 (ADR-0007)', kind: 'build', path: 'apps/desktop/package.json', plan: 'P1-5' },
  { title: '관리자 콘솔', sub: '별도 SPA · 이 화면', kind: 'build', path: 'apps/admin/package.json', plan: 'P1-5' },
  { title: '웹 랜딩', sub: '당분간 다운로드만', kind: 'build', path: 'apps/web/index.html', plan: 'P1-5' },
];
const CONDUCTOR: BoxDef = { title: 'conductor API', sub: 'Python · FastAPI · 유일한 자체 코어', kind: 'build', path: 'services/conductor', plan: 'P1-1' };
const CORE: BoxDef[] = [
  { title: '① 능력 찾기 · 설치', sub: 'tool search · 카탈로그 · 연결', kind: 'build', plan: 'P3-1' },
  { title: '② 승인 · 정책', sub: '위험 등급 · 서버 재검증 · 예산', kind: 'build', plan: 'P1-2' },
  { title: '③ Skill 작성 · 저장소', sub: '격리 → 테스트 → 승인', kind: 'build', path: 'runtime/skills', plan: 'P5-1' },
  { title: '④ 팀 구성', sub: '서브에이전트 자동 편성 · 활동 이벤트', kind: 'build', plan: 'P4-1' },
];
const LOOP: BoxDef = { title: '실행 루프', sub: 'Pydantic AI · adapter 1파일에 격리', kind: 'borrow', plan: 'P1-1' };
const GATEWAY: BoxDef = { title: 'LLM 게이트웨이', sub: 'LiteLLM · 모델은 여기서만 등록', kind: 'borrow', path: 'infra/litellm', plan: 'P1-1' };
const MODELS: BoxDef = { title: '모델 제공사', sub: 'Claude · GPT · Gemini', kind: 'ext' };
const MCP_GW: BoxDef = { title: 'MCP 게이트웨이', sub: '승인 후 프록시 · P3 도입', kind: 'borrow', plan: 'P3-1' };
const MCP: BoxDef = { title: 'MCP 서버', sub: 'FastMCP 툴 1개 → P3 카탈로그 · 허용 목록 · 버전/해시 고정', kind: 'ext', plan: 'P1-1' };
const LANGFUSE: BoxDef = { title: 'Langfuse', sub: 'OTLP trace · user.id · session.id', kind: 'borrow', plan: 'P1-3' };
const EVALS: BoxDef = { title: 'evals · CI', sub: 'pytest · GitHub Actions · 깨지면 merge 안 함', kind: 'build', path: 'evals/cases', plan: 'P0-2' };

const RULES: { title: string; body: ReactNode; src: { label: string; href?: string }[] }[] = [
  {
    title: '만들 것은 코어 4개뿐',
    body: '나머지(게이트웨이 · 관측 · 레지스트리 · UI 규격 · UI 부품)는 기성품 · 표준. 실행 루프는 Pydantic AI를 adapter 1파일에 격리.',
    src: [
      { label: 'ADR-0001', href: '#/docs/adr/0001' },
      { label: 'ADR-0002', href: '#/docs/adr/0002' },
    ],
  },
  {
    title: '데스크톱은 키가 없다',
    body: '게이트웨이 · Langfuse 키를 앱에 넣지 않는다. 데스크톱은 우리 API만 호출.',
    src: [
      { label: 'AGENTS.md 제품 경계' },
      { label: 'ADR-0007', href: '#/docs/adr/0007' },
    ],
  },
  {
    title: '모델은 게이트웨이에서만 등록',
    body: '가격 · 컨텍스트 · provider 입력 화면을 만들지 않는다. 우리는 노출 여부 · 표시 이름 · 순서만.',
    src: [{ label: 'ADR-0006', href: '#/docs/adr/0006' }],
  },
  {
    title: 'trace = Langfuse',
    body: (
      <>
        모든 LLM · 툴 · 에이전트 span 에 <code>user.id</code> · <code>session.id</code>. OTel GenAI semconv 는 버전 고정.
      </>
    ),
    src: [
      { label: 'AGENTS.md 개발 원칙' },
      { label: 'ADR-0006', href: '#/docs/adr/0006' },
    ],
  },
];

export default function Architecture({ data }: { data: DocsData }) {
  // 완료 기준 id → 그 phase 가 passes 인가 · 기준 문장 (칸 위에 올리면 보인다)
  const crit = new Map<string, { passes: boolean; text: string }>();
  for (const p of data.roadmap?.phases ?? []) {
    crit.set(p.id, { passes: p.passes, text: `${p.id} ${p.name} — ${p.goal}` });
    for (const c of p.criteria) if (c.id) crit.set(c.id, { passes: p.passes, text: `${c.id} ${c.text}` });
  }

  function status(b: BoxDef) {
    if (b.path) {
      return data.exists[b.path] ? <St tone="on">있음</St> : <St tone="off" title={b.plan && crit.get(b.plan)?.text}>예정 · {b.plan}</St>;
    }
    if (!b.plan) return <St tone="ext">외부</St>;
    const c = crit.get(b.plan);
    return c?.passes ? <St tone="on">있음</St> : <St tone="off" title={c?.text}>예정 · {b.plan}</St>;
  }

  return (
    <>
      <h2 id="arch-title" className="sr">
        목표 아키텍처
      </h2>
      <figure className="arch" aria-labelledby="arch-title" aria-describedby="arch-cap">
        <div className="layer">
          <p className="layer-lbl">
            표면 <span>사람이 보는 곳</span>
          </p>
          <div className="lrow n3">
            {SURFACES.map((b) => (
              <Box key={b.title} b={b} st={status(b)} />
            ))}
          </div>
        </div>
        <Flow items={['데스크톱 ↔ AG-UI · SSE', '관리자 콘솔 ↔ 관리자 API', '키 없음 · 우리 API만']} />
        <div className="layer">
          <p className="layer-lbl">
            코어 <span>직접 만듦</span>
          </p>
          <Box b={CONDUCTOR} st={status(CONDUCTOR)} className="core">
            <div className="core-grid">
              {CORE.map((b) => (
                <Box key={b.title} b={b} st={status(b)} className="mini" />
              ))}
            </div>
            <Box b={LOOP} st={status(LOOP)} className="mini loop" />
          </Box>
        </div>
        <Flow items={['OpenAI 호환 API', 'MCP · 승인 후']} />
        <div className="layer">
          <p className="layer-lbl">
            연결 <span>빌려 씀</span>
          </p>
          <div className="lrow n2">
            <div className="chain">
              <Box b={GATEWAY} st={status(GATEWAY)} />
              <span className="to" aria-label="라우팅">
                <Icon name="right" />
              </span>
              <Box b={MODELS} st={status(MODELS)} />
            </div>
            <div className="chain">
              <Box b={MCP_GW} st={status(MCP_GW)} />
              <span className="to" aria-label="프록시">
                <Icon name="right" />
              </span>
              <Box b={MCP} st={status(MCP)} />
            </div>
          </div>
        </div>
        <Flow dashed items={['모든 칸 → span (OTLP)']} />
        <div className="layer">
          <p className="layer-lbl">
            관측 · 검증 <span>trace · eval</span>
          </p>
          <div className="lrow n2">
            <Box b={LANGFUSE} st={status(LANGFUSE)} />
            <Box b={EVALS} st={status(EVALS)} />
          </div>
        </div>
        <figcaption id="arch-cap" className="arch-legend">
          <span>
            <i className="sw build" />
            직접 만듦
          </span>
          <span>
            <i className="sw borrow" />
            빌려 씀 (점선)
          </span>
          <span>
            <i className="sw ext" />
            외부
          </span>
          <span>있음 = 레포에 경로가 있음 · 예정 = roadmap 완료 기준</span>
        </figcaption>
      </figure>

      <section className="dsec" aria-labelledby="rules-title">
        <h2 id="rules-title">이 구조를 정한 규칙</h2>
        <div className="rules">
          {RULES.map((r) => (
            <div className="rule" key={r.title}>
              <h3>{r.title}</h3>
              <p>{r.body}</p>
              <p className="src">
                {r.src.map((s, i) => (
                  <span key={s.label}>
                    {i > 0 && ' · '}
                    {s.href ? <a href={s.href}>{s.label}</a> : s.label}
                  </span>
                ))}
              </p>
            </div>
          ))}
        </div>
      </section>

      <Sources files={['AGENTS.md', 'docs/adr/', 'REPORT.html §03', 'docs/roadmap.json']} />
    </>
  );
}

function Box({ b, st, className = '', children }: { b: BoxDef; st: ReactNode; className?: string; children?: ReactNode }) {
  return (
    <div className={`abox ${b.kind} ${className}`} data-path={b.path}>
      <h3>
        {b.title} {st}
      </h3>
      <p>{b.sub}</p>
      {b.path && (
        <p className="path">
          <code>{b.path.replace(/\/(package\.json|index\.html)$/, '')}</code>
        </p>
      )}
      {children}
    </div>
  );
}

function Flow({ items, dashed = false }: { items: string[]; dashed?: boolean }) {
  return (
    <div className={dashed ? 'flow dash' : 'flow'}>
      {items.map((t) => (
        <span key={t}>
          <Icon name="down" />
          {t}
        </span>
      ))}
    </div>
  );
}
