// 스페이스 탭 문구. 층 이름은 KIND_LABEL 로만 (@brewai/ui scope.ts — 이름을 바꾸면 여기 문구가 같이 바뀐다)
import type { Visibility } from './api';
import { KIND_LABEL } from '../scope/copy';

const ORG = KIND_LABEL.org;
const S = KIND_LABEL.space;
const P = KIND_LABEL.project;

export const VISIBILITY_TEXT: Record<Visibility, string> = { open: '열림', private: '비공개' };
export const VISIBILITY_HINT: Record<Visibility, string> = {
  open: `${ORG} 멤버 누구나 찾아 들어올 수 있어요`,
  private: '초대된 멤버만 보여요',
};

export const SPACES_COPY = {
  table: `공유 ${S} 목록`,
  colName: '이름',
  colWhere: '위치',
  colVisibility: '공개 범위',
  colMembers: '멤버',
  colProjects: `${P}`,
  colState: '상태',
  active: '사용 중',
  archived: '보관됨',
  allOrgs: (kind: string) => `모든 ${kind}`,
  orgFilter: `${ORG} 거르기`,
  showArchived: '보관된 것도 보기',
  search: '이름 검색',
  count: (n: number) => `${n}개`,
  personal: (n: number) => `내 ${S}(개인) ${n}개는 목록에 없어요 — 주인만 볼 수 있어요.`,
  privacy: `관리자 콘솔은 대화 제목과 내용을 보여 주지 않아요. 비공개 ${S}도 이름과 숫자만 보여요.`,
  empty: `아직 공유 ${S}가 없어요`,
  emptyHow: `데스크톱 앱에서 ${S} 만들기로 생겨요. 초대 코드에 ${S}를 넣으면 가입할 때 바로 들어가요.`,
  noMatch: `맞는 ${S}가 없어요`,
  // 서랍
  kv: { where: '위치', visibility: '공개 범위', members: '멤버', projects: `${P} (보관 제외)`, created: '만든 날', archived: '보관한 날' },
  description: '설명',
  partInfo: '정보',
  manage: `멤버, 공개 범위, 보관은 그 ${S}의 관리자가 데스크톱 앱에서 바꿔요.`,
} as const;
