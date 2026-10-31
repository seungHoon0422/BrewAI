// 범위 문구 (한국어) — 층 이름은 @brewai/ui 의 KIND_LABEL 한곳 (바꾸면 '새 프로젝트' · '스페이스 설정' 같은 문구가 같이 바뀐다).
import { KIND_LABEL } from '@brewai/ui';

export { KIND_LABEL };

const S = KIND_LABEL.space;

export const SPACES = {
  switcher: `${S} 바꾸기`,
  personal: `내 ${S}`,
  personalSub: '나만 보는 곳이에요',
  joined: `참여한 ${S}`,
  browse: '둘러보기',
  join: '참여',
  create: '새로 만들기',
  settings: `${S} 설정`,
  loading: '불러오는 중…',
  failed: `${S} 목록을 불러오지 못했어요`,
  archived: '보관됨',
  members: (n: number) => `멤버 ${n}명`,
  visibility: { open: `${KIND_LABEL.org} 누구나 참여`, private: '초대한 사람만' },
  visibilityHint: { open: `${KIND_LABEL.org} 사람이 둘러보기에서 찾아 스스로 참여해요`, private: '멤버로 넣은 사람만 볼 수 있어요' },
  role: { admin: '운영', member: '멤버' },
  implicit: `${KIND_LABEL.org} 운영 (자동)`,
  // 만들기 · 설정
  createTitle: `새 ${S}`,
  createSub: `함께 쓸 ${S}를 만들어요. 대화는 기본으로 나만 보고, [공유]한 것만 멤버에게 보여요`,
  name: '이름',
  namePlaceholder: '예: 제품팀',
  description: '설명',
  descriptionPlaceholder: '무엇을 하는 곳인지 한 줄로',
  access: '공개 범위',
  org: KIND_LABEL.org,
  memberList: '멤버',
  addMember: '사람 찾기',
  addMemberPlaceholder: '닉네임이나 이메일로 찾기',
  noMatch: '찾는 사람이 없어요',
  notInOrg: `${KIND_LABEL.org}에 없는 사람은 BrewAI 담당자에게 초대를 요청하세요`,
  add: '넣기',
  remove: '빼기',
  memberRole: (name: string) => `${name} 역할`,
  removeMember: (name: string) => `${name} 빼기`,
  you: '나',
  save: '저장',
  saved: '저장했어요',
  cancel: '취소',
  createAction: '만들기',
  leave: '나가기',
  leaveTitle: `이 ${S}에서 나갈까요?`,
  leaveBody: '나가면 이 곳의 대화와 공유된 대화를 볼 수 없어요',
  archive: '보관',
  unarchive: '보관 풀기',
  archiveTitle: `이 ${S}를 보관할까요?`,
  archiveBody: '보관하면 새 대화를 시작할 수 없어요. 기록은 그대로 남아요',
  memberOnly: `이름, 공개 범위, 멤버는 ${S} 운영 멤버만 바꿀 수 있어요`,
  removed: `그 ${S}에 더 이상 들어갈 수 없어서 내 ${S}로 옮겼어요`,
} as const;

// 범위 실패 코드 → 문구 (서버 detail)
const ERRORS: Record<string, string> = {
  bad_name: '이름은 1~60자로 적어 주세요',
  forbidden: '이 작업을 할 권한이 없어요',
  org_not_found: `${KIND_LABEL.org}을 찾지 못했어요`,
  user_not_found: `그 사람은 ${KIND_LABEL.org}에 없어요`,
  member_not_found: '이미 빠진 멤버예요',
  space_not_found: `${S}를 찾지 못했어요`,
  personal_space: `내 ${S}에서는 할 수 없어요`,
  implicit_member: `${KIND_LABEL.org} 운영 멤버는 나갈 수 없어요`,
  space_archived: `보관된 ${S}예요`,
  offline: '서버에 연결할 수 없어요',
};
export const scopeError = (code: string | undefined) =>
  code && Object.prototype.hasOwnProperty.call(ERRORS, code) ? ERRORS[code] : '잠시 후 다시 시도해 주세요';

// 스페이스 이름 — 내 스페이스는 어디서나 같은 말로
export const spaceName = (s: { kind: 'personal' | 'shared'; name: string }) => (s.kind === 'personal' ? SPACES.personal : s.name);
