// 범위 계층 (조직 > 스페이스 > 프로젝트 > 대화) = 화면 쪽은 이 파일 한 곳 (ADR-0011 · ADR-0012). 데스크톱 · 관리자 콘솔이 같이 쓴다.
// 서버 원본 = services/conductor/src/conductor/scopes.py LEVELS (GET /api/scopes = describe()). 아래 LEVELS 가 그와 같은지는
// services/conductor/tests/test_scopes.py 가 본다 → 층을 넣거나 이름을 바꾸면 = scopes.py + 마이그레이션 + 여기 (LEVELS · KIND_LABEL · KIND_ICON).
// 화면은 층 수 · 이름을 모른다: API 가 준 path = [{kind, id, name}] 을 <Breadcrumb> 로 그리고, 층 이름은 역할(roleLabel)로 묻는다.
import type { IconName } from './icons';

export type ScopeCrumb = { kind: string; id: string; name: string };
export type ScopePath = readonly ScopeCrumb[];

// 층 한 칸 (scopes.describe() 와 같은 모양)
export type ScopeLevel = {
  kind: string;
  parent: string | null;
  optional: boolean; // 아래 층이 이 층을 건너뛰고 바로 위에 붙을 수 있다 (프로젝트 없는 대화)
  membership: boolean; // 멤버 · 역할이 붙는 층
  tenant: boolean; // 사람 묶음 (가입 · 초대 · 조직 역할)
  item: boolean; // 사용자가 쓰는 맨 아래 단위
};

// 위 → 아래 (한 줄 = 한 층 · test_scopes.py 가 이 줄들을 읽는다)
export const LEVELS: readonly ScopeLevel[] = [
  { kind: 'org', parent: null, optional: false, membership: false, tenant: true, item: false },
  { kind: 'space', parent: 'org', optional: false, membership: true, tenant: false, item: false },
  { kind: 'project', parent: 'space', optional: true, membership: false, tenant: false, item: false },
  { kind: 'thread', parent: 'project', optional: false, membership: false, tenant: false, item: true },
];

// 층 이름 (화면 문구) · 아이콘 — 층마다 하나, 두 앱 같은 것 (메뉴 아이콘과 겹치지 않게: 스킬 = layers)
export const KIND_LABEL = { org: '조직', space: '스페이스', project: '프로젝트', thread: '대화' } as const;
const KIND_ICON = { org: 'building', space: 'people', project: 'folder', thread: 'chat' } as const satisfies Record<keyof typeof KIND_LABEL, IconName>;

// 모르는 층(서버가 먼저 바뀐 경우)도 그린다 — 이름표 · 아이콘만 없다
export const kindLabel = (kind: string): string | undefined => (KIND_LABEL as Record<string, string | undefined>)[kind];
export const kindIcon = (kind: string): IconName | undefined => (KIND_ICON as Record<string, IconName | undefined>)[kind];

// 층의 역할 → 층. 화면은 'org' · 'space' 를 직접 쓰지 않고 역할로 묻는다 (층 이름이 바뀌어도 화면은 그대로)
//   tenant = 사람 묶음 · membership = 멤버 · 역할이 붙는 층(사이드바 전환기) · group = 멤버십 아래 선택 묶음(지침) · item = 맨 아래 단위
export type LevelRole = 'tenant' | 'membership' | 'group' | 'item';
export function kindOf(role: LevelRole, levels: readonly ScopeLevel[] = LEVELS): string {
  const found = role === 'group' ? levels.find((l) => l.optional) : levels.find((l) => l[role]);
  return found!.kind;
}
export const roleLabel = (role: LevelRole): string => kindLabel(kindOf(role)) ?? kindOf(role);
export const roleIcon = (role: LevelRole): IconName | undefined => kindIcon(kindOf(role));

// 보이는 경로: 사람 묶음(조직)이 하나뿐이면 그 칸을 숨기고(모르면 둔다), 맨 아래 칸(대화)은 화면 제목이 따로 있으면 뺀다
export function visiblePath(path: ScopePath, opts: { tenants?: number; withItem?: boolean } = {}): ScopePath {
  const tenant = kindOf('tenant');
  const item = kindOf('item');
  return path.filter((c) => !(c.kind === tenant && opts.tenants !== undefined && opts.tenants <= 1) && (opts.withItem || c.kind !== item));
}

// 경로에서 어떤 역할의 칸 하나 (예: 대화 경로 → 그 스페이스 · 그 프로젝트)
export const crumbOf = (path: ScopePath, role: LevelRole): ScopeCrumb | undefined => path.find((c) => c.kind === kindOf(role));

// path 가 없는 응답(관리자 목록 줄)용: [역할, id, 이름] 사슬 → path. 서버가 path 를 주면 parsePath 가 먼저다
export const pathOf = (...chain: readonly (readonly [LevelRole, string, string | null])[]): ScopePath =>
  chain.map(([role, id, name]) => ({ kind: kindOf(role), id, name: name ?? '' }));

// 응답의 path 칸 → ScopePath (모양이 틀리면 null)
export function parsePath(v: unknown): ScopePath | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const out: ScopeCrumb[] = [];
  for (const c of v as Record<string, unknown>[]) {
    if (typeof c?.kind !== 'string' || typeof c.id !== 'string') return null;
    out.push({ kind: c.kind, id: c.id, name: typeof c.name === 'string' ? c.name : '' });
  }
  return out;
}
