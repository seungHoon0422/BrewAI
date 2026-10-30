// 지금 범위 = 앱 전체 store 하나 (어느 스페이스 · 어느 프로젝트에서 일하는지). 화면 밖 함수(대화 보내기 등)도 읽는다.
// 다른 기능은 watchScope 로 '스페이스가 바뀌면 다시 읽기' 를 건다 (scope 는 그 기능들을 모른다 = 의존 방향 한쪽).
import { useEffect, useState } from 'react';
import type { ScopePath } from '@brewai/ui';
import { failureOf, isAbort, type Failure } from '../../lib/api';
import { createStore, loading, single, type Loadable } from '../../lib/store';
import { currentMe, useAuth } from '../auth/hooks';
import {
  createSpace, findPeople, joinSpace, leaveSpace, listMembers, listSpaces, patchSpace, rememberSpace, removeMember, setMember,
  type Member, type Org, type Person, type Space, type SpaceInput, type SpaceRole,
} from './api';
import { SPACES } from './copy';
import { visiblePath } from './model';

export type ScopeState = {
  spaces: Loadable<Space, Failure>; // 내 스페이스 먼저 · 참여한 공유
  browse: Space[]; // 참여 안 한 open (둘러보기)
  orgs: Org[];
  spaceId: string | null; // 지금 스페이스
  projectId: string | null; // 지금 연 프로젝트 (프로젝트 화면 · 새 대화가 들어갈 곳) — null = 프로젝트 없음
  notice: string | null; // 한 번 보이는 알림 (빠진 스페이스 등)
};

const store = createStore<ScopeState>({ spaces: loading(), browse: [], orgs: [], spaceId: null, projectId: null, notice: null });
const set = store.set;

export const useScopeState = store.use;
export const watchScope = store.watch;
export const currentSpaceId = () => store.get().spaceId;
export const currentProjectId = () => store.get().projectId;
export const spaceById = (id: string | null | undefined) => store.get().spaces.list.find((s) => s.id === id) ?? null;
export const currentSpace = () => spaceById(store.get().spaceId);
export const useCurrentSpace = () => store.use((s) => s.spaces.list.find((x) => x.id === s.spaceId) ?? null);

// 내가 속한 조직 수 (하나면 경로 · 전환기에서 조직을 숨긴다)
export const useTenants = () => useAuth((s) => s.me?.orgs.length ?? 1);

// 보여 줄 경로 (조직 하나 = 숨김 · 맨 아래 칸은 withItem 일 때만)
export function useScopePath(path: ScopePath, withItem = false): ScopePath {
  return visiblePath(path, { tenants: useTenants(), withItem });
}

// ── 시작 · 읽기 ──
export function initScope() {
  const me = currentMe();
  if (!me || store.get().spaceId) return;
  set((s) => ({ ...s, spaceId: me.last_space_id ?? me.personal_space_id }));
  void loadSpaces();
}

export const loadSpaces = single(async () => {
  try {
    const { spaces, browse, orgs } = await listSpaces();
    set((s) => ({ ...s, spaces: { status: 'ready', list: spaces, error: null }, browse, orgs }));
    // 지금 스페이스에서 빠졌으면(제거 · 보관된 private) 내 스페이스로
    const s = store.get();
    if (s.spaceId && !spaces.some((x) => x.id === s.spaceId)) {
      const personal = currentMe()?.personal_space_id ?? spaces.find((x) => x.kind === 'personal')?.id ?? null;
      if (personal) switchSpace(personal, SPACES.removed);
    }
  } catch (e) {
    set((s) => ({ ...s, spaces: { ...s.spaces, status: 'error', error: failureOf(e) } }));
  }
});

// ── 바꾸기 ──
export function switchSpace(id: string, notice: string | null = null) {
  if (store.get().spaceId === id) return focusProject(null);
  set((s) => ({ ...s, spaceId: id, projectId: null, notice }));
  void rememberSpace(id).catch(() => {}); // 기억은 덤 — 실패해도 지금 화면은 그대로
}

export const focusProject = (id: string | null) => set((s) => (s.projectId === id ? s : { ...s, projectId: id }));
export const clearNotice = () => set((s) => (s.notice ? { ...s, notice: null } : s));

// 서버가 준 스페이스 하나로 목록을 고친다 (설정 저장 뒤)
function upsert(space: Space) {
  set((s) => ({
    ...s,
    spaces: { ...s.spaces, list: s.spaces.list.some((x) => x.id === space.id) ? s.spaces.list.map((x) => (x.id === space.id ? space : x)) : [...s.spaces.list, space] },
    browse: s.browse.filter((x) => x.id !== space.id),
  }));
}

// 동작들 — 실패하면 conductor 코드를 던진다 (화면이 scopeError 로 바꾼다)
export async function makeSpace(input: SpaceInput): Promise<Space> {
  const space = await createSpace(input);
  upsert(space);
  switchSpace(space.id);
  return space;
}

export async function join(id: string) {
  upsert(await joinSpace(id));
  switchSpace(id);
}

export async function updateSpace(id: string, patch: Parameters<typeof patchSpace>[1]) {
  const space = await patchSpace(id, patch);
  upsert(space);
  return space;
}

export async function leave(id: string) {
  await leaveSpace(id);
  const personal = currentMe()?.personal_space_id;
  if (personal && store.get().spaceId === id) switchSpace(personal);
  await loadSpaces();
}


// ── 화면용 읽기 훅 (멤버 · 사람 찾기) — 부품은 요청하지 않고 이 훅만 쓴다 ──
export function useMembers(spaceId: string, active: boolean) {
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; list: Member[] }>({ status: 'loading', list: [] });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!active) return;
    const ctrl = new AbortController();
    listMembers(spaceId, ctrl.signal).then(
      (list) => setState({ status: 'ready', list }),
      (e) => !isAbort(e) && setState((s) => ({ ...s, status: 'error' })),
    );
    return () => ctrl.abort();
  }, [spaceId, active, version]);
  return { ...state, reload: () => setVersion((v) => v + 1) };
}

// 조직 사람 찾기 — 글자를 멈추고 250ms 뒤 한 번
export function usePeopleSearch(q: string, orgId: string | undefined) {
  const [found, setFound] = useState<{ q: string; list: Person[] }>({ q: '', list: [] });
  useEffect(() => {
    const query = q.trim();
    if (!query) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      findPeople(query, orgId, ctrl.signal).then((list) => setFound({ q: query, list }), () => {});
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, orgId]);
  return q.trim() && found.q === q.trim() ? found.list : null; // null = 아직 (찾는 중 · 빈 칸)
}

export const addMember = (spaceId: string, userId: string, role: SpaceRole) => setMember(spaceId, userId, role);
export const dropMember = (spaceId: string, userId: string) => removeMember(spaceId, userId);
