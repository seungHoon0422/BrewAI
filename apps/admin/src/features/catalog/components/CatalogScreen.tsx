import type { ComponentType } from 'react';
import { Tabs } from '@brewai/ui';
import { useHash } from '../../../app/hash';
import { restOf } from '../../../app/routes';
import { TABS, CATALOG_COPY as C, type CatalogTab } from '../copy';
import { catalogRoute, catalogTabHref } from '../route';
import McpTab from './McpTab';
import { ServerPage } from './ServerPage';
import SkillTab from './SkillTab';
import UserServersTab from './UserServersTab';
import '../catalog.css';

// 카탈로그 = 탭 셋: MCP 서버(전체 공통 · ADR-0013) · 사용자 추가 서버(보기 · 끄기 · 정책) · Skill(읽기 전용).
// 길 = route.ts 하나: '#/catalog' · '#/catalog/user-servers' · '#/catalog/skill' · '#/catalog/mcp/<id>' = 서버 자세히 (머리 = 그 화면이 그린다)
const PANELS: Record<CatalogTab, ComponentType> = { mcp: McpTab, 'user-servers': UserServersTab, skill: SkillTab };

export default function CatalogScreen() {
  const route = catalogRoute(restOf(useHash()));
  if (route.kind === 'detail') return <ServerPage key={route.id} id={route.id} />;
  const Panel = PANELS[route.tab];
  return (
    <div className="catalog">
      <Tabs label={C.tabs} items={TABS} value={route.tab} onChange={(t) => window.location.assign(catalogTabHref(t))}>
        <Panel />
      </Tabs>
    </div>
  );
}
