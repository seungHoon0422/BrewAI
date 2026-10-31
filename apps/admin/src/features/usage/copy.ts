// 사용량 문구 (메뉴 '사용량' · 개요 그래프 · 사용자/조직/스페이스 서랍의 사용량 칸). 층 이름은 KIND_LABEL 로만
import { formatCompact, formatNumber } from '@brewai/ui';
import type { LoadError } from '../../shared/http';
import { KIND_LABEL } from '../scope/copy';
import type { GatewayStatusKind, TokenKind, UsageGroup, UsageSort } from './api';

const ORG = KIND_LABEL.org;
const SPACE = KIND_LABEL.space;

export const PERIODS = [7, 30, 90] as const;
export type Period = (typeof PERIODS)[number];
export const OVERVIEW_PERIODS = [7, 30] as const;
export const periodLabel = (d: number) => `${d}일`;

export type BreakdownGroup = Exclude<UsageGroup, 'day'>;
export const GROUP_LABEL: Record<BreakdownGroup, string> = { org: ORG, space: SPACE, user: '사용자', model: '모델' };
export const GROUP_ORDER: readonly BreakdownGroup[] = ['org', 'space', 'user', 'model'];

// 기준 = 막대 · 흐름 · 표 순서를 무엇으로 (주소 ?metric=calls|tokens|cost · 기본 calls)
export const METRICS = ['calls', 'tokens', 'cost'] as const;
export type Metric = (typeof METRICS)[number];
export const METRIC_LABEL: Record<Metric, string> = { calls: '호출', tokens: '토큰', cost: '비용' };
export const METRIC_SORT: Record<Metric, UsageSort> = { calls: 'runs', tokens: 'tokens', cost: 'cost' };

// 토큰 종류 (겹치지 않게 나눈 묶음 · 서버 usage.py KINDS 와 같은 순서).
// 이름이 숫자 카드의 '입력'(캐시 포함) · '출력'(생각 포함)과 같으면 같은 화면에서 두 값이 한 이름으로 읽힌다 → 부분임을 이름에 적는다
export const TOKEN_KIND_LABEL: Record<TokenKind, string> = {
  input: '캐시 아닌 입력', output: '생각 뺀 출력', reasoning: '생각', cache_read: '캐시 읽기', cache_write: '캐시 쓰기',
};
export const TOKEN_KIND_HINT: Record<TokenKind, string> = {
  input: '캐시에서 읽거나 캐시에 쓰지 않은 입력',
  output: '생각을 뺀 답',
  reasoning: '생각(추론) 토큰, 출력 가격',
  cache_read: '캐시에서 읽은 입력, 보통 입력보다 싸요',
  cache_write: '캐시에 쓴 입력, 보통 입력보다 비싸요',
};

// 숫자 글 (값 = 1,234 · 큰 값 = 1.2만 · 비용 = 달러 · 비율 = %)
export const count = formatNumber;
export const compact = formatCompact;
const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const USD_SMALL = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumSignificantDigits: 2 });
export const money = (v: number | null) => (v === null ? '—' : v > 0 && v < 0.01 ? USD_SMALL.format(v) : USD.format(v));
// 차트 눈금 · 풍선용 (0 = $0 · 작으면 유효숫자 둘)
export const moneyAxis = (v: number) => (v === 0 ? '$0' : money(v));
export const percent = (r: number) => `${Math.round(r * 1000) / 10}%`;
export const dayLabel = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
export const rangeText = (from: string, to: string) => `${dayLabel(from)}부터 ${dayLabel(to)}까지`;

export const USAGE_COPY = {
  period: '기간',
  groupBy: '묶음',
  filters: '사용량 거르개',
  allOrgs: `모든 ${ORG}`,
  allSpaces: `모든 ${SPACE}`,
  allUsers: '모든 사용자',
  allModels: '모든 모델',
  personal: `내 ${SPACE} 전부`,
  personalSub: '개인 공간은 합쳐서만 보여요',
  unknown: '알 수 없음',
  orgFilter: `${ORG} 거르기`,
  spaceFilter: `${SPACE} 거르기`,
  userFilter: '사용자 거르기',
  modelFilter: '모델 거르기',
  clear: '거르개 지우기',
  // 숫자 카드
  kpi: {
    runs: '호출 수',
    tokens: '토큰',
    cost: '추정 비용',
    users: '활성 사용자',
    errors: '실패율',
  },
  vsPrevious: (days: number) => `지난 ${days}일 대비`,
  deltaLabel: (days: number, text: string) => `지난 ${days}일 대비 ${text}`,
  tokensSub: (input: string, output: string) => `입력 ${input}, 출력 ${output}`,
  costSub: (unknown: number) => (unknown ? `가격 모르는 호출 ${unknown}회 제외` : '토큰 곱하기 게이트웨이 가격'),
  costNone: '가격을 아는 호출이 없어요',
  errorsSub: (errors: number, cancelled: number) => `실패 ${errors}회${cancelled ? `, 중지 ${cancelled}회` : ''}`,
  usersSub: '한 번 이상 물어본 사람',
  points: (p: number) => `${p > 0 ? '+' : ''}${p}%p`,
  runsSub: (requests: string) => `성공한 호출의 모델 요청 ${requests}회`, // 실패 · 취소는 요청 수를 모른다 (호출 수보다 작을 수 있다)
  // 차트
  runsChart: '호출 추이',
  tokensChart: '토큰 추이',
  costChart: '비용 추이',
  trendChart: (m: Metric) => `${METRIC_LABEL[m]} 추이`,
  seriesRuns: '호출',
  seriesErrors: '실패',
  seriesInput: '입력 토큰',
  seriesOutput: '출력 토큰',
  seriesCost: '추정 비용',
  metric: '기준',
  // 종류별 (토큰 · 비용)
  kinds: (m: Metric) => (m === 'cost' ? '종류별 비용' : '종류별 토큰'),
  kindsHint: '입력과 출력을 겹치지 않게 나눈 값',
  cacheHit: '캐시 적중률',
  cacheHitHint: '입력 중 캐시에서 읽은 비율',
  estimated: (n: number) => `캐시 가격을 몰라 입력 가격으로 어림한 호출 ${n}회 포함`,
  costBreakdownTitle: (name: string) => `${name} 비용 나눔`,
  // 묶음 표
  breakdown: (g: BreakdownGroup) => `${GROUP_LABEL[g]}별 사용량`,
  table: (g: BreakdownGroup) => `${GROUP_LABEL[g]}별 사용량 표`,
  col: {
    name: '이름', runs: '호출', errors: '실패율', tokens: '토큰', cacheRead: '캐시 읽기', cacheWrite: '캐시 쓰기', tools: '도구 호출', cost: '추정 비용', share: '비율',
  },
  colTitle: { cost: '마우스를 올리면 종류별 비용', cacheRead: '입력 중 캐시에서 읽은 토큰', cacheWrite: '입력 중 캐시에 쓴 토큰' },
  shareOf: (m: Metric) => `${METRIC_LABEL[m]} 비율`,
  rowsCount: (n: number) => `${n}개`,
  others: (n: number) => `나머지 ${n}개`,
  drill: { org: `눌러서 이 ${ORG}의 ${SPACE} 보기`, space: `눌러서 이 ${SPACE}의 사용자 보기`, user: '눌러서 이 사람의 모델 보기', model: '모델 자세히' },
  privacy: '숫자만 보여요. 질문과 답, 대화 제목은 관리자 콘솔에 없어요.',
  empty: '이 기간에 사용 기록이 없어요',
  emptyHow: '데스크톱 앱에서 대화를 하면 호출마다 한 줄씩 쌓여요.',
  emptyFiltered: '거르개에 맞는 사용 기록이 없어요',
  // 서랍 안 사용량 칸
  section: '사용량',
  sectionHint: (days: number) => `최근 ${days}일`,
  sectionEmpty: (days: number) => `최근 ${days}일 사용 기록이 없어요`,
  topModels: '많이 쓴 모델',
  openUsage: '사용량에서 보기',
  more: '상세보기',
  topEmptyShort: '기록이 없어요',
  summaryLine: (runs: string, tokens: string, cost: string) => [`호출 ${runs}`, `토큰 ${tokens}`, `비용 ${cost}`],
} as const;

// 모델 자세히 페이지의 '사용량' 칸 (E2E: region '사용량' · 표 '종류별 토큰과 비용')
export const MODEL_USAGE_COPY = {
  title: '사용량',
  hint: '이 모델로 한 호출, 숫자만.',
  empty: (days: number) => `최근 ${days}일에 이 모델로 한 호출이 없어요`,
  okRuns: (ok: number) => `성공 ${ok}회`,
  cacheSub: (read: string, write: string) => `캐시 읽기 ${read}, 캐시 쓰기 ${write}`,
  estimatedShort: '캐시 일부는 입력 가격으로 어림',
  kinds: '종류별 토큰과 비용',
  costShare: '종류별 비용 비중',
  tokenShare: '종류별 토큰 비중',
  // 막대 설명 (표의 '토큰 비율' 칸과 다른 값이라 막대가 무엇인지 적는다)
  barCost: '막대는 비용 비중',
  barTokens: '막대는 토큰 비중',
  col: { kind: '종류', tokens: '토큰', share: '토큰 비율', cost: '추정 비용' },
  total: '합계',
  trend: '호출과 비용 추이',
  topOrgs: `이 모델을 많이 쓴 ${ORG}`,
  topUsers: '이 모델을 많이 쓴 사용자',
} as const;

export const USAGE_LOAD_FAILED: Record<LoadError, string> = {
  conductor: 'conductor 에 연결할 수 없어요 — npm run api',
  gateway: '게이트웨이에 연결할 수 없어요',
  gateway_error: '게이트웨이가 오류를 냈어요',
  gateway_auth: '게이트웨이 인증에 실패했어요',
  server: '사용량을 읽지 못했어요',
};

export const GATEWAY_STATUS: Record<GatewayStatusKind, { text: string; tone: 'ok' | 'danger' | 'warn' }> = {
  ok: { text: '연결됨', tone: 'ok' },
  down: { text: '꺼짐', tone: 'danger' },
  error: { text: '오류', tone: 'danger' },
  auth: { text: '인증 실패', tone: 'warn' },
};
