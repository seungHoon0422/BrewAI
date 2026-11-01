// 연결된 앱 문구 (한국어). 사용자 앱이라 '관리자' 라는 말은 쓰지 않는다 (e2e desktop.spec) — 관리자가 넣은 앱 = '전체 공통'.
// 가운뎃점 같은 구분 글자 대신 칸 나눔 · 쉼표 (e2e/copy-rule.ts).
import type { Note } from '../shell/components/Page';
import type { AppSource } from './api';

export const CONNECTIONS = {
  sub: '에이전트가 일할 때 쓰는 내 앱 연결이에요.',
  autoAuth: '필요할 때 바로 로그인 화면 열기',
  autoAuthSub: '켜 두면 대화 중에 연결이 필요할 때 묻지 않고 시스템 브라우저로 로그인 화면을 열어요. 꺼 두면 여기서 직접 연결해요. 처음에는 꺼져 있어요.',
  autoAuthFailed: '설정을 바꾸지 못했어요',
  mine: '내 앱',
  list: '내 앱 목록',
  add: '앱 추가',
  addDisabled: '지금은 앱을 직접 추가할 수 없어요',
  importable: '가져올 수 있는 앱',
  importableSub: '내 스페이스나 조직에 공유된 앱이에요. 가져온 뒤 내 계정으로 로그인해요.',
  importableList: '가져올 수 있는 앱 목록',
  importableEmpty: '지금은 가져올 앱이 없어요',
  added: (name: string) => `${name} 앱을 추가했어요`,
  connected: (name: string) => `${name} 앱을 연결했어요`,
  loading: '불러오는 중…',
  loadFailed: '앱 목록을 불러오지 못했어요',
  retry: '다시',
  empty: '아직 연결된 앱이 없어요',
  emptyText: '앱 추가에 MCP 서버 주소를 넣으면 에이전트가 그 앱의 도구를 쓸 수 있어요.',
  hiddenTitle: '숨긴 앱',
  connect: '연결',
  connectLabel: (name: string) => `${name} 연결`,
  reconnect: '다시 연결',
  disconnect: '연결 끊기',
  connecting: '브라우저에서 로그인 중',
  stop: '그만두기',
  hide: '숨기기',
  unhide: '다시 보이기',
  remove: '목록에서 빼기',
  delete: '앱 지우기',
  import: '가져오기',
  importLabel: (name: string) => `${name} 가져오기`,
  imported: (name: string) => `${name} 앱을 가져왔어요`,
  sharedBy: (name: string) => `${name} 님이 공유함`,
  loginAt: (domain: string) => `로그인 ${domain}`,
  details: (name: string) => `${name} 자세히`,
  toolCount: (n: number) => `도구 ${n}개`,
  vaultMissing: '서버에 로그인 정보를 보관할 곳이 없어 OAuth 앱은 지금 연결할 수 없어요.',
  noBridge: '로그인 화면은 데스크톱 앱에서 열 수 있어요.',
} as const;

export const SOURCE_LABEL: Record<AppSource, string> = { install: '전체 공통', own: '내가 추가', imported: '가져옴' };

// 줄 상태 (색 = 상태만)
export type AppStateKey = 'connected' | 'needs_login' | 'expired' | 'share_lost' | 'disabled' | 'error';
export const STATE_LABEL: Record<AppStateKey, string> = {
  connected: '연결됨',
  needs_login: '연결 필요',
  expired: '다시 로그인 필요',
  share_lost: '공유가 끊겼어요',
  disabled: '꺼짐',
  error: '오류',
};

export const CONNECTION_NOTES: readonly Note[] = [
  ['로그인은 각 서비스 공식 화면에서 해요. 비밀번호와 토큰은 이 앱에 남지 않아요.'],
  ['같은 앱 주소면 한 번 로그인으로 모든 대화에서 써요.'],
  ['', '쓰기', ' 표시가 있는 도구는 앱의 데이터를 바꿔요.'],
  ['공유받은 앱은 가져온 뒤 내 계정으로 로그인해요. 공유한 사람의 계정은 쓰지 않아요.'],
];

// [앱 추가] 대화상자
export const ADD = {
  title: '앱 추가',
  sub: 'MCP 서버 주소를 넣으면 로그인 방식과 도구를 먼저 확인해요.',
  url: '주소',
  urlPlaceholder: 'https://mcp.example.com/mcp',
  urlHint: 'https로 시작하는 MCP 서버 주소',
  name: '이름',
  namePlaceholder: '비워 두면 서버가 알려 준 이름',
  description: '에이전트가 읽는 한 줄 설명',
  descriptionPlaceholder: '예: 우리 팀 이슈와 프로젝트',
  descriptionHint: '에이전트가 이 앱을 언제 쓸지 고를 때 봐요',
  aliases: '찾을 때 쓸 말',
  aliasesPlaceholder: '예: 이슈, 버그, 리니어',
  aliasesHint: '쉼표로 나눠요',
  share: '공유',
  shareNone: '안 함',
  shareSpace: '스페이스',
  shareOrg: '조직',
  shareTarget: '공유할 곳',
  shareTargetPlaceholder: '고르기',
  shareHint: '멤버가 가져와 자기 계정으로 로그인해요. 로그인 정보는 나누지 않아요.',
  noTargets: '공유할 수 있는 곳이 없어요',
  check: '미리 확인',
  checking: '확인하는 중',
  add: '추가',
  cancel: '취소',
  previewTitle: '미리 확인',
  agentLine: '에이전트가 보는 줄',
  added: (name: string) => `${name} 앱을 추가했어요`,
  count: (n: number, max: number) => `${n}/${max}`,
} as const;

// 추천 서버 (앱 추가 대화상자 위) — 서비스 회사가 직접 운영하는 MCP. 누르면 칸만 채우고, 미리 확인 뒤 추가는 사람이 누른다
export const PRESET = {
  title: '추천 서버',
  hint: '서비스 회사가 직접 운영하는 MCP 서버예요. 누르면 아래 칸을 채워요.',
  list: '추천 서버 목록',
  search: '추천 서버 찾기',
  searchPlaceholder: '이름이나 하는 일로 찾기',
  filter: '분류',
  all: '전체',
  category: { dev: '개발', docs: '문서', data: '데이터', work: '업무', pay: '결제', design: '디자인' },
  auth: { none: '로그인 없음', oauth: '로그인 필요', api_key: 'API 키 필요' },
  added: '추가됨',
  unavailable: '지금은 못 써요',
  loading: '추천 서버를 불러오는 중',
  failed: '추천 서버를 불러오지 못했어요. 주소를 직접 넣어도 돼요.',
  empty: '맞는 추천 서버가 없어요',
  picked: (name: string) => `${name}을(를) 골랐어요. 미리 확인한 뒤 추가를 눌러요.`,
} as const;

// 미리 확인 한 줄: '로그인 방식 OAuth (linear.app), 도구 18개, 예상 토큰 약 600'
export function previewParts(p: { auth: 'oauth' | 'none'; issuer_domain: string | null; domain: string; tool_count: number | null; write_count: number | null; tokens_est: number | null }): string[] {
  return [
    p.auth === 'oauth' ? `로그인 방식 OAuth (${p.issuer_domain ?? p.domain})` : '로그인 없음',
    p.tool_count == null ? '도구 수는 로그인 뒤에 알 수 있어요' : `도구 ${p.tool_count}개`,
    p.write_count ? `쓰기 ${p.write_count}개` : '',
    p.tokens_est == null ? '' : `예상 토큰 약 ${p.tokens_est.toLocaleString('ko-KR')}`,
  ].filter(Boolean);
}

// 앱 상세 서랍
export const DETAIL = {
  loading: '불러오는 중…',
  failed: '앱을 불러오지 못했어요',
  address: '주소',
  login: '로그인',
  loginOauth: (domain: string) => `OAuth (${domain})`,
  loginNone: '로그인 없음',
  source: '출처',
  state: '상태',
  agentLine: '에이전트가 보는 줄',
  tokens: (n: number) => `약 ${n.toLocaleString('ko-KR')}토큰`,
  tools: '도구',
  toolsEmptyOauth: '연결하면 도구 목록을 받아 와요',
  toolsEmpty: '아직 받은 도구가 없어요',
  write: '쓰기',
  writeTitle: '앱의 데이터를 바꾸는 도구예요',
  writeNote: '쓰기 도구는 지금 바로 실행돼요. 에이전트는 내가 원한 일일 때만 불러요.',
  test: '연결 확인',
  testOk: (n: number | null) => (n == null ? '잘 연결돼요' : `잘 연결돼요. 도구 ${n}개`),
  shares: '공유',
  sharesSub: '스페이스 멤버나 조직 사람이 가져와 자기 계정으로 로그인해요. 로그인 정보는 나누지 않아요.',
  sharesEmpty: '아직 공유하지 않았어요',
  shareAdd: '공유하기',
  shareTarget: '공유할 곳',
  shareTargetPlaceholder: '스페이스나 조직 고르기',
  noTargets: '공유할 수 있는 곳이 없어요',
  shareRemove: '공유 끊기',
  shareRemoveLabel: (where: string) => `${where} 공유 끊기`,
  shareOrgNote: '조직 공유는 조직 소유자와 관리 담당만 할 수 있어요',
  shared: '공유했어요',
  unshared: '공유를 끊었어요',
  shareLost: '공유가 끊겨 지금은 쓸 수 없어요. 목록에서 빼도 돼요.',
  blocked: '지금 정책으로는 직접 추가한 이 앱을 쓸 수 없어요. 대화에서 빠져요.',
  deleteTitle: '앱을 지울까요?',
  deleteBody: '이 앱과 공유가 모두 사라져요. 가져간 사람들도 더 쓸 수 없어요.',
  close: '닫기',
  saved: '바꿨어요',
} as const;

// 서버 code → 문구 (연결 · 추가 · 공유 · 가져오기 공통). 모르는 code = 기본 문구
const ERRORS: Record<string, string> = {
  bad_url: '주소 모양이 맞지 않아요',
  url_not_https: 'https 주소만 쓸 수 있어요',
  url_blocked: '이 주소에는 연결할 수 없어요',
  user_servers_disabled: '지금은 앱을 직접 추가할 수 없어요',
  url_not_allowed: '허용된 주소가 아니에요',
  url_has_secret: '주소에 키나 토큰이 들어 있어요. 비밀값을 뺀 주소를 넣어 주세요',
  issuer_foreign: '로그인 주소가 앱 주소와 다른 곳이라 직접 추가할 수 없어요',
  oauth_issuer_foreign: '로그인 주소가 앱 주소와 다른 곳이라 연결할 수 없어요',
  oauth_server_changed: '앱의 로그인 설정이 바뀌었어요. 앱을 추가한 사람이 다시 확인해야 해요',
  oauth_client_admin_only: '이 로그인 방식은 전체 공통 앱에서만 쓸 수 있어요',
  mcp_unreachable: 'MCP 서버에 연결하지 못했어요',
  mcp_timeout: 'MCP 서버가 제때 응답하지 않았어요',
  mcp_protocol: 'MCP 서버가 아닌 것 같아요',
  mcp_server_error: 'MCP 서버가 오류를 냈어요',
  server_exists: '이미 추가한 주소예요',
  already_imported: '이미 가져온 앱이에요',
  needs_import: '먼저 가져와야 해요',
  server_hidden: '숨긴 앱이에요. 다시 보이게 한 뒤 연결해 주세요',
  server_disabled: '지금은 꺼진 앱이에요',
  bad_handle: '이름표 모양이 맞지 않아요',
  handle_taken: '같은 이름표를 쓰는 앱이 있어요',
  org_not_found: '공유할 조직을 찾지 못했어요',
  space_not_found: '공유할 스페이스를 찾지 못했어요',
  share_not_found: '이미 끊긴 공유예요',
  bad_scope: '공유할 곳이 맞지 않아요',
  forbidden: '이 앱에서는 할 수 없는 일이에요',
  not_found: '앱을 찾지 못했어요',
  rate_limited: '잠시 뒤 다시 해 주세요',
  vault_missing: '서버에 로그인 정보를 보관할 곳이 없어 연결할 수 없어요',
  not_connected: '이미 연결이 끊겨 있어요',
  cancelled: '로그인을 그만뒀어요',
  timeout: '로그인 시간이 지났어요. 다시 해 주세요',
  browser_failed: '브라우저를 열지 못했어요',
  loopback_failed: '로그인 결과를 받을 준비를 하지 못했어요',
  wrong_user: '다른 사람의 로그인이라 연결하지 않았어요',
  no_bridge: '로그인 화면은 데스크톱 앱에서 열 수 있어요',
  offline: '서버에 연결할 수 없어요',
  needs_login: '먼저 연결해 주세요',
  expired: '다시 로그인해 주세요',
  insufficient_scope: '권한을 더 받아야 해요. 다시 연결해 주세요',
};

export function connError(code: string | null | undefined): string {
  if (!code) return '하지 못했어요';
  if (Object.prototype.hasOwnProperty.call(ERRORS, code)) return ERRORS[code];
  if (code.startsWith('oauth_')) return '앱의 로그인 설정을 읽지 못했어요';
  if (code.startsWith('mcp_')) return 'MCP 서버와 주고받지 못했어요';
  if (/^(iss_|state_|handoff_|ds_|verifier_|token_|invalid_grant|provider_error|no_client)/.test(code)) return '로그인을 마치지 못했어요. 다시 해 주세요';
  return '하지 못했어요';
}
