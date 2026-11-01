// 카탈로그 화면 문구. 탭 · 표 이름 · 머리글 · 카드 제목은 E2E 가 읽는다 (e2e/admin.spec.ts '카탈로그 › Skill' · e2e/admin-mcp.spec.ts)
// UI 문구에 가운뎃점을 쓰지 않는다 (칸 나눔 = <Meta> 여백 · 또는 쉼표)
import type { McpAuth, McpStatus, ToolMode } from './api';

export type CatalogTab = 'mcp' | 'user-servers' | 'skill';
export const TABS: { id: CatalogTab; label: string }[] = [
  { id: 'mcp', label: 'MCP 서버' },
  { id: 'user-servers', label: '사용자 추가 서버' },
  { id: 'skill', label: 'Skill' },
];
export const MCP_COLS = ['이름', '도메인', '로그인 방식', '도구 수', '예상 토큰', '연결한 사람 수', '상태', '연결 테스트'];
export const USER_COLS = ['이름', '주인', '도메인', '로그인 방식', '도구 수', '공유', '연결한 사람 수', '사용'];
export const TOOL_COLS = ['도구', '설명', '예상 토큰', '숨김', '바로 실행', '항상 같이 열기'];
export const SKILL_COLS = ['이름', '설명', '쓰는 도구', '출처', '버전 (sha256)', '사용'];

export const AUTH_TEXT: Record<McpAuth, string> = { oauth: 'OAuth', none: '로그인 없음' };
export const STATUS_TEXT: Record<McpStatus, string> = { active: '사용 중', disabled: '꺼짐', error: '오류' };
export const MODE_TEXT: Record<ToolMode, string> = { hidden: '숨김', auto: '바로 실행', approval: '승인 필요' };
export const ORIGIN_TEXT = { admin: '전체 공통', user: '사용자 추가' } as const;
export const CLIENT_SOURCE = { preregistered: '사전 등록', dcr: '자동 등록 (DCR)' } as const;
export const AUTH_METHODS = [
  { value: 'none', label: '공개 client (secret 없음)' },
  { value: 'client_secret_post', label: 'client_secret_post' },
  { value: 'client_secret_basic', label: 'client_secret_basic' },
] as const;

const tokens = (n: number) => `약 ${n.toLocaleString('ko-KR')}`;

export const CATALOG_COPY = {
  rule: '설치는 허용 목록, 버전/해시 고정, 사람 승인을 모두 거쳐요.',
  tabs: '카탈로그 종류',
  conductorDown: 'conductor 에 연결할 수 없어요 — npm run api',
  loadFailed: 'Skill 목록을 읽지 못했어요',
  retry: '다시 시도',
  // Skill
  skillTable: 'Skill 목록',
  skillEmpty: '스킬 없음',
  skillHow: (source: string) => [`${source}/<이름>/SKILL.md`, ' 를 넣고 conductor 를 다시 켜요'] as const,
  builtin: '내장',
  versionTitle: (lines: number) => `SKILL.md sha256 앞 12자, ${lines}줄`,
  unreadable: (n: number, list: string) => `읽지 못한 스킬 ${n}개 — ${list}`,
  foot: (source: string) => ['읽기 전용이에요. 출처는 ', source, ' (레포에 든 제품 스킬, 개발 루틴 ', '.claude/skills', ' 와 별개)이고 바꾸면 버전이 바뀌어요. 새 스킬 저장과 등록(격리 → 테스트 → 승인)은 P5.'] as const,
} as const;

export const MCP_COPY = {
  table: 'MCP 서버 목록',
  intro: '여기서 추가한 서버는 모든 사용자에게 보여요. 로그인은 사람마다 자기 계정으로 해요.',
  count: (n: number) => `${n}개`,
  add: 'MCP 서버 추가',
  empty: '등록된 MCP 서버 없음',
  emptyHow: '주소만 넣으면 로그인 방식과 도구를 찾아요.',
  loadFailed: 'MCP 서버 목록을 읽지 못했어요',
  tokensTitle: '도구 정의를 모두 보내면 드는 토큰이에요. 대화에는 앱 목록 한 줄만 싣고, 도구는 쓸 때 4개만 꺼내요.',
  afterLogin: '로그인 뒤',
  afterLoginTitle: '누군가 로그인해 도구 목록을 받으면 보여요',
  afterLoginNote: '로그인이 필요한 서버의 도구 수와 예상 토큰은 누군가 데스크톱에서 연결한 뒤에 보여요.',
  tokens,
  people: (n: number) => `${n}명`,
  // 연결 테스트 (표 = '테스트' · 자세히 머리 = '연결 테스트')
  probe: '연결 테스트',
  probeShort: '테스트',
  probeLabel: (name: string) => `${name} 연결 테스트`,
  testing: '확인 중',
  testOk: '정상',
  testTools: (n: number) => `도구 ${n}개`,
  testNeedsLogin: '응답 정상, 도구는 로그인 뒤',
  testNeedsLoginTitle: '서버는 살아 있어요. 관리자 본인이 데스크톱에서 이 앱을 연결하면 도구 수까지 확인해요.',
  testFailed: '연결 실패',
  testError: '테스트하지 못했어요',
  ms: (n: number) => `${n}ms`,
  lastChecked: (when: string) => `마지막 확인 ${when}`,
  never: '아직 확인 안 함',
  writeBadge: '쓰기',
  writeTitle: '이 도구는 무언가를 만들거나 바꿔요. 지금은 바로 실행돼요 (승인 카드는 slice 07).',
  writeCount: (n: number) => `쓰기 ${n}개`,
} as const;

export const ADD_COPY = {
  title: 'MCP 서버 추가',
  desc: '주소를 넣으면 conductor 가 로그인 방식과 도구 목록을 찾아요. 추가한 서버는 모든 사용자에게 보여요.',
  url: '주소',
  urlHint: 'https 주소만. 사설망과 내부 주소는 막혀요.',
  urlPlaceholder: 'https://mcp.linear.app/mcp',
  name: '이름',
  nameHint: '비우면 서버가 알려 준 이름을 써요.',
  description: '에이전트가 읽는 한 줄 설명',
  descriptionHint: (n: number) => `무엇을 하는 앱인지 짧게. ${n}/80자`,
  aliases: '찾을 때 쓸 말',
  aliasesHint: '쉼표로 나눠요. 예: 리니어, 이슈, 일감',
  handle: '부르는 이름',
  handleHint: '에이전트가 이 이름으로 앱을 불러요. 영문 소문자, 숫자, _ 로 2~20자. 비우면 이름에서 만들어요.',
  client: '사전 등록 OAuth client 가 있어요',
  clientHint: 'GitHub 처럼 자동 등록(DCR)이 안 되는 제공자만. 비밀값은 conductor 금고에만 저장돼요.',
  clientId: 'client ID',
  clientSecret: 'client secret',
  clientSecretHint: '공개 client 면 비워요.',
  clientMethod: '인증 방식',
  submit: '찾아서 추가',
  finding: '찾는 중',
  // 결과
  doneTitle: '추가했어요',
  doneDesc: (name: string) => `${name}을(를) 모든 사용자 목록에 넣었어요.`,
  found: '찾은 내용',
  authLine: (auth: string, issuer: string | null) => (issuer ? `${auth} (${issuer})` : auth),
  toolsLine: (n: number | null, w: number | null) => (n === null ? '로그인 뒤에 보여요' : w ? `${n}개, 쓰기 ${w}개` : `${n}개`),
  tokensLine: (n: number | null) => (n === null ? '로그인 뒤에 보여요' : `약 ${n.toLocaleString('ko-KR')}토큰`),
  lineLabel: '에이전트가 보는 줄',
  kv: { auth: '로그인 방식', tools: '도구', tokens: '예상 토큰', handle: '부르는 이름' },
  clientSaved: 'OAuth client 도 저장했어요',
  clientSkipped: '로그인이 없는 서버라 OAuth client 는 저장하지 않았어요',
  clientFailed: (why: string) => `서버는 추가했지만 OAuth client 를 저장하지 못했어요. ${why}`,
  open: '자세히 보기',
  close: '닫기',
} as const;

// 추천 서버 (추가 대화상자 위) — 벤더가 직접 운영하는 원격 MCP. 누르면 아래 칸을 채우고, 추가는 관리자가 누른다
export const PRESET_COPY = {
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
  picked: (name: string) => `${name}을(를) 골랐어요. 칸을 확인하고 추가를 눌러요.`,
  docs: '문서 보기',
} as const;

export const PAGE_COPY = {
  loading: '불러오는 중',
  notFound: '없는 MCP 서버',
  notFoundWhy: '이 서버를 찾을 수 없어요',
  notFoundHow: '지워졌거나 주소가 바뀌었어요. 목록에서 다시 골라 주세요.',
  toList: 'MCP 서버 목록으로',
  enabled: '사용',
  enabledTitle: '끄면 아무도 이 앱을 쓸 수 없어요 (목록에서도 빠져요)',
  remove: '삭제',
  removeTitle: (name: string) => `${name}을(를) 삭제할까요?`,
  removeBody: '모든 사용자 목록에서 빠지고 도구 설정도 지워져요. 사람들의 로그인 정보는 같은 주소를 쓰는 다른 항목을 위해 남아요.',
  removeConfirm: '삭제',
  // 카드 = section (이름 = 카드 제목 · E2E 가 이름으로 찾는다)
  partLine: '에이전트가 보는 목록',
  lineHint: '대화마다 지침 뒤에 한 줄씩 실려요. 도구 정의는 에이전트가 이 앱을 쓸 때 4개만 꺼내요.',
  lineTokens: (n: number) => `약 ${n}토큰`,
  lineEvery: '대화마다',
  allTools: '도구 정의 전체',
  allToolsHint: '다 보내면 드는 양이에요 (보내지 않아요)',
  partTools: '도구',
  toolsHint: '숨긴 도구는 에이전트가 꺼낼 수 없어요. 항상 같이 열기는 이 앱을 쓸 때 늘 함께 꺼내요.',
  toolsFetched: (when: string) => `${when} 받은 목록`,
  toolsEmpty: '아직 도구 목록이 없어요',
  toolsEmptyHow: '로그인이 필요한 서버는 누군가 데스크톱에서 연결하면 도구 목록을 받아요. 관리자 본인이 연결한 뒤 연결 테스트를 누르면 바로 보여요.',
  approvalNote: '바로 실행을 끄면 승인 필요로 저장돼요. 승인 카드(slice 07)가 생기기 전까지는 바로 실행돼요.',
  approvalBadge: '승인 필요 (07부터)',
  hideLabel: (tool: string) => `${tool} 숨김`,
  autoLabel: (tool: string) => `${tool} 바로 실행`,
  revealLabel: (tool: string) => `${tool} 항상 같이 열기`,
  partInfo: '정보',
  infoHint: '에이전트가 앱을 고를 때 읽는 글이에요. 서버 설명은 데이터로만 다뤄요.',
  userInfoHint: '사용자가 추가한 서버라 정의는 주인만 바꿔요. 여기서는 끄기만 해요.',
  save: '저장',
  saved: '저장했어요',
  field: {
    name: '이름',
    description: '에이전트가 읽는 한 줄 설명',
    descriptionHint: (n: number) => `${n}/80자`,
    plainDescription: '설명',
    aliases: '찾을 때 쓸 말',
    aliasesHint: '쉼표로 나눠요',
    handle: '부르는 이름',
    handleHint: '영문 소문자, 숫자, _ 로 2~20자',
    clientId: 'client ID',
    clientSecret: 'client secret',
  },
  toolTable: '도구 목록',
  urlLabel: '주소',
  urlFixed: '주소는 바꿀 수 없어요. 다른 주소면 새로 추가해요.',
  owner: '주인',
  shares: '공유',
  sharesText: (n: number) => (n ? `${n}곳에 공유` : '공유 안 함'),
  partConn: '연결',
  connHint: '인증정보는 사람마다 따로예요. 여기에는 개수만 보여요.',
  kv: {
    auth: '로그인 방식',
    issuer: '로그인 서버',
    people: '연결한 사람',
    checked: '마지막 확인',
    error: '마지막 오류',
    tools: '도구 수',
  },
  none: '없음',
  partClient: '사전 등록 OAuth client',
  clientHint: '자동 등록(DCR)이 안 되는 제공자만 넣어요. 비밀값은 conductor 금고에만 있고 다시 보이지 않아요.',
  clientNow: '지금',
  clientNone: '아직 없어요. 첫 로그인 때 자동 등록(DCR)을 시도해요.',
  clientSecretSaved: '비밀값 저장됨',
  clientSecretNone: '비밀값 없음',
  clientMethod: '인증 방식',
  clientScope: 'scope',
  clientScopeHint: '비우면 서버가 알려 준 scope 를 써요.',
  clientSecretKeep: '비우면 비밀값 없이 저장돼요.',
  clientSave: 'client 저장',
  clientSavedToast: 'OAuth client 를 저장했어요',
  done: {
    enabled: (name: string) => `${name}을(를) 켰어요`,
    disabled: (name: string) => `${name}을(를) 껐어요`,
    removed: (name: string) => `${name}을(를) 삭제했어요`,
    added: (name: string) => `${name}을(를) 추가했어요`,
    tool: (tool: string, what: string) => `${tool}: ${what}`,
    revealOn: '항상 같이 열기',
    revealOff: '필요할 때만 열기',
  },
} as const;

export const USER_COPY = {
  table: '사용자 추가 서버 목록',
  intro: '사용자가 데스크톱에서 추가한 서버예요. 정의는 주인 것이라 여기서는 보기와 끄기만 해요. 인증정보는 개수만 보여요.',
  count: (n: number) => `${n}개`,
  empty: '사용자가 추가한 서버 없음',
  emptyHow: '사용자가 데스크톱 설정의 연결된 앱에서 앱 추가를 누르면 여기에 보여요.',
  ownerUnknown: '알 수 없음',
  shareCount: (n: number) => `${n}곳`,
  switchLabel: (name: string) => `${name} 사용`,
  partPolicy: '사용자 추가 정책',
  allow: '사용자가 MCP 서버를 추가할 수 있어요',
  allowHint: '끄면 새로 추가만 막아요. 이미 추가한 서버는 그대로예요 (하나씩 끄려면 아래 표에서).',
  allowOn: '사용자 추가를 허용했어요',
  allowOff: '사용자 추가를 막았어요',
  allowlist: '주소 허용 목록',
  allowlistHint: '쉼표나 줄바꿈으로 나눠요. 비우면 모든 공개 https 주소. 예: linear.app, *.example.com',
  allowlistSave: '허용 목록 저장',
  allowlistSaved: '주소 허용 목록을 저장했어요',
} as const;

// 바꾸기 실패 → 한 줄 (conductor detail code). oauth_ · mcp_ 로 시작하는 나머지는 errorOf 가 묶는다
export const MCP_ERROR: Record<string, string> = {
  bad_url: '주소 형식이 맞지 않아요',
  url_not_https: 'https 주소만 쓸 수 있어요',
  url_blocked: '사설망이나 내부 주소는 쓸 수 없어요',
  url_not_allowed: '주소 허용 목록에 없는 주소예요',
  mcp_unreachable: 'MCP 서버에 연결할 수 없어요',
  mcp_timeout: 'MCP 서버가 제때 답하지 않았어요',
  mcp_protocol: 'MCP 서버 응답 형식이 맞지 않아요',
  mcp_server_error: 'MCP 서버가 오류를 냈어요',
  mcp_forbidden: 'MCP 서버가 접근을 막았어요',
  server_exists: '이미 추가한 주소예요',
  handle_taken: '이 부르는 이름은 이미 쓰고 있어요',
  bad_handle: '부르는 이름은 영문 소문자, 숫자, _ 로 2~20자예요',
  bad_name: '이름을 입력해 주세요',
  bad_status: '상태 값이 맞지 않아요',
  user_server: '사용자가 추가한 서버는 끄기만 할 수 있어요',
  mcp_server_not_found: '이 서버는 이미 지워졌어요',
  vault_missing: '금고 키(CONDUCTOR_SECRET_KEY)가 없어 비밀값을 저장할 수 없어요',
  bad_url_allowlist: '허용 목록 형식이 맞지 않아요. 예: linear.app, *.example.com',
  bad_request: '요청 값이 맞지 않아요',
  rate_limited: '요청이 너무 많아요. 잠시 뒤 다시 시도해 주세요',
  needs_login: '응답 정상, 도구는 로그인 뒤',
  expired: '로그인이 만료됐어요',
  insufficient_scope: '권한(scope)이 모자라요',
};
export const OAUTH_ERROR = (code: string) => `로그인 서버 정보를 찾지 못했어요 (${code})`;
export const MCP_OTHER = (code: string) => `MCP 서버와 대화하지 못했어요 (${code})`;
