// 범위 계층 — 표 · 층 이름 · 아이콘 · 경로 규칙은 @brewai/ui scope.ts 한 곳 (두 앱 공용 · 서버 scopes.py 와 같은지 pytest 가 본다).
// 이 앱은 역할별 층 이름만 상수로 꺼내 쓴다. 층을 넣거나 이름을 바꿔도 여기는 그대로.
import { kindOf } from '@brewai/ui';

export { kindIcon, kindLabel, visiblePath, crumbOf, type ScopeCrumb, type ScopePath } from '@brewai/ui';

export const TENANT = kindOf('tenant'); // 사람 묶음 — 하나뿐이면 경로에서 숨긴다
export const MEMBERSHIP = kindOf('membership'); // 멤버 · 역할이 붙는 층 = 사이드바 전환기
export const GROUP = kindOf('group'); // 멤버십 아래 선택 묶음 (지침) — 대화는 묶음 없이도 된다
export const ITEM = kindOf('item'); // 맨 아래 단위 — 화면 제목이 따로 있으면 경로에서 뺀다
