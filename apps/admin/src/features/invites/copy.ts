// 초대 탭 문구. 조직 역할 이름은 orgs/copy.ts ORG_ROLE_TEXT, 층 이름은 KIND_LABEL 로만 (@brewai/ui scope.ts)
import type { InviteStatus } from './api';
import { KIND_LABEL } from '../scope/copy';

const ORG = KIND_LABEL.org;
const S = KIND_LABEL.space;

export const STATUS_TEXT: Record<InviteStatus, string> = { active: '사용 가능', used_up: '다 씀', expired: '만료', revoked: '취소함' };
export const DAY_OPTIONS = [1, 3, 7, 14, 30] as const;
export const DEFAULT_DAYS = 7; // 서버 기본값과 같다 (INVITE_DAYS)

export const INVITES_COPY = {
  table: '초대 코드 목록',
  colOrg: ORG,
  colRole: '역할',
  colSpaces: `바로 들어갈 ${S}`,
  colUses: '사용',
  colExpires: '만료',
  colBy: '만든 사람',
  colState: '상태',
  colAction: '동작',
  filter: '보기',
  filterActive: '사용 가능',
  filterAll: '전체',
  create: '초대 코드 만들기',
  count: (n: number) => `${n}개`,
  uses: (used: number, max: number) => `${used} / ${max}`,
  onlyEmail: (email: string) => `${email} 만`,
  noSpaces: '없음',
  revoke: '취소',
  revokeLabel: (org: string) => `${org} 초대 코드 취소`,
  revokeTitle: '이 초대 코드를 취소할까요?',
  revokeBody: '아직 쓰지 않은 사람은 이 코드로 가입할 수 없어요. 이미 가입한 사람은 그대로예요.',
  revokeBtn: '코드 취소',
  empty: '초대 코드가 없어요',
  emptyActive: '사용 가능한 초대 코드가 없어요',
  emptyHow: '코드를 만들어 보내면, 받은 사람이 데스크톱 앱 › 초대 코드로 가입해요.',
  // 만들기
  createDesc: '받은 사람이 데스크톱 앱에서 이 코드로 가입해요. 코드는 만든 직후 한 번만 보여요.',
  orgField: ORG,
  roleField: `${ORG} 역할`,
  emailField: '이메일 (선택)',
  emailHint: '넣으면 이 이메일로만 가입할 수 있어요.',
  emailPlaceholder: 'name@example.com',
  spacesField: `바로 들어갈 공유 ${S} (선택)`,
  spacesNone: `이 ${ORG}에 공유 ${S}가 아직 없어요.`,
  usesField: '쓸 수 있는 횟수',
  usesHint: '1~100명. 한 사람에게 보내면 1.',
  daysField: '유효 기간',
  days: (n: number) => `${n}일`,
  createBtn: '코드 만들기',
  resultTitle: '초대 코드를 만들었어요',
  resultLabel: '초대 코드',
  resultSummary: (org: string, role: string, uses: number, left: string) => [org, role, `${uses}명까지`, left] as const, // 칸 나눔 = <Meta>
  done: { revoked: '초대 코드를 취소했어요' },
} as const;

export const INVITE_ERROR: Record<string, string> = {
  org_not_found: `그 ${ORG}이 없어요. 새로 고쳐 주세요`,
  space_not_found: `고른 ${S}가 이 ${ORG}의 공유 ${S}가 아니에요`,
  bad_email: '이메일 모양이 아니에요',
  invite_not_found: '그 초대 코드가 없어요. 새로 고쳐 주세요',
};
export const USES_INVALID = '1~100 사이 숫자로 써 주세요';
