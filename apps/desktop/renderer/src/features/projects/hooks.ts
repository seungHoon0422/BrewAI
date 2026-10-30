// 프로젝트 = 지금 스페이스의 목록 store. 스페이스가 바뀌면 다시 읽는다 (scope 를 따라간다 · scope 는 이 기능을 모른다).
import { failureOf, type Failure } from '../../lib/api';
import { createStore, loading, type Loadable } from '../../lib/store';
import { currentProjectId, currentSpaceId, focusProject, watchScope } from '../scope/hooks';
import { createProject, listProjects, patchProject, type Project, type ProjectInput } from './api';

type ProjectsState = { spaceId: string | null; projects: Loadable<Project, Failure> };

const store = createStore<ProjectsState>({ spaceId: null, projects: loading() });
const set = store.set;

export const useProjects = () => store.use((s) => s.projects);
export const useProject = (id: string | null) => store.use((s) => (id ? s.projects.list.find((p) => p.id === id) ?? null : null));
const sorted = (list: Project[]) => [...list].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ko'));

export const projectById = (id: string | null | undefined) => (id ? store.get().projects.list.find((p) => p.id === id) ?? null : null);

// 마지막 요청만 반영한다 (읽는 사이 스페이스가 바뀌면 앞의 응답은 버린다)
let seq = 0;
export async function loadProjects() {
  const spaceId = currentSpaceId();
  if (!spaceId) return;
  const mine = ++seq;
  if (store.get().spaceId !== spaceId) set(() => ({ spaceId, projects: loading() }));
  try {
    const list = await listProjects(spaceId);
    if (mine === seq) set(() => ({ spaceId, projects: { status: 'ready', list: sorted(list), error: null } }));
  } catch (e) {
    if (mine === seq) set((s) => ({ ...s, projects: { ...s.projects, status: 'error', error: failureOf(e) } }));
  }
}

watchScope((s) => s.spaceId, () => void loadProjects());

// 실패하면 conductor 코드를 던진다 (화면이 projectError 로)
export async function makeProject(input: ProjectInput): Promise<Project> {
  const spaceId = currentSpaceId();
  if (!spaceId) throw new Error('no_space');
  const project = await createProject(spaceId, input);
  set((s) => ({ ...s, projects: { ...s.projects, list: sorted([...s.projects.list, project]) } }));
  focusProject(project.id);
  return project;
}

export async function saveProject(id: string, patch: Parameters<typeof patchProject>[1]): Promise<Project> {
  const project = await patchProject(id, patch);
  set((s) => ({
    ...s,
    projects: {
      ...s.projects,
      list: project.archived_at ? s.projects.list.filter((p) => p.id !== id) : sorted(s.projects.list.map((p) => (p.id === id ? project : p))),
    },
  }));
  if (project.archived_at && currentProjectId() === id) focusProject(null);
  return project;
}
