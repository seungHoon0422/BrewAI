import { useState } from 'react';
import { Badge, Button, Callout, TableFrame, Tabs } from '@brewai/ui';
import { EmptyTable } from '../../../shared/components/EmptyTable';
import { CATALOG_COPY as C, MCP_COLS, SKILL_COLS, TABS, type CatalogTab } from '../copy';
import { useSkills } from '../hooks';
import '../catalog.css';

// 카탈로그 = MCP 서버(P3) · Skill. Skill 탭 = conductor 가 읽은 제품 스킬 (runtime/skills, 읽기 전용 · 버전 = SKILL.md sha256 앞 12자).
// 새 스킬 저장·등록(격리 → 테스트 → 승인)은 P5 — 여기엔 바꾸는 버튼이 없다 (E2E: 탭 패널 안 버튼 0 · 입력칸 0).

export default function CatalogScreen() {
  const [tab, setTab] = useState<CatalogTab>('mcp');
  return (
    <div className="catalog">
      <Callout icon="shield">{C.rule}</Callout>
      <Tabs label={C.tabs} items={TABS} value={tab} onChange={setTab}>
        {tab === 'mcp' ? (
          <EmptyTable label={C.mcpTable} cols={MCP_COLS} icon="box" title={C.mcpEmpty}>{C.mcpWhen}</EmptyTable>
        ) : (
          <SkillTab />
        )}
      </Tabs>
    </div>
  );
}

function SkillTab() {
  const { state, retry } = useSkills();
  if (state.kind === 'loading') return <EmptyTable label={C.skillTable} cols={SKILL_COLS} loading />;
  if (state.kind === 'error') {
    return (
      <EmptyTable label={C.skillTable} cols={SKILL_COLS} icon="box" title={<span role="alert">{state.text}</span>}
        action={<Button onClick={retry}>{C.retry}</Button>} />
    );
  }
  const { skills, errors, source } = state.data;
  if (skills.length === 0) {
    const [path, rest] = C.skillHow(source);
    return (
      <EmptyTable label={C.skillTable} cols={SKILL_COLS} icon="box" title={C.skillEmpty}>
        <code>{path}</code>{rest}
      </EmptyTable>
    );
  }
  const foot = C.foot(source);
  return (
    <div className="skills">
      <TableFrame className="sktable">
        <table className="ui-table" aria-label={C.skillTable}>
          <thead>
            <tr>{SKILL_COLS.map((c, i) => <th key={c} scope="col" data-align={i === SKILL_COLS.length - 1 ? 'end' : undefined}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {skills.map((k) => (
              <tr key={k.name} data-skill={k.name}>
                <td className="skn">
                  <b>{k.label}</b>
                  <span className="skn-sub">
                    {k.builtin && <Badge size="sm" className="chip">{C.builtin}</Badge>}
                    <code>{k.name}</code>
                  </span>
                </td>
                <td className="skd">{k.description}</td>
                <td className="skt">{k.tools.length ? k.tools.join(' · ') : <span className="nil">—</span>}</td>
                <td><code>{k.source}</code></td>
                <td><code className="ver" title={C.versionTitle(k.lines)}>{k.version}</code></td>
                <td className="ui-num" data-align="end">{k.used}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableFrame>
      {errors.length > 0 && (
        <Callout live tone="danger">{C.unreadable(errors.length, errors.map((e) => `${e.dir} (${e.code})`).join(' · '))}</Callout>
      )}
      <p className="skfoot">
        {foot[0]}<code>{foot[1]}</code>{foot[2]}<code>{foot[3]}</code>{foot[4]}
      </p>
    </div>
  );
}
