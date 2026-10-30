// 모델 화면 길 = 해시 두 번째 칸부터 끝까지(restOf)로 정한다 (길 표 하나): '' = 모델 목록 탭 · 'add' = 모델 추가 탭 · 그 밖 = 그 모델 자세히 페이지.
// 자세히 = '#/models/<gateway_id>' (링크는 id 를 통째로 encodeURIComponent · 손으로 친 '#/models/openai/gpt-4o' 처럼 '/' 가 그대로여도 한 id).
// 이름이 'add' 인 게이트웨이 모델은 탭이 이겨서 자세히로 못 연다 (목록 · 추가 탭에서는 보인다 — 받아들인 충돌)
import { hrefOf } from '../../app/routes';
import { MODEL_TABS, type ModelTab } from './copy';

export type ModelRoute = { kind: 'tab'; tab: ModelTab } | { kind: 'detail'; id: string };

const FIRST = MODEL_TABS[0].id;

export function modelRoute(sub: string): ModelRoute {
  if (!sub) return { kind: 'tab', tab: FIRST };
  const tab = MODEL_TABS.find((t) => t.id !== FIRST && t.id === sub);
  if (tab) return { kind: 'tab', tab: tab.id };
  try {
    return { kind: 'detail', id: decodeURIComponent(sub) };
  } catch {
    return { kind: 'detail', id: sub }; // 깨진 % 조각 = 그대로 (없는 모델 안내로)
  }
}

export const isModelDetail = (sub: string) => modelRoute(sub).kind === 'detail';
export const tabHref = (tab: ModelTab) => hrefOf('models', tab === FIRST ? undefined : tab);
export const modelHref = (id: string) => hrefOf('models', encodeURIComponent(id));
