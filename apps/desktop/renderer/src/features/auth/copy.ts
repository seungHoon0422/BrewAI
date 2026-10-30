// 로그인 · 가입 · 재설정 문구 (한국어) 한곳. 서버 글은 띄우지 않는다 — 코드 → 문구 (errorText).
// 사용자 앱이라 '관리자' 라는 말은 쓰지 않는다 (e2e desktop.spec) → '담당자'.
import { KIND_LABEL } from '@brewai/ui';
import { DEFAULT_PASSWORD_MIN, type OrgRole } from './api';

export const AUTH = {
  brand: 'BrewAI',
  loginTitle: 'BrewAI에 로그인',
  loginSub: '이메일이 로그인 ID예요',
  email: '이메일',
  emailPlaceholder: 'name@company.com',
  password: '비밀번호',
  login: '로그인',
  or: '또는',
  google: 'Google로 계속',
  googleSignup: 'Google로 가입',
  googleWaiting: '브라우저에서 Google 로그인을 마쳐 주세요',
  googleWaitingSub: '마치면 BrewAI로 자동으로 돌아와요',
  cancel: '취소',
  haveInvite: '초대 코드가 있어요',
  forgot: '비밀번호를 잊었어요',
  back: '로그인으로',
  expired: '다시 로그인해 주세요. 쓰던 글은 그대로 있어요',
  checking: '로그인 상태를 확인하는 중',
  noBridge: 'BrewAI 데스크톱 앱에서 열어 주세요',
  noBridgeSub: '로그인은 데스크톱 앱만 할 수 있어요 (npm run desktop)',
  bootstrap: '아직 첫 계정이 없어요',
  bootstrapSub: '.env 의 BREWAI_ADMIN_EMAIL · BREWAI_ADMIN_PASSWORD 를 채우고 서버를 다시 시작해 주세요 (node scripts/stack.mjs secrets)',
  firstLogin: '처음이면',
  firstLoginSub: '.env 의 BREWAI_ADMIN_EMAIL · BREWAI_ADMIN_PASSWORD 로 로그인해요',
  // 테스트 계정 (서버가 test_admin 을 줄 때만 · 이메일 칸에 admin)
  testAccount: '테스트 계정',
  testAccountSub: '이메일 칸에 admin · 비밀번호 admin 으로 로그인해요 (이 PC 에서만)',
  // 서버 상태 줄
  server: (host: string) => `서버 ${host}`,
  serverOk: '연결됨',
  serverDown: '연결 안 됨',
  serverChecking: '확인 중',
  retry: '다시 시도',
} as const;

export const INVITE = {
  title: '초대 코드로 가입',
  sub: `받은 코드를 넣으면 어느 ${KIND_LABEL.org}에 들어가는지 먼저 보여 드려요`,
  code: '초대 코드',
  codePlaceholder: 'BREW-XXXX-XXXX',
  check: '확인',
  orgRole: { owner: '소유자', admin: '운영 담당', member: '멤버' } satisfies Record<OrgRole, string>,
  invitedBy: (name: string) => `${name} 님이 초대했어요`,
  joinAs: (role: string) => `${role}로 들어가요`,
  spaces: `함께 들어가는 ${KIND_LABEL.space}`,
  emailOnly: (hint: string) => `${hint} 로만 가입할 수 있어요`,
  expires: (when: string) => `${when}까지`,
  other: '다른 코드',
  nickname: '닉네임',
  nicknameHint: '다른 사람에게 보이는 이름이에요 · 나중에 바꿀 수 있어요',
  nicknamePlaceholder: '비워 두면 이메일 @ 앞부분',
  passwordHint: (min: number) => `${min}자 이상 · 조합 규칙 없음 · 긴 문장도 좋아요`,
  submit: '가입하기',
} as const;

export const RESET = {
  title: '비밀번호 재설정',
  sub: '메일 서버가 없어서 BrewAI 담당자에게 재설정 코드를 받아야 해요',
  code: '재설정 코드',
  codePlaceholder: 'bwp_…',
  password: '새 비밀번호',
  submit: '비밀번호 바꾸기',
  done: '비밀번호를 바꿨어요. 새 비밀번호로 로그인해 주세요',
} as const;

// 코드 → 문구. min = 비밀번호 최소 길이 (서버 password_min) · wait = 다시 시도까지 초
const ERRORS: Record<string, string | ((p: { min: number; wait: number | null }) => string)> = {
  invalid_credentials: '이메일 또는 비밀번호가 맞지 않아요',
  rate_limited: ({ wait }) => (wait ? `잠시 후 다시 시도해 주세요 · ${wait}초` : '잠시 후 다시 시도해 주세요'),
  offline: '서버에 연결할 수 없어요',
  server: '잠시 후 다시 시도해 주세요',
  auth_required: '다시 로그인해 주세요',
  invite_invalid: '쓸 수 없는 초대 코드예요. 만료됐거나 이미 다 쓰였을 수 있어요',
  invite_email_mismatch: '이 초대는 다른 이메일로만 가입할 수 있어요',
  email_taken: '이미 가입한 이메일이에요. 로그인해 주세요',
  password_too_short: ({ min }) => `비밀번호는 ${min}자 이상이어야 해요`,
  password_too_long: '비밀번호가 너무 길어요 (128자까지)',
  bad_email: '이메일 모양이 아니에요',
  bad_display_name: '닉네임은 1~40자로 적어 주세요',
  reset_invalid: '쓸 수 없는 재설정 코드예요. 만료됐을 수 있어요 (30분)',
  // Google (main · 콜백)
  timeout: 'Google 로그인을 5분 안에 마치지 못했어요',
  cancelled: 'Google 로그인을 취소했어요',
  browser_failed: '브라우저를 열지 못했어요',
  loopback_failed: '로그인 응답을 받을 준비를 하지 못했어요',
  google_disabled: '이 서버는 Google 로그인을 쓰지 않아요',
  google_failed: 'Google 과 연결하지 못했어요. 잠시 후 다시 시도해 주세요',
  binding_mismatch: '로그인을 시작한 브라우저와 달라요. 다시 시도해 주세요',
  invalid_id_token: 'Google 응답을 확인하지 못했어요',
  email_unverified: 'Google 에서 이메일 확인을 마친 계정만 쓸 수 있어요',
  not_invited: '이 Google 계정은 아직 초대받지 않았어요',
  link_required: '같은 이메일 계정이 있어요. 비밀번호로 로그인한 뒤 설정 › 계정에서 Google 을 연결해 주세요',
  account_disabled: '쓸 수 없게 된 계정이에요',
  identity_in_use: '이 Google 계정은 다른 사람에게 연결돼 있어요',
  already_linked: '이미 다른 Google 계정이 연결돼 있어요',
  link_expired: '연결 시간이 지났어요. 다시 시도해 주세요',
  bad_request: '잘못된 요청이에요. 다시 시도해 주세요',
  invalid_grant: '로그인을 마치지 못했어요. 다시 시도해 주세요',
  not_admin: '이 계정으로는 열 수 없어요',
};

export function errorText(code: string | undefined, p: { min?: number; wait?: number | null } = {}): string {
  const e = code && Object.prototype.hasOwnProperty.call(ERRORS, code) ? ERRORS[code] : ERRORS.server;
  return typeof e === 'function' ? e({ min: p.min ?? DEFAULT_PASSWORD_MIN, wait: p.wait ?? null }) : e;
}

// 만료 시각 → '11월 6일'
export const dateText = (iso: string) => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
};
