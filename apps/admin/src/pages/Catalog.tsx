import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AdminApiError, API_URL, listAdminSkills, type SkillCatalog } from '../api';
import { EmptyTable, Note } from '../ui';

// 카탈로그 = MCP 서버(P3) · Skill. Skill 탭 = conductor 가 읽은 제품 스킬 (runtime/skills, 읽기 전용 · 버전 = SKILL.md sha256 앞 12자).
// 새 스킬 저장·등록(격리 → 테스트 → 승인)은 P5 — 여기엔 바꾸는 버튼이 없다.
const TABS = [
  { id: 'mcp', label: 'MCP 서버' },
  { id: 'skill', label: 'Skill' },
] as const;
const MCP_COLS = ['이름', '등급', '허용', '버전/해시 고정'];
const SKILL_COLS = ['이름', '설명', '쓰는 도구', '출처', '버전 (sha256)', '사용'];

type SkillState = { kind: 'loading' } | { kind: 'ok'; data: SkillCatalog } | { kind: 'error'; text: string };

export default function Catalog() {
  const [cur, setCur] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const tab = TABS[cur];

  // 탭 키보드: ← → Home End
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const last = TABS.length - 1;
    const next =
      e.key === 'ArrowRight' ? (cur === last ? 0 : cur + 1)
      : e.key === 'ArrowLeft' ? (cur === 0 ? last : cur - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : -1;
    if (next < 0) return;
    e.preventDefault();
    setCur(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <>
      <Note icon="shield">설치는 허용 목록 · 버전/해시 고정 · 사람 승인을 모두 거칩니다.</Note>
      <div className="tabs" role="tablist" aria-label="카탈로그 종류" onKeyDown={onKeyDown}>
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`cat-tab-${t.id}`}
            className="tab"
            aria-selected={i === cur}
            aria-controls="cat-panel"
            tabIndex={i === cur ? 0 : -1}
            onClick={() => setCur(i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="cat-panel" aria-labelledby={`cat-tab-${tab.id}`} tabIndex={0}>
        {tab.id === 'mcp' ? (
          <EmptyTable label="MCP 서버 목록" cols={MCP_COLS} icon="box">
            등록된 MCP 서버 없음 — P3에서 허용 목록부터
          </EmptyTable>
        ) : (
          <SkillTab />
        )}
      </div>
    </>
  );
}

function SkillTab() {
  const [state, setState] = useState<SkillState>({ kind: 'loading' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const ctrl = new AbortController();
    setState({ kind: 'loading' });
    listAdminSkills(ctrl.signal).then(
      (data) => setState({ kind: 'ok', data }),
      (e) => {
        if ((e as Error).name === 'AbortError') return;
        setState({ kind: 'error', text: e instanceof AdminApiError && e.kind === 'conductor' ? `conductor 에 연결할 수 없어요 (${API_URL}) — npm run api` : 'Skill 목록을 읽지 못했어요' });
      },
    );
    return () => ctrl.abort();
  }, [tick]);

  if (state.kind === 'loading') return <EmptyTable label="Skill 목록" cols={SKILL_COLS} icon="box">불러오는 중…</EmptyTable>;
  if (state.kind === 'error') {
    return (
      <EmptyTable label="Skill 목록" cols={SKILL_COLS} icon="box">
        <span role="alert">{state.text}</span>
        <button className="btn" type="button" onClick={() => setTick((t) => t + 1)}>다시 시도</button>
      </EmptyTable>
    );
  }
  const { skills, errors, source } = state.data;
  if (skills.length === 0) {
    return (
      <EmptyTable label="Skill 목록" cols={SKILL_COLS} icon="box">
        스킬 없음 — <code>{source}/&lt;이름&gt;/SKILL.md</code> 를 넣고 conductor 를 다시 켜요
      </EmptyTable>
    );
  }
  return (
    <>
      <div className="table sktable">
        <table aria-label="Skill 목록">
          <thead>
            <tr>{SKILL_COLS.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
          </thead>
          <tbody>
            {skills.map((k) => (
              <tr key={k.name} data-skill={k.name}>
                <td className="skn">
                  <b>{k.label}</b>
                  {k.builtin && <span className="chip">내장</span>}
                  <code>{k.name}</code>
                </td>
                <td className="skd">{k.description}</td>
                <td className="skt">{k.tools.length ? k.tools.join(' · ') : <span className="nil">—</span>}</td>
                <td><code>{k.source}</code></td>
                <td><code className="ver" title={`SKILL.md sha256 앞 12자 · ${k.lines}줄`}>{k.version}</code></td>
                <td className="num">{k.used}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {errors.length > 0 && (
        <p className="flash error" role="alert">
          읽지 못한 스킬 {errors.length}개 — {errors.map((e) => `${e.dir} (${e.code})`).join(' · ')}
        </p>
      )}
      <p className="docs-src">
        읽기 전용 · 출처 <code>{source}</code> (레포에 든 제품 스킬, 개발 루틴 <code>.claude/skills</code> 와 별개) · 바꾸면 버전이 바뀌어요.
        새 스킬 저장·등록(격리 → 테스트 → 승인)은 P5.
      </p>
    </>
  );
}
