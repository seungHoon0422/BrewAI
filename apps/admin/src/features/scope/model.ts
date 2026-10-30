// 범위 계층 — 표 · 층 이름 · 아이콘 · 경로 규칙은 @brewai/ui scope.ts 한 곳 (두 앱 공용 · 서버 scopes.py 와 같은지 pytest 가 본다).
// 화면은 층 수 · 이름을 모른다: API 가 준 path = [{kind, id, name}] 을 <Breadcrumb> 에 넘기고, 층 이름은 roleLabel(역할) 로 묻는다.
export {
  LEVELS, kindIcon, kindLabel, kindOf, roleIcon, roleLabel, visiblePath, pathOf, parsePath,
  type LevelRole, type ScopeCrumb, type ScopeLevel, type ScopePath,
} from '@brewai/ui';
