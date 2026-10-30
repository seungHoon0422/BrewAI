// 스킬 · 도구 이름표 상태. 대화의 단계 이름(스킬 · 계산기 …)과 스킬 메뉴가 같이 본다.
import { useMemo } from 'react';
import { failureOf, type Failure } from '../../lib/api';
import { createStore, loading, single, type Loadable } from '../../lib/store';
import { listSkills, listTools, type SkillInfo } from './api';

type SkillState = {
  tools: Record<string, string>; // 툴 이름 → 화면 이름
  skills: Loadable<SkillInfo, Failure>;
};

const store = createStore<SkillState>({ tools: {}, skills: loading() });

export const useSkillState = store.use;
export const useToolLabels = () => store.use((s) => s.tools);

// 화면 밖 (대화 이벤트를 받을 때)
export const toolLabels = () => store.get().tools;
export const skillLabels = (): Record<string, string> => Object.fromEntries(store.get().skills.list.map((k) => [k.name, k.label]));

// 화면용: 목록이 바뀔 때만 새 객체 (store.use 에 바로 주면 매번 새 객체 → 무한 다시 그리기)
export function useSkillLabels(): Record<string, string> {
  const list = store.use((s) => s.skills.list);
  return useMemo(() => Object.fromEntries(list.map((k) => [k.name, k.label])), [list]);
}

let toolsLoaded = false;
export function loadTools() {
  if (toolsLoaded) return;
  toolsLoaded = true;
  listTools().then(
    (list) => store.set((s) => ({ ...s, tools: Object.fromEntries(list.map((t) => [t.name, t.label])) })),
    () => {
      toolsLoaded = false; // 다음에 다시
    },
  );
}

// 실행이 끝날 때마다 다시 읽는다 (사용 횟수)
export const loadSkills = single(async () => {
  try {
    const list = await listSkills();
    store.set((s) => ({ ...s, skills: { status: 'ready', list, error: null } }));
  } catch (e) {
    store.set((s) => ({ ...s, skills: { ...s.skills, status: 'error', error: failureOf(e) } }));
  }
});
