// 모델 화면 문구 전부 (한국어). 컴포넌트는 여기 이름만 쓴다. E2E 가 읽는 문구에는 'E2E' 표시 — 바꾸면 e2e/admin-models.spec.ts 도.
import type { IconName } from '@brewai/ui';
import type { LoadError } from '../../shared/http';
import type { ModelState, SyncResult } from './api';
import type { ColId } from './derive';

// 화면 안 탭 (E2E: 탭 이름 · 해시). 순서 = 탭 줄 순서 · 첫 탭 = '#/models' · 나머지 = '#/models/<id>'. 탭을 더하려면 여기 한 줄 + ModelsScreen PANELS 한 줄
export type ModelTab = 'list' | 'add';
export const MODEL_TABS: readonly { id: ModelTab; label: string; icon: IconName }[] = [
  { id: 'list', label: '모델 목록', icon: 'cube' },
  { id: 'add', label: '모델 추가', icon: 'plus' },
];

// 표 머리 글 (E2E: 글). 칸 id · 순서 = derive.ts COL_IDS (배치는 id 로 정한다 — 글을 바꿔도 배치는 그대로)
export const COL_LABEL: Record<ColId, string> = {
  select: '선택', order: '순서', provider: '제공사', model: '모델', state: '상태', exposed: '노출', default: '기본', health: '연결',
  context: '컨텍스트', input: '입력 비용', output: '출력 비용', caps: '기능',
};
// 머리 글 툴팁 (단위 · 출처)
export const COL_TITLE: Partial<Record<ColId, string>> = {
  context: '입력 한도 (토큰) · 게이트웨이 값',
  input: '입력 100만 토큰당 달러 · 게이트웨이 가격표',
  output: '출력 100만 토큰당 달러 · 게이트웨이 가격표',
  caps: '게이트웨이가 알려 준 기능 · 아이콘에 마우스를 올리면 이름',
};

// 기능 아이콘 (E2E: aria-label). 모양 = @brewai/ui 아이콘 · 한 색. label = 짧은 이름 · long = 툴팁
export type CapId = 'text' | 'image' | 'tools' | 'reasoning' | 'embedding' | 'other';
export const CAP: Record<CapId, { icon: IconName; label: string; long: string }> = {
  text: { icon: 'text', label: '텍스트', long: '텍스트 입력 · 출력' },
  image: { icon: 'image', label: '이미지 입력', long: '이미지 입력 (vision)' },
  tools: { icon: 'wrench', label: '도구 호출', long: '도구 호출 (function calling)' },
  reasoning: { icon: 'bulb', label: '생각', long: '생각(추론) — 사용자 앱에서 생각 깊이를 고를 수 있어요' },
  embedding: { icon: 'embed', label: '임베딩', long: '임베딩 모델 · 대화에 안 씀' },
  other: { icon: 'minus', label: '대화 모델 아님', long: '대화 모델 아님 · 대화에 안 씀' },
};

// 연결 실패 이유 (conductor diagnose.py detail · 공개 code) → 짧은 이름 + 고치는 곳. 데스크톱 features/chat/copy.ts DETAIL 과 같은 뜻
export const ERROR_DETAIL: Record<string, { short: string; hint: string }> = {
  provider_key_missing: { short: '키 없음', hint: 'LiteLLM 관리 화면 › Models › 이 모델의 Credential 키 확인 (config.yaml 모델이면 .env 의 ANTHROPIC_API_KEY · OPENAI_API_KEY)' },
  provider_key_invalid: { short: '키 틀림', hint: 'LiteLLM 관리 화면 › Models › 이 모델의 Credential 키 확인 (권한 · 만료)' },
  provider_model_not_found: { short: '모델 이름 없음', hint: '모델 이름이 provider 에 없음 — LiteLLM 관리 화면 › Models 에서 LiteLLM 모델 이름 확인' },
  reasoning_unsupported: { short: '생각 설정 거절', hint: '이 모델은 생각(추론) 파라미터를 받지 않아요 — 사용자 앱에서 생각 깊이를 끄기로' },
  provider_bad_request: { short: '요청 거절', hint: 'provider 가 요청을 거절 — conductor 로그의 provider_message 확인 · 생각 깊이를 끄고 다시' },
  gateway_budget_exceeded: { short: '예산 초과', hint: 'LiteLLM 관리 화면 › Virtual Keys · Teams 의 Max Budget 확인' },
  gateway_key_invalid: { short: '게이트웨이 키 틀림', hint: '.env 의 LLM_GATEWAY_KEY (또는 LITELLM_MASTER_KEY) 가 LiteLLM 과 같은지 확인' },
  gateway_model_denied: { short: '키에 모델 허용 안 됨', hint: 'LiteLLM 관리 화면 › Virtual Keys › conductor 키의 허용 모델 확인' },
  gateway_model_missing: { short: '게이트웨이에 없음', hint: 'LiteLLM 관리 화면 › Models 에 이 모델이 있는지 확인 뒤 동기화' },
  provider_rate_limited: { short: '요청 제한', hint: 'provider 요청 한도 — 잠시 뒤 다시' },
  provider_unavailable: { short: 'provider 응답 없음', hint: 'provider 서버 오류 — 잠시 뒤 다시' },
  gateway_unreachable: { short: '게이트웨이 꺼짐', hint: '게이트웨이가 켜져 있는지 확인 — npm run stack' },
  gateway_auth_failed: { short: '게이트웨이 인증 실패', hint: '.env 의 LLM_GATEWAY_KEY 확인' },
  provider_auth_failed: { short: '키 문제', hint: 'LiteLLM 관리 화면 › Models › 이 모델의 Credential 키 확인' },
  provider_rejected: { short: '설정 문제', hint: 'conductor 로그의 provider_message 확인' },
  model_error: { short: '모델 오류', hint: 'conductor 로그 확인 — 잠시 뒤 다시' },
};
export const UNKNOWN_ERROR_HINT = 'conductor 로그 확인';
// 고치는 곳 좁히기 (등록한 곳 × 회사) — derive.ts fixFor 가 고른다
export const FIX_HINT = {
  configKey: (envKey: string) => `config.yaml 모델 — .env 의 ${envKey} 확인 뒤 게이트웨이 다시 켜기 (npm run gateway)`, // E2E
  uiKey: 'LiteLLM 관리 화면 › Models › 이 모델의 Credential 키 확인',
  configModel: 'config.yaml 모델 — infra/litellm/config.yaml 의 litellm_params.model 이름 확인',
  litellmMarker: 'LiteLLM 관리 화면', // 이 말이 든 힌트 = 서랍에 'LiteLLM 에서 고치기' 링크
};

const conductorDown = 'conductor 에 연결할 수 없어요';

// 목록을 못 읽음 (E2E)
export const LOAD_ERROR: Record<LoadError, string> = {
  conductor: `${conductorDown} — npm run api`,
  gateway: '게이트웨이에 연결할 수 없어요 — npm run gateway',
  gateway_error: '게이트웨이가 오류를 냈어요 — 게이트웨이 로그 확인',
  gateway_auth: '게이트웨이 인증에 실패했어요 — .env 의 LITELLM_MASTER_KEY 확인',
  server: '모델 목록을 읽지 못했어요',
};

// PATCH 실패 (detail code) → 한 줄 (E2E)
export const PATCH_ERROR: Record<string, string> = {
  model_not_found: '그 모델이 목록에 없어요. 새로 고쳐 주세요',
  not_chat_model: '대화 모델이 아니라서 노출할 수 없어요',
  model_missing: '게이트웨이에서 사라진 모델이라 노출할 수 없어요',
  default_requires_exposed: '노출한 모델만 기본으로 정할 수 있어요',
  bad_display_name: '표시 이름은 60자까지, 보이지 않는 글자 없이 써 주세요',
  bad_order: '순서 값이 올바르지 않아요',
};

// 상태 배지 (E2E)
export const STATE_TEXT: Record<ModelState, string> = { exposed: '노출', hidden: '숨김', candidate: '후보', missing: '게이트웨이에서 사라짐' };
// 등록한 곳 (E2E: tag)
export const SOURCE: Record<string, { tag: string; long: string }> = {
  config: { tag: 'config.yaml', long: 'config.yaml (infra/litellm)' },
  ui: { tag: 'LiteLLM UI', long: 'LiteLLM 관리 화면 (DB)' },
  mixed: { tag: 'config + UI', long: 'config.yaml 과 LiteLLM 관리 화면 둘 다' },
};

// 상태 거르개 (분할 버튼 · 개수 함께)
export type StateFilter = 'all' | 'exposed' | 'candidate' | 'hidden' | 'problem';
export const STATE_FILTERS: { value: StateFilter; label: string }[] = [
  { value: 'all', label: '전체' }, { value: 'exposed', label: '노출' }, { value: 'candidate', label: '후보' },
  { value: 'hidden', label: '숨김' }, { value: 'problem', label: '문제 있음' },
];

export const COPY = {
  boundary: '모델은 게이트웨이(LiteLLM)에서만 등록돼요. 여기서는 노출 · 표시 이름 · 순서 · 기본 모델만 정해요.', // E2E
  table: '모델 목록', // E2E: 표 이름
  tabs: '모델 화면 탭', // E2E: tablist 이름

  // 동기화 줄
  lastSync: '마지막 동기화',
  neverSynced: '아직 동기화 전',
  sync: '동기화', // E2E
  syncing: '동기화 중…',
  syncTitle: '새 모델은 LiteLLM 에 등록한 뒤 동기화하면 후보(숨김)로 들어와요',
  probeAll: '모두 시험', // E2E
  probeAllTitle: '노출한 대화 모델을 하나씩 짧게 불러 봐요 (키 · 모델 이름 확인)',
  addInLitellm: 'LiteLLM 에서 추가', // E2E (링크 · 꺼져 있으면 버튼)
  addTitle: (url: string) => `LiteLLM Admin UI 열기 (${url})`,
  addOffTitle: 'conductor 에 연결되면 LiteLLM Admin UI 주소를 알려 줘요',

  // 알림 줄
  dismiss: '안내 닫기', // E2E
  candidates: (n: number) => [`새 모델 ${n}개가 `, '후보', '로 들어왔어요. 확인하고 노출을 켜면 사용자 앱에 보여요.'] as const, // E2E: 이어 읽으면 한 문장
  toCandidates: '후보 확인', // E2E: '모델 추가' 탭으로

  // 모델 추가 탭 (등록은 LiteLLM 에서 — 여기는 순서 안내 · 동기화 · 후보 확인)
  add: {
    steps: '모델을 추가하는 순서',
    s1: { title: 'LiteLLM 에 등록', body: ['LiteLLM 관리 화면 › Models 에서 제공사 · 모델 이름 · 키(Credential)를 넣어요. 코드로 관리하려면 ', 'infra/litellm/config.yaml', ' 의 ', 'model_list', '.'] as const },
    s2: { title: '동기화', body: '60초마다 저절로 가져와요. 바로 보려면 동기화를 눌러요.' },
    s3: { title: '확인하고 노출', body: '새 모델은 후보(숨김)로 들어와요. 연결 시험으로 키 · 이름을 확인한 뒤 노출하면 사용자 앱 모델 메뉴에 보여요.' },
    candTitle: '확인할 후보', // E2E: 목록 이름
    candEmpty: '확인할 후보가 없어요', // E2E
    candEmptyHow: 'LiteLLM 에 새 모델을 등록하고 동기화하면 여기에 나와요.',
    expose: '노출하기',
    exposeLabel: (label: string) => `노출하기 — ${label}`, // E2E
    keepHidden: '숨김으로 두기',
    keepHiddenLabel: (label: string) => `숨김으로 두기 — ${label}`, // E2E
    keepHiddenTitle: '후보 딱지를 떼고 숨긴 채로 둬요 (모델 목록에서 언제든 노출)',
    exposed: (label: string) => `${label} · 노출했어요 — 사용자 앱 모델 메뉴에 보여요`,
    kept: (label: string) => `${label} · 숨김으로 뒀어요`,
  },

  // 도구 줄
  search: '모델 검색', // E2E
  searchHint: '이름 · ID 로 찾기', // E2E
  bulk: '고른 모델', // E2E: toolbar 이름
  filters: '거르기', // E2E: group 이름
  picked: (n: number) => `${n}개 선택됨`,
  expose: '노출',
  hide: '숨기기',
  probe: '연결 시험',
  clearSel: '선택 해제',
  providerFilter: '제공사 필터', // E2E: combobox 이름 (값을 바꾸는 칸이 아니라 표를 거른다)
  allProviders: (n: number) => `전체 제공사 · ${n}개`, // E2E
  providerOption: (label: string, total: number, exposed: number) => `${label} · ${total}개 · 노출 ${exposed}`, // E2E
  stateGroup: '상태', // E2E: radiogroup 이름

  // 표 상태
  loading: '불러오는 중…',
  retry: '다시 시도', // E2E
  empty: '게이트웨이에 모델이 없어요', // E2E
  emptyHow: ['LiteLLM Admin UI 나 ', 'infra/litellm/config.yaml', ' 의 ', 'model_list', ' 에서 등록해요'] as const,
  howToAdd: '추가하는 법 보기',
  noMatch: '조건에 맞는 모델이 없어요', // E2E
  clearFilters: '필터 지우기', // E2E
  foot: '사용자 앱 모델 메뉴는 기본 모델을 맨 위에, 나머지는 이 순서대로 제공사별로 모아 보여요. 순서 = 제공사 안 자리. 줄을 누르면 자세히 · 고치기.',
  footGateway: ['게이트웨이 값(제공사 · 컨텍스트 · 비용 · 기능 · 출처)은 LiteLLM ', '/model_group/info', ' · ', '/v1/model/info', ' 의 읽기 전용 스냅샷이에요. 비용 = 100만 토큰당 달러.'] as const,

  // 줄
  select: (label: string) => `선택 — ${label}`, // E2E
  selectCol: '선택',
  ordTitle: (provider: string, pos: number | string) => `${provider} 안에서 ${pos}번째 · 같은 제공사 안에서만 옮겨요`,
  ordLocked: '전체 보기에서 순서를 바꿀 수 있어요', // E2E
  dragTitle: '끌어서 순서 바꾸기',
  up: (label: string) => `위로 — ${label}`, // E2E
  down: (label: string) => `아래로 — ${label}`, // E2E
  exposeSwitch: (label: string) => `노출 — ${label}`, // E2E
  exposeOn: '사용자 앱에서 숨기기',
  exposeOff: '사용자 앱에 보이기',
  notChat: '대화 모델이 아니라서 노출할 수 없어요',
  missing: '게이트웨이에서 사라진 모델이에요',
  defaultRadio: (label: string) => `기본 모델 — ${label}`, // E2E
  defaultTitle: '기본 모델로',
  defaultNeedsExposed: '노출한 모델만 기본으로 정할 수 있어요',
  costTitle: (kind: string) => `${kind} 100만 토큰당 달러 (게이트웨이 가격표)`,
  costPair: '입력 / 출력 비용 · 100만 토큰당 달러',
  capOther: (mode: string) => `대화 모델 아님${mode ? ` (${mode})` : ''} · 대화에 안 씀`,

  // 이름 칸
  details: (label: string) => `자세히 — ${label}`, // E2E
  detailsTitle: '자세히',
  default: '기본', // E2E
  rename: (label: string) => `표시 이름 바꾸기 — ${label}`, // E2E
  gatewayId: '실제 모델 이름 (게이트웨이 ID · 사용자 앱 요청 값)',
  revert: '되돌리기', // E2E
  revertTitle: (name: string) => `기본 이름(${name})으로 되돌리기`, // E2E
  nameField: (id: string) => `표시 이름 — ${id}`, // E2E
  nameEditHint: (name: string) => `Enter 저장 · Esc 취소 · 비우면 기본 이름 (${name})`,
  dupUser: '이름 겹침', // E2E
  dupUserTitle: '같은 표시 이름의 모델이 둘 다 노출돼 있어요 — 사용자 앱은 ID 를 함께 보여 줘요',
  dupHidden: '이름 같음', // E2E
  dupHiddenTitle: '같은 표시 이름의 모델이 있지만 한쪽이 숨김이라 사용자 앱에선 겹치지 않아요',

  // 연결 칸
  probeLabel: (label: string) => `연결 시험 — ${label}`, // E2E
  probeTitle: '짧은 호출 한 번으로 키 · 모델 이름을 확인해요',
  healthBad: '오류',
  healthOk: '정상',
  healthUnknown: '확인 전',
  fixInLitellm: 'LiteLLM 에서 고치기', // E2E

  // 서랍
  sheetTitle: '모델 자세히',
  familyOf: (f: string) => ` · ${f} 계열`,
  renameBtn: '이름 바꾸기', // E2E
  nameFieldInSheet: '표시 이름', // E2E
  backToDefault: (name: string) => `기본 이름(${name})으로`,
  dupUserLong: '같은 표시 이름의 모델이 둘 다 노출돼 있어요. 사용자 앱은 ID 를 함께 보여 주지만, 이름을 다르게 바꾸면 더 헷갈리지 않아요.',
  dupHiddenLong: '같은 표시 이름의 모델이 있지만 한쪽이 숨김이라 지금은 사용자 앱에서 겹치지 않아요. 둘 다 노출하려면 이름을 다르게 바꿔 주세요.', // E2E
  partApp: '사용자 앱',
  appHint: '여기서 정해요',
  exposeInSheet: '사용자 앱에 노출', // E2E
  shown: '사용자 앱에 보여요',
  hidden: '숨김',
  isDefault: '기본 모델이에요', // E2E
  makeDefault: '기본 모델로 정하기', // E2E
  orderIn: (provider: string) => `${provider} 안 자리 (사용자 앱 모델 메뉴 순서)`,
  order: '순서',
  app: { name: '표시 이름', expose: '노출', default: '기본', order: '순서' },
  moveUp: '위로 옮기기', // E2E
  moveDown: '아래로 옮기기', // E2E
  partHealth: '연결',
  partGateway: '게이트웨이 값',
  readOnly: '읽기 전용 · LiteLLM 에서 바꿔요',
  kv: {
    provider: '제공사', model: '모델 이름', context: '컨텍스트', maxOut: '출력 한도', input: '입력 비용', output: '출력 비용', features: '기능',
    source: '등록한 곳', unknownSource: '알 수 없음', firstSeen: '처음 본 때', lastSeen: '마지막 본 때',
    perM: (p: string) => `${p} / 100만 토큰`, // E2E
    tokens: (t: string) => `${t} 토큰`,
  },

  // 시간
  ago: { now: '방금', min: (n: number) => `${n}분 전`, hour: (n: number) => `${n}시간 전` },

  // 결과 한 줄 (E2E: status · alert 글)
  done: {
    probeOk: (label: string, sec: string) => `${label} · 연결 정상 (${sec}초)`,
    probeFail: (label: string, short: string, hint: string) => `${label} · 연결 실패: ${short} — ${hint}`,
    probeError: (label: string, down: boolean) => `${label} · ${down ? conductorDown : '연결 시험을 하지 못했어요'}`,
    nothingToProbe: '시험할 대화 모델이 없어요',
    probeUntested: (label: string) => `${label} (시험 못 함)`,
    probeBad: (label: string, short: string) => `${label} (${short})`,
    probeLost: (n: number) => `${conductorDown} · ${n}개까지 시험함`,
    probeSome: (total: number, ok: number, bad: string[]) => `${total}개 시험 · 정상 ${ok} · 실패 ${bad.length}: ${bad.join(', ')} — 줄을 누르면 고치는 곳`,
    probeAllOk: (total: number) => `${total}개 시험 · 모두 정상`,
    patchFail: (label: string, why: string) => `${label} · ${why}`,
    patchDown: conductorDown,
    patchUnknown: '바꾸지 못했어요. 잠시 뒤 다시 해 주세요',
    defaultChanged: (label: string) => `기본 모델을 바꿨어요 · ${label}`,
    nameReverted: (name: string) => `기본 이름으로 되돌렸어요 · ${name}`,
    moved: (label: string, provider: string, pos: number | string) => `순서를 바꿨어요 · ${label} → ${provider} ${pos}번`,
    bulk: (n: number, expose: boolean) => `${n}개 ${expose ? '노출' : '숨김'}`,
    bulkSkipped: (n: number) => `${n}개는 대화 모델이 아니라 건너뜀`,
    bulkAlready: (n: number, expose: boolean) => `${n}개는 이미 ${expose ? '노출' : '숨김'}`,
    bulkFailed: (n: number) => `${n}개 실패`,
  },
} as const;

export function syncText(r: SyncResult) {
  const parts = [
    r.added.length ? `새 모델 ${r.added.length}개 (후보 · 숨김)` : '',
    r.missing.length ? `사라진 모델 ${r.missing.length}개 (자동 숨김)` : '',
    r.restored.length ? `돌아온 모델 ${r.restored.length}개 (숨김 유지)` : '',
  ].filter(Boolean);
  return parts.length ? `동기화했어요 · ${parts.join(' · ')}` : '동기화했어요 · 바뀐 모델 없음';
}
