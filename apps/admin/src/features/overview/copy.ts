// 개요 화면 문구 = 운영자가 보는 한 장 (사용량 흐름 · 조직 · 모델 비중 · 게이트웨이 · 사람 수 · 바로 가기). 개발 진행은 문서 메뉴에만.
// 카드 이름 · 값은 E2E 가 읽는다 (e2e/admin-usage.spec.ts · admin-models.spec.ts)
import type { IconName } from '@brewai/ui';
import { MENU_COPY } from '../../app/copy';
import type { RouteId } from '../../app/routes';
import { KIND_LABEL } from '../scope/copy';

const ORG = KIND_LABEL.org;
const SPACE = KIND_LABEL.space;

export const OVERVIEW_COPY = {
  period: '기간',
  toUsage: '사용량 자세히',
  orgs: `${ORG}별 사용량`,
  orgsHint: `호출 수, 눌러서 그 ${ORG} 사용량`,
  orgsEmpty: `이 기간에 호출한 ${ORG}이 없어요`,
  models: '모델별 비중',
  modelsHint: '호출 수, 눌러서 모델 자세히',
  modelsOther: (n: number) => `기타 ${n}개`,
  // 게이트웨이 카드 (E2E: region '게이트웨이' · data-state)
  gateway: '게이트웨이',
  gatewayLink: '모델 보기',
  litellm: 'LiteLLM',
  lastSync: (ago: string) => `마지막 동기화 ${ago}`,
  neverSynced: '아직 동기화 전',
  modelCounts: { exposed: '노출', candidate: '후보', hidden: '숨김', missing: '사라짐', failing: '연결 실패' },
  failingTitle: '살펴볼 모델',
  failingHint: '기간 안에 실패가 있었거나 연결 테스트가 실패한 모델',
  allHealthy: '기간 안에 실패한 모델이 없어요',
  modelLine: (runs: string, rate: string) => `호출 ${runs}, 실패율 ${rate}`,
  health: { ok: '정상', error: '연결 실패', unknown: '아직 모름' },
  gatewayHow: {
    down: 'LiteLLM 이 응답하지 않아요. npm run gateway 로 켜고 마지막으로 본 목록을 보여 줘요.',
    error: 'LiteLLM 이 오류를 냈어요. 게이트웨이 로그를 확인해 주세요.',
    auth: '.env 의 LITELLM_MASTER_KEY 를 확인해 주세요.',
  },
  // 사람 수 카드
  people: `사용자와 ${ORG}`,
  peopleLink: `사용자와 ${ORG} 보기`,
  counts: {
    users: '사용자',
    usersSub: (active: number, disabled: number) => `활성 ${active}명${disabled ? `, 비활성 ${disabled}명` : ''}`,
    orgs: ORG,
    spaces: `공유 ${SPACE}`,
    spacesSub: (personal: number, archived: number) => `내 ${SPACE} ${personal}개${archived ? `, 보관 ${archived}개` : ''}`,
    active: '활성 사용자',
    activeSub: (d30: number) => `최근 7일, 30일엔 ${d30}명`,
    invites: '쓸 수 있는 초대 코드',
  },
  unit: { people: (n: number) => `${n}명`, count: (n: number) => `${n}개` },
  // 바로 가기
  links: '바로 가기',
  later: '준비 중',
  empty: '아직 사용 기록이 없어요',
  emptyHow: '데스크톱 앱에서 대화를 하면 호출 수, 토큰, 비용이 여기에 흐름으로 쌓여요.',
} as const;

// 바로 가기 = 아직 화면만 있는 메뉴 · 설정 (누르면 그 메뉴로). 문서(개발 진행)는 사이드바에만
export const QUICK_LINKS: readonly { id: RouteId; icon: IconName; label: string; desc: string; later?: true }[] = (
  [
    { id: 'approvals', icon: 'shield', later: true },
    { id: 'traces', icon: 'waterfall', later: true },
    { id: 'catalog', icon: 'box' },
    { id: 'settings', icon: 'sliders' },
  ] as const
).map((l) => ({ ...l, ...MENU_COPY[l.id] }));
