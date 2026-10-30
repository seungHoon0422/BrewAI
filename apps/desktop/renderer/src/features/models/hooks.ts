// 모델 상태 = 목록 · 고른 모델 · 생각 깊이 · 최근 고른 모델. 대화(chat/hooks.ts)가 보낼 때 여기서 읽는다.
// 이 기기의 선택만 기억한다 (localStorage). 저장소가 막혀 있어도 화면은 그대로 돈다.
import { useMemo } from 'react';
import { failureOf, type Failure, type Reasoning } from '../../lib/api';
import { createStore, loading, single, type Loadable } from '../../lib/store';
import { listModels, type Model } from './api';
import { PICKER } from './copy';

export type ModelState = {
  models: Loadable<Model, Failure>;
  pickModel: string | null; // 사용자가 고른 모델 (null = 기본 모델)
  reasoning: Reasoning; // 사용자가 고른 생각 깊이 (모델이 지원할 때만 보낸다)
  modelNotice: string | null; // 고른 모델이 사라져 기본으로 돌아갔을 때 한 줄
  recentModels: string[]; // 최근 고른 모델 id (새 것이 앞 · 모델 메뉴 '최근 사용')
};

const PREF_KEY = 'brewai.chat.prefs';
function readPrefs(): { model: string | null; reasoning: Reasoning } {
  try {
    const raw = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') as { model?: unknown; reasoning?: unknown };
    return {
      model: typeof raw.model === 'string' ? raw.model : null,
      reasoning: raw.reasoning === 'low' || raw.reasoning === 'high' ? raw.reasoning : 'off',
    };
  } catch {
    return { model: null, reasoning: 'off' };
  }
}
function writePrefs(s: ModelState) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify({ model: s.pickModel, reasoning: s.reasoning }));
  } catch {}
}
const RECENT_KEY = 'brewai.chat.prefs.recent';
const RECENT_MAX = 5; // 메뉴엔 목록에 아직 있는 것 3개까지
function readRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}
function writeRecent(ids: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids));
  } catch {}
}

const prefs = readPrefs();
const store = createStore<ModelState>({
  models: loading(),
  pickModel: prefs.model,
  reasoning: prefs.reasoning,
  modelNotice: null,
  recentModels: readRecent(),
});

export const useModelState = store.use;

// 고른 모델 → 없으면 기본 모델 → 없으면 첫 모델
export function effectiveModel(s: ModelState): Model | null {
  const list = s.models.list;
  return list.find((m) => m.id === s.pickModel) ?? list.find((m) => m.is_default) ?? list[0] ?? null;
}
export const effectiveReasoning = (s: ModelState): Reasoning => (effectiveModel(s)?.supports_reasoning ? s.reasoning : 'off');
// 보낼 때 (화면 밖)
export const currentModel = () => effectiveModel(store.get());
export const currentReasoning = () => effectiveReasoning(store.get());

export const loadModels = single(async () => {
  store.set((s) => (s.models.list.length ? s : { ...s, models: { ...s.models, status: 'loading', error: null } }));
  try {
    const list = await listModels();
    store.set((s) => {
      // 고른 모델이 숨겨졌거나 사라졌으면 기본 모델로 (관리자가 숨기면 사용자 목록에서 사라진다 · P2-1)
      const gone = s.pickModel !== null && !list.some((m) => m.id === s.pickModel);
      const gonePick = gone ? s.models.list.find((m) => m.id === s.pickModel)?.label ?? null : null;
      const next: ModelState = {
        ...s,
        models: { status: 'ready', list, error: null },
        pickModel: gone ? null : s.pickModel,
        modelNotice: gone && gonePick ? PICKER.fellBack(gonePick) : gone ? null : s.modelNotice,
      };
      if (gone) writePrefs(next);
      return next;
    });
  } catch (e) {
    store.set((s) => ({ ...s, models: { ...s.models, status: 'error', error: failureOf(e) } }));
  }
});

export function pickModel(id: string) {
  store.set((s) => {
    const recentModels = [id, ...s.recentModels.filter((x) => x !== id)].slice(0, RECENT_MAX);
    const next = { ...s, pickModel: id, modelNotice: null, recentModels };
    writePrefs(next);
    writeRecent(recentModels);
    return next;
  });
}
export function pickReasoning(r: Reasoning) {
  store.set((s) => {
    const next = { ...s, reasoning: r };
    writePrefs(next);
    return next;
  });
}
export const clearModelNotice = () => store.set((s) => (s.modelNotice ? { ...s, modelNotice: null } : s));

// 같은 표시 이름 (대소문자 · 공백 무시) 의 다른 모델이 목록에 있나 → 화면은 이름 옆에 게이트웨이 id 를 같이 보여 준다
// (config.yaml 모델과 LiteLLM 관리 화면 모델이 이름이 같을 때 · 모델 메뉴 · 입력창 버튼 · 답 아래 줄 · 진행 상황)
const labelKey = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/g, '');
export type DupCheck = (m: { id: string; label: string }) => boolean;
export function dupCheck(list: readonly Model[]): DupCheck {
  const ids = new Map<string, Set<string>>();
  for (const m of list) ids.set(labelKey(m.label), (ids.get(labelKey(m.label)) ?? new Set()).add(m.id));
  return (m) => [...(ids.get(labelKey(m.label)) ?? [])].some((id) => id !== m.id);
}
export function useDupCheck(): DupCheck {
  const list = store.use((s) => s.models.list);
  return useMemo(() => dupCheck(list), [list]);
}
