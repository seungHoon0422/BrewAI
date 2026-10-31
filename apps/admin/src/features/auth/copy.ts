// 관리자 로그인 · 세션 문구. 오류 code → 한 줄 (conductor api_auth.py · Google 콜백 ?auth_error=<code>)
export const AUTH_COPY = {
  title: 'BrewAI 관리자',
  lead: '관리자 계정으로 로그인하세요.',
  form: '관리자 로그인',
  email: '이메일',
  emailPlaceholder: 'name@company.com',
  password: '비밀번호',
  submit: '로그인',
  submitting: '로그인하는 중',
  or: '또는',
  google: 'Google 계정으로 로그인',
  onlyAdmins: '관리자 권한이 있는 계정만 들어올 수 있어요. 사용자는 데스크톱 앱에서 로그인해요.',
  checking: '세션을 확인하는 중',
  bootstrap: '아직 첫 관리자가 없어요',
  bootstrapSub: '.env 의 BREWAI_ADMIN_EMAIL, BREWAI_ADMIN_PASSWORD 를 채우고 conductor 를 다시 켜 주세요 (node scripts/stack.mjs secrets).',
  firstLogin: '처음이면',
  firstLoginSub: '.env 의 BREWAI_ADMIN_EMAIL, BREWAI_ADMIN_PASSWORD 로 로그인해요.',
  // 테스트 관리자 (서버가 test_admin 을 줄 때만 · 이메일 칸에 admin)
  testAdmin: '테스트 계정',
  testAdminSub: '이메일 칸에 admin, 비밀번호 칸에 admin 을 넣어 로그인해요 (이 PC 에서만).',
  // 화면 머리 계정 메뉴
  account: '계정',
  signedInAs: (name: string) => `${name} (관리자)`,
  logout: '로그아웃',
  missing: '이메일과 비밀번호를 넣어 주세요',
} as const;

// 로그인 화면 위 안내 (왜 여기로 왔나)
export const NOTICE: Record<string, { tone: 'info' | 'warn' | 'danger'; text: string }> = {
  expired: { tone: 'info', text: '세션이 끝났어요. 다시 로그인해 주세요.' },
  forbidden: { tone: 'warn', text: '이 계정의 관리자 권한이 없어졌어요. 다른 관리자 계정으로 로그인해 주세요.' },
  signed_out: { tone: 'info', text: '로그아웃했어요.' },
  conductor: { tone: 'danger', text: 'conductor 에 연결할 수 없어요 — npm run api 로 켠 뒤 다시 시도해 주세요.' },
};

// 로그인 실패 (비밀번호 · Google 콜백 둘 다)
export const LOGIN_ERROR: Record<string, string> = {
  invalid_credentials: '이메일 또는 비밀번호가 맞지 않아요.',
  not_admin: '관리자 권한이 없는 계정이에요. 관리자 콘솔은 관리자만 쓸 수 있어요 — 데스크톱 앱에서 로그인해 주세요.',
  account_disabled: '비활성화된 계정이에요. 다른 관리자에게 문의해 주세요.',
  cancelled: 'Google 로그인을 취소했어요.',
  binding_mismatch: '로그인을 시작한 브라우저와 달라요. 이 창에서 다시 시도해 주세요.',
  google_failed: 'Google 과 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.',
  google_disabled: 'Google 로그인이 꺼져 있어요.',
  invalid_id_token: 'Google 응답을 확인하지 못했어요. 다시 시도해 주세요.',
  email_unverified: 'Google 계정 이메일이 인증되지 않았어요.',
  not_invited: '이 Google 계정과 연결된 BrewAI 계정이 없어요. 비밀번호로 로그인한 뒤 데스크톱 앱 설정에서 Google 을 연결해 주세요.',
  link_required: '이 이메일의 계정이 이미 있어요. 비밀번호로 로그인한 뒤 데스크톱 앱 설정에서 Google 을 연결해 주세요.',
  identity_in_use: '이 Google 계정은 다른 BrewAI 계정에 연결돼 있어요.',
  conductor: 'conductor 에 연결할 수 없어요 — npm run api',
  unknown: '로그인하지 못했어요. 잠시 뒤 다시 시도해 주세요.',
};
export const rateLimited = (s: number | undefined) =>
  s ? `시도가 너무 많아요. ${s < 60 ? `${s}초` : `${Math.ceil(s / 60)}분`} 뒤에 다시 시도해 주세요.` : '시도가 너무 많아요. 잠시 뒤 다시 시도해 주세요.';
