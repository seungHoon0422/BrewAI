// 사용자·조직 화면 문구 (탭 · 사용자 탭). 조직 · 스페이스 · 초대 탭 문구는 features/<그 이름>/copy.ts.
// 층 이름은 KIND_LABEL 로만 (@brewai/ui scope.ts) — 층 이름이 바뀌면 탭 이름도 같이 바뀐다.
import type { InstanceRole, UserStatus } from './api';
import { KIND_LABEL } from '../scope/copy';

const ORG = KIND_LABEL.org;
const S = KIND_LABEL.space;

export type DirectoryTab = 'people' | 'orgs' | 'spaces' | 'invites';
export const DIRECTORY_TABS: readonly DirectoryTab[] = ['people', 'orgs', 'spaces', 'invites'];

export const PROVIDER_TEXT: Record<string, string> = { password: '비밀번호', google: 'Google' };
export const STATUS_TEXT: Record<UserStatus, string> = { active: '활성', disabled: '비활성' };
export const ROLE_TEXT: Record<InstanceRole, string> = { admin: '관리자', user: '사용자' };

export const USERS_COPY = {
  tabs: `사용자와 ${ORG} 탭`,
  people: '사용자',
  invites: '초대',
  // 표
  table: '사용자 목록',
  colUser: '사용자',
  colLastSeen: '마지막 접속',
  colStatus: '상태',
  search: '닉네임이나 이메일 검색',
  count: (n: number) => `${n}명`,
  empty: '아직 사용자가 없어요',
  emptyHow: '초대 탭에서 코드를 만들어 보내면 데스크톱 앱에서 가입해요.',
  noMatch: '맞는 사용자가 없어요',
  never: '아직 없음',
  me: '나',
  noOrg: '없음',
  // 서랍
  sheetTitle: '사용자',
  partAccess: '권한',
  partAccount: '계정',
  partReset: '비밀번호 재설정',
  kv: { email: '이메일', login: '로그인 방법', created: '가입', lastSeen: '마지막 접속', sessions: '로그인한 기기' },
  sessions: (n: number) => (n ? `${n}개` : '없음'),
  nameField: '닉네임',
  nameHint: '1~40자. 다른 사람과 같아도 돼요. 사람이 보이는 곳마다 이 이름이 나와요.',
  adminSwitch: '관리자 콘솔 권한',
  adminHint: `켜면 이 콘솔에 로그인해 사용자, ${ORG}, 모델을 관리할 수 있어요.`,
  selfHint: '내 계정은 여기서 비활성화하거나 관리자 권한을 뺄 수 없어요.',
  disable: '비활성화',
  enable: '다시 활성화',
  disabledNote: `비활성 계정은 로그인할 수 없어요. 대화와 ${S}는 그대로 남아 있어요.`,
  disableTitle: (name: string) => `${name} 님을 비활성화할까요?`,
  disableBody: `로그인한 모든 기기에서 바로 로그아웃되고, 다시 활성화할 때까지 로그인할 수 없어요. 대화와 ${S}는 그대로 남아요.`,
  revoke: '모든 기기에서 로그아웃',
  revokeHint: '계정은 그대로 두고 로그인한 기기만 끊어요.',
  resetBtn: '재설정 코드 만들기',
  resetHint: '비밀번호를 잊은 사용자에게 전해 주세요. 데스크톱 앱 로그인 화면 › 비밀번호 재설정에 넣으면 새 비밀번호를 정해요.',
  resetGoogleOnly: 'Google 로만 로그인하는 계정이에요. 코드를 쓰면 비밀번호 로그인도 생겨요.',
  resetLabel: '비밀번호 재설정 코드',
  resetExpires: (left: string) => `${left}. 한 번만 쓸 수 있어요. 쓰면 그 사용자의 모든 세션이 끊겨요.`,
  done: {
    disabled: (name: string) => `${name} 님을 비활성화했어요`,
    enabled: (name: string) => `${name} 님을 다시 활성화했어요`,
    adminOn: (name: string) => `${name} 님에게 관리자 권한을 줬어요`,
    adminOff: (name: string) => `${name} 님의 관리자 권한을 뺐어요`,
    renamed: (name: string) => `닉네임을 ${name}(으)로 바꿨어요`,
    revoked: (n: number) => (n ? `기기 ${n}개에서 로그아웃시켰어요` : '로그인한 기기가 없었어요'),
  },
} as const;

// PATCH · 세션 · 코드 실패 (detail code) → 한 줄
export const USER_ERROR: Record<string, string> = {
  cannot_change_self: '내 계정은 비활성화하거나 관리자 권한을 뺄 수 없어요',
  bad_display_name: '닉네임은 1~40자, 보이지 않는 글자 없이 써 주세요',
  user_not_found: '그 사용자가 없어요. 목록을 새로 고쳐 주세요',
};
