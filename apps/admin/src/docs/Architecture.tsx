import type { CSSProperties, ReactNode } from 'react';
import { ArchIcon, type ArchIconName } from './arch-icons';
import './architecture.css';
import { Sources, St } from './parts';
import type { ArchPath, DocsData } from './types';

// 전체 시스템 아키텍처 = AGENTS.md · ADR-0001~0009 · slice 02(conductor + LiteLLM)
// 로컬 Docker = ADR-0009 (infra/compose.yaml: 기본 LiteLLM · profile trace = Langfuse 셀프호스트 묶음). venv LiteLLM(infra/litellm)은 대체 경로
// Langfuse · 저장소 점 = infra/compose.yaml 이 있으면 '있음' (conductor → Langfuse trace 연결은 slice 03)
// 회사 게이트웨이 = LiteLLM 뒤가 아니라 그 자리 대신 (ADR-0008: LLM_GATEWAY_URL · 키만 바꾼다)
// 그림 = 고정 논리 캔버스(W×H) 위의 영역(제목만) · 노드(아이콘 + 이름) · 선(짧은 라벨). 폭에 맞춰 줄고, 좁으면 상자 안에서 가로 스크롤
// 노드 상태(점)는 빌드할 때 레포에서 계산: path 가 있으면 '있음', 없으면 '예정 · <완료 기준>'.
// path 가 없는 노드는 그 기준의 phase 가 passes 면 '있음'. 상태가 없으면 외부 서비스 (점 없음)
const W = 1040;
const H = 620;
const TOP = 24; // 위쪽 빈 줄은 잘라서 그린다 (보이는 캔버스 = y 24~620)
type Rect = [x: number, y: number, w: number, h: number];
type Pt = [x: number, y: number];

type Status = { path?: ArchPath; via?: ArchPath; plan?: string }; // path = data-path 로도 노출 · via = 상태만 빌림
type NodeDef = { kind: 'node'; name: string; icon: ArchIconName; badge?: ArchIconName; at: Pt; size?: 'lg' | 'sm' | 'row'; st?: Status };
type ChipDef = { kind: 'chip'; name: string; icon: ArchIconName; rect: Rect; row?: boolean; st?: Status };
type ZoneDef = { kind: 'zone'; id: string; title?: string; icon?: ArchIconName; tone: string; rect: Rect; items: Item[] };
type Item = NodeDef | ChipDef | ZoneDef;

const node = (name: string, icon: ArchIconName, at: Pt, more: Partial<NodeDef> = {}): NodeDef => ({ kind: 'node', name, icon, at, ...more });
const chip = (name: string, icon: ArchIconName, rect: Rect, more: Partial<ChipDef> = {}): ChipDef => ({ kind: 'chip', name, icon, rect, ...more });

const MAP: Item[] = [
  node('사용자', { line: 'person' }, [40, 110]),
  node('관리자', { line: 'person' }, [40, 385]),
  {
    kind: 'zone', id: 'app', title: '사용자 앱', tone: 'app', rect: [90, 40, 180, 260],
    items: [
      node('데스크톱', { brand: 'electron' }, [180, 110], { st: { path: 'apps/desktop/package.json', plan: 'P1-5' } }),
      node('웹 랜딩', { line: 'landing' }, [180, 230], { st: { path: 'apps/web/index.html', plan: 'P1-5' } }),
    ],
  },
  {
    kind: 'zone', id: 'admin', title: '관리자 콘솔', tone: 'admin', rect: [90, 330, 180, 110],
    items: [node('React SPA', { line: 'console' }, [180, 385], { badge: { brand: 'react' }, st: { path: 'apps/admin/package.json', plan: 'P1-5' } })],
  },
  {
    kind: 'zone', id: 'core', title: '코어 · conductor', tone: 'core', rect: [350, 40, 210, 400],
    items: [
      node('conductor', { brand: 'fastapi' }, [455, 110], { badge: { brand: 'python' }, st: { path: 'services/conductor', plan: 'P1-1' } }),
      chip('① 능력 찾기', { line: 'search' }, [363, 176, 90, 52], { st: { plan: 'P3-1' } }),
      chip('② 승인', { line: 'shield' }, [457, 176, 90, 52], { st: { plan: 'P1-2' } }),
      chip('③ Skill', { line: 'skill' }, [363, 234, 90, 52], { st: { path: 'runtime/skills', plan: 'P5-1' } }),
      chip('④ 팀', { line: 'team' }, [457, 234, 90, 52], { st: { plan: 'P4-1' } }),
      chip('Pydantic AI', { brand: 'pydantic' }, [363, 300, 184, 36], { row: true, st: { via: 'services/conductor', plan: 'P1-1' } }),
    ],
  },
  {
    kind: 'zone', id: 'local', title: '로컬 Docker', icon: { brand: 'docker' }, tone: 'local', rect: [640, 40, 200, 400],
    items: [
      node('LiteLLM', { line: 'router' }, [740, 98], { st: { path: 'infra/litellm', plan: 'P1-1' } }),
      node('또는 회사 게이트웨이', { line: 'building' }, [666, 158], { size: 'row' }),
      {
        kind: 'zone', id: 'langfuse', tone: 'sub', rect: [655, 182, 170, 243],
        items: [
          node('Langfuse', { line: 'trace' }, [740, 228], { st: { path: 'infra/compose.yaml', plan: 'P1-3' } }),
          node('Postgres', { brand: 'postgresql' }, [697, 310], { size: 'sm', st: { via: 'infra/compose.yaml', plan: 'P1-3' } }),
          node('ClickHouse', { brand: 'clickhouse' }, [783, 310], { size: 'sm', st: { via: 'infra/compose.yaml', plan: 'P1-3' } }),
          node('Redis', { brand: 'redis' }, [697, 375], { size: 'sm', st: { via: 'infra/compose.yaml', plan: 'P1-3' } }),
          node('MinIO', { brand: 'minio' }, [783, 375], { size: 'sm', st: { via: 'infra/compose.yaml', plan: 'P1-3' } }),
        ],
      },
    ],
  },
  {
    kind: 'zone', id: 'models', title: '모델 제공자', tone: 'models', rect: [890, 40, 150, 160],
    items: [
      node('Anthropic', { brand: 'anthropic' }, [912, 100], { size: 'row' }),
      node('OpenAI', { line: 'model' }, [912, 150], { size: 'row' }),
          ],
  },
  {
    kind: 'zone', id: 'tools', title: '도구', tone: 'tools', rect: [350, 480, 210, 120],
    items: [node('MCP 서버', { brand: 'modelcontextprotocol' }, [455, 540], { st: { plan: 'P1-1' } })],
  },
  node('개발자', { line: 'person' }, [600, 540]),
  {
    kind: 'zone', id: 'dev', title: '개발', tone: 'dev', rect: [640, 480, 400, 120],
    items: [
      node('GitHub', { brand: 'github' }, [730, 540]),
      node('GitHub Actions', { brand: 'githubactions' }, [860, 540]),
      node('evals · E2E', { line: 'checks' }, [985, 540], { st: { path: 'evals/cases', plan: 'P0-2' } }),
    ],
  },
];

// 선: from → to (both = 양방향). label 은 lp(가운데 기준) 에 · sr = 화면 낭독기용 문장
type Wire = { from: Pt; to: Pt; label?: string; lp?: Pt; start?: boolean; both?: boolean; sr: string };
const WIRES: Wire[] = [
  { from: [62, 110], to: [157, 110], sr: '사용자 → 데스크톱 앱' },
  { from: [202, 110], to: [349, 110], both: true, label: 'AG-UI · SSE', lp: [310, 102], sr: '데스크톱 앱 ⇄ conductor : AG-UI · SSE' },
  { from: [180, 208], to: [180, 158], label: '다운로드', lp: [188, 187], start: true, sr: '웹 랜딩 → 데스크톱 앱 : 설치본 다운로드' },
  { from: [62, 385], to: [157, 385], sr: '관리자 → 관리자 콘솔' },
  { from: [202, 385], to: [349, 385], label: '관리 API', lp: [310, 377], sr: '관리자 콘솔 → conductor : 관리 API' },
  { from: [560, 98], to: [717, 98], label: 'OpenAI 호환', lp: [600, 90], sr: 'conductor → (LLM_GATEWAY_URL) LiteLLM 또는 회사 게이트웨이 : OpenAI 호환 API' },
  { from: [560, 228], to: [717, 228], label: 'OTLP trace', lp: [600, 220], sr: 'conductor → Langfuse : OTLP trace (user.id · session.id)' },
  { from: [762, 98], to: [889, 98], label: 'API 키', lp: [865, 90], sr: 'LiteLLM → 모델 제공자 (Anthropic · OpenAI) : API 키' },
  { from: [455, 440], to: [455, 518], label: 'MCP · 승인 후', lp: [463, 466], start: true, sr: 'conductor → MCP 서버 : MCP · 사람 승인 후' },
  { from: [622, 540], to: [708, 540], label: 'git push', lp: [672, 532], sr: '개발자 → GitHub : git push' },
  { from: [752, 540], to: [837, 540], label: 'CI', lp: [795, 532], sr: 'GitHub → GitHub Actions : CI' },
  { from: [882, 540], to: [962, 540], label: '실행', lp: [922, 532], sr: 'GitHub Actions → evals · Playwright E2E : 실행' },
];

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
        로컬 Docker 셀프호스트 (Cloud 안 씀). 모든 LLM · 툴 · 에이전트 span 에 <code>user.id</code> · <code>session.id</code>. OTel GenAI semconv 는 버전 고정.
      </>
    ),
    src: [
      { label: 'AGENTS.md 개발 원칙' },
      { label: 'ADR-0006', href: '#/docs/adr/0006' },
      { label: 'ADR-0009', href: '#/docs/adr/0009' },
    ],
  },
];

const ROOT: Rect = [0, TOP, W, H - TOP];
const pct = (v: number, of: number) => `${(v / of) * 100}%`;
const place = (r: Rect, p: Rect): CSSProperties => ({
  left: pct(r[0] - p[0], p[2]),
  top: pct(r[1] - p[1], p[3]),
  width: pct(r[2], p[2]),
  height: pct(r[3], p[3]),
});

export default function Architecture({ data }: { data: DocsData }) {
  // 완료 기준 id → 그 phase 가 passes 인가 · 기준 문장 (점 위에 올리면 보인다)
  const crit = new Map<string, { passes: boolean; text: string }>();
  for (const p of data.roadmap?.phases ?? []) {
    crit.set(p.id, { passes: p.passes, text: `${p.id} ${p.name} — ${p.goal}` });
    for (const c of p.criteria) if (c.id) crit.set(c.id, { passes: p.passes, text: `${c.id} ${c.text}` });
  }

  function status(s?: Status) {
    if (!s) return null; // 외부 서비스 = 점 없음
    const c = s.plan ? crit.get(s.plan) : undefined;
    const p = s.path ?? s.via;
    const on = p ? data.exists[p] : !!c?.passes;
    const text = on ? '있음' : `예정 · ${s.plan}`;
    return (
      <St tone={on ? 'on' : 'off'} title={on ? (p ? `${p} 있음` : c?.text) : c?.text}>
        <span className="sr">{text}</span>
      </St>
    );
  }

  function render(it: Item, parent: Rect, key: string): ReactNode {
    if (it.kind === 'zone') {
      const tid = `ax-z-${it.id}`;
      return (
        <div
          key={key}
          className={`ax-zone z-${it.tone}`}
          style={place(it.rect, parent)}
          role={it.title ? 'group' : undefined}
          aria-labelledby={it.title ? tid : undefined}
        >
          {it.title && (
            <p className="ax-zt" id={tid}>
              {it.icon && <ArchIcon icon={it.icon} />}
              {it.title}
            </p>
          )}
          {it.items.map((c, i) => render(c, it.rect, `${key}.${i}`))}
        </div>
      );
    }
    if (it.kind === 'chip') {
      return (
        <div key={key} className={it.row ? 'ax-chip row' : 'ax-chip'} style={place(it.rect, parent)} data-path={it.st?.path}>
          <ArchIcon icon={it.icon} />
          <h3>
            {it.name}
            {status(it.st)}
          </h3>
        </div>
      );
    }
    return (
      <div
        key={key}
        className={`ax-node ${it.size ?? 'lg'}`}
        style={{ left: pct(it.at[0] - parent[0], parent[2]), top: pct(it.at[1] - parent[1], parent[3]) }}
        data-path={it.st?.path}
      >
        <span className="ax-ic">
          <ArchIcon icon={it.icon} />
          {it.badge && <ArchIcon icon={it.badge} className="ax-badge" />}
        </span>
        <h3>
          {it.name}
          {status(it.st)}
        </h3>
      </div>
    );
  }

  return (
    <>
      <section className="dsec">
        <h2 id="arch-title">전체 시스템 아키텍처</h2>
        <figure className="amap" aria-labelledby="arch-title" aria-describedby="arch-links arch-legend">
          <div className="ax-scroll" tabIndex={0} role="region" aria-label="아키텍처 그림 (가로로 스크롤)">
            <div className="ax-canvas">
              {MAP.map((it, i) => render(it, ROOT, String(i)))}
              <svg className="ax-wires" viewBox={`0 ${TOP} ${W} ${H - TOP}`} aria-hidden="true">
                <defs>
                  <marker id="ax-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
                    <path d="M0 1 9 5 0 9z" />
                  </marker>
                </defs>
                {WIRES.map((w) => (
                  <g key={w.sr}>
                    <line x1={w.from[0]} y1={w.from[1]} x2={w.to[0]} y2={w.to[1]} markerEnd="url(#ax-head)" markerStart={w.both ? 'url(#ax-head)' : undefined} />
                    {w.label && w.lp && (
                      <text x={w.lp[0]} y={w.lp[1]} textAnchor={w.start ? 'start' : 'middle'} dominantBaseline={w.start ? 'middle' : 'auto'}>
                        {w.label}
                      </text>
                    )}
                  </g>
                ))}
              </svg>
              <p className="ax-legend" id="arch-legend">
                <span>
                  <i className="d on" />
                  있음 = 레포에 있음
                </span>
                <span>
                  <i className="d off" />
                  예정 = roadmap 완료 기준
                </span>
                <span>점 없음 = 외부</span>
              </p>
            </div>
          </div>
          <p className="ax-hint" aria-hidden="true">
            옆으로 밀면 전체가 보입니다
          </p>
          <figcaption className="sr">
            <ul id="arch-links">
              {WIRES.map((w) => (
                <li key={w.sr}>{w.sr}</li>
              ))}
            </ul>
          </figcaption>
        </figure>
      </section>

      <details className="ax-rules">
        <summary>규칙</summary>
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
      </details>

      <Sources files={['AGENTS.md', 'docs/adr/', 'docs/slices/02-model-gateway.md', 'docs/roadmap.json']} />
    </>
  );
}
