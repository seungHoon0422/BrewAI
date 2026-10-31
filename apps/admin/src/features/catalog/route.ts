// 카탈로그 길 = 해시 두 번째 칸부터 끝까지(restOf) 하나로 정한다 (모델 화면 route.ts 와 같은 결):
//   '' = MCP 서버 탭 · 'user-servers' = 사용자 추가 서버 탭 · 'skill' = Skill 탭 · 'mcp/<id>' = 그 서버 자세히 페이지
import { hrefOf } from '../../app/routes';
import { TABS, type CatalogTab } from './copy';

export type CatalogRoute = { kind: 'tab'; tab: CatalogTab } | { kind: 'detail'; id: string };

const FIRST = TABS[0].id;

export function catalogRoute(sub: string): CatalogRoute {
  const [head, ...rest] = sub.split('/');
  if (head === 'mcp' && rest.length > 0 && rest.join('/')) {
    const raw = rest.join('/');
    try {
      return { kind: 'detail', id: decodeURIComponent(raw) };
    } catch {
      return { kind: 'detail', id: raw }; // 깨진 % 조각 = 그대로 (없는 서버 안내로)
    }
  }
  const tab = TABS.find((t) => t.id !== FIRST && t.id === head);
  return { kind: 'tab', tab: tab ? tab.id : FIRST };
}

export const isCatalogDetail = (sub: string) => catalogRoute(sub).kind === 'detail';
export const catalogTabHref = (tab: CatalogTab) => hrefOf('catalog', tab === FIRST ? undefined : tab);
// from = 돌아갈 탭 (첫 탭이면 뺀다 · 틀의 '← 목록' 링크가 읽는다)
export const serverHref = (id: string, from?: CatalogTab) =>
  hrefOf('catalog', `mcp/${encodeURIComponent(id)}`, { from: from && from !== FIRST ? from : null });
