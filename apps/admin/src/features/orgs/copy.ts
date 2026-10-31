// 조직 탭 문구. 층 이름은 KIND_LABEL 로만 (@brewai/ui scope.ts — 이름을 바꾸면 여기 문구가 같이 바뀐다)
import type { JoinPolicy, OrgRole } from './api';
import { KIND_LABEL } from '../scope/copy';

const ORG = KIND_LABEL.org;
const S = KIND_LABEL.space;

// 조직 역할 (사용자 · 초대 탭도 쓴다)
export const ORG_ROLE_TEXT: Record<OrgRole, string> = { owner: '소유자', admin: '관리자', member: '멤버' };
export const ORG_ROLE_HINT: Record<OrgRole, string> = {
  owner: `${ORG} 설정, 멤버, 모든 공유 ${S}를 관리해요`,
  admin: `멤버와 공유 ${S}를 관리해요`,
  member: `열린 ${S}에 들어가고 대화해요`,
};

export const orgMembershipText = (name: string, role: OrgRole) => `${name} (${ORG_ROLE_TEXT[role]})`;

export const JOIN_TEXT: Record<JoinPolicy, string> = { invite: '초대 코드만', domain_auto: '초대 코드 + 회사 도메인' };

export const ORGS_COPY = {
  table: `${ORG} 목록`,
  colName: '이름',
  colJoin: '가입 방식',
  colMembers: '멤버',
  colSpaces: `공유 ${S}`,
  colCreated: '만든 날',
  count: (n: number) => `${n}개`,
  create: '새로 만들기',
  empty: '아직 없어요',
  emptyHow: `첫 관리자가 처음 켤 때 기본 ${ORG}이 만들어져요. 여기서 더 만들 수 있어요.`,
  // 만들기
  createTitle: (kind: string) => `${kind} 만들기`,
  createDesc: '만든 관리자가 소유자가 돼요. 사람은 초대 탭에서 코드로 들여요.',
  nameField: '이름',
  nameHint: `60자까지. 사용자 앱의 ${S} 고르기에 보여요.`,
  slugField: '짧은 주소 (선택)',
  slugHint: '영문 소문자, 숫자, - 만 써요. 비우면 이름에서 만들어요.',
  createBtn: '만들기',
  // 서랍
  partJoin: '가입 방식',
  partSpaces: `${S} 만들기`,
  partMembers: '멤버',
  rename: '이름 바꾸기',
  joinLabel: '가입 방식',
  joinHint: {
    invite: '관리자가 만든 초대 코드로만 가입해요.',
    domain_auto: '초대 코드에 더해, 아래 Google Workspace 도메인 계정은 데스크톱 앱에서 Google 로 로그인하면 바로 멤버가 돼요.',
  },
  hdField: 'Google Workspace 도메인',
  hdHint: '예: example.com — Google 계정의 hd 값과 같아야 해요. @gmail.com 개인 계정은 해당 없어요.',
  hdPlaceholder: 'example.com',
  saveJoin: '가입 방식 저장',
  membersCreate: `멤버도 공유 ${S}를 만들 수 있어요`,
  membersCreateHint: '끄면 소유자와 관리자만 만들어요.',
  membersTable: `${ORG} 멤버`,
  colMember: '사람',
  colRole: '역할',
  roleOf: (name: string) => `${name} 님의 역할`,
  remove: (name: string) => `${name} 님을 ${ORG}에서 빼기`,
  removeTitle: (name: string) => `${name} 님을 ${ORG}에서 뺄까요?`,
  removeBody: `이 ${ORG}의 공유 ${S}에서도 함께 빠져요. 그 사람의 내 ${S}와 대화는 그대로 남아요.`,
  removeBtn: '빼기',
  disabled: '비활성',
  removeCol: '빼기',
  addLabel: '멤버 추가',
  candidate: (name: string, email: string) => `${name} (${email})`,
  addPick: '사람 고르기',
  addRole: '역할',
  addBtn: '추가',
  addNone: '더할 사람이 없어요 — 모두 이미 멤버예요',
  membersEmpty: '멤버가 없어요',
  done: {
    created: (name: string) => `${name}을(를) 만들었어요`,
    renamed: (name: string) => `이름을 ${name}(으)로 바꿨어요`,
    join: '가입 방식을 저장했어요',
    spacesOn: `멤버도 공유 ${S}를 만들 수 있어요`,
    spacesOff: `소유자와 관리자만 공유 ${S}를 만들어요`,
    role: (name: string, role: string) => `${name} 님을 ${role}(으)로 바꿨어요`,
    added: (name: string) => `${name} 님을 멤버로 넣었어요`,
    removed: (name: string) => `${name} 님을 뺐어요`,
  },
} as const;

export const ORG_ERROR: Record<string, string> = {
  bad_name: '이름은 1~60자로 써 주세요',
  google_hd_required: '도메인 자동 가입에는 Google Workspace 도메인이 있어야 해요',
  bad_google_hd: '도메인 모양이 아니에요 (예: example.com)',
  last_owner: '마지막 소유자는 빼거나 역할을 내릴 수 없어요. 다른 사람을 먼저 소유자로 정해 주세요',
  member_not_found: '이미 멤버가 아니에요. 새로 고쳐 주세요',
  org_not_found: `그 ${ORG}이 없어요. 새로 고쳐 주세요`,
  user_not_found: '그 사용자가 없어요',
};
