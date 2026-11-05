// 프로젝트 문구 (한국어) — 층 이름은 scope/copy.ts KIND_LABEL 에서 (이름을 바꾸면 여기 문구가 같이 바뀐다)
import { count } from '../../lib/format';
import { KIND_LABEL } from '../scope/copy';

const P = KIND_LABEL.project;

export const PROJECTS = {
  label: P, // e2e 계약 후보 (사이드바 목록 이름)
  new: `새 ${P}`,
  none: `${P} 없음`,
  loading: '불러오는 중…',
  failed: `${P}를 불러오지 못했어요`,
  retry: '다시',
  empty: `${P}로 대화를 묶고 지침을 정해 보세요`,
  picker: `${P} 고르기`,
  pickerMove: `이 대화를 옮길 ${P}`,
  pickerLocked: `내가 시작한 대화만 옮길 수 있어요`,
  moved: (name: string) => `'${name}'(으)로 옮겼어요`,
  // 만들기 · 설정
  createTitle: `새 ${P}`,
  createSub: `대화를 묶어 두고, 이 ${P} 대화에 늘 따를 지침을 정해요`,
  settings: `${P} 설정`,
  name: '이름',
  namePlaceholder: '예: 주간 보고',
  description: '설명',
  descriptionPlaceholder: '무엇을 위한 곳인지 한 줄로',
  instructions: '지침',
  instructionsPlaceholder: '예: 표로 답한다. 숫자는 출처를 붙인다',
  instructionsHint: `이 ${P} 대화마다 시스템 프롬프트 뒤에 붙어요. BrewAI 기본 규칙(도구, 승인)이 먼저예요`,
  count: (n: number, max: number) => `${count(n)} / ${count(max)}자`,
  hasInstructions: '지침 있음',
  by: (name: string) => `${name} 님이 만듦`,
  readOnly: `만든 사람과 ${KIND_LABEL.space} 운영 멤버만 바꿀 수 있어요`,
  save: '저장',
  saved: '저장했어요',
  cancel: '취소',
  create: '만들기',
  archive: '보관',
  archiveTitle: `이 ${P}를 보관할까요?`,
  archiveBody: '목록에서 사라지고 새 대화를 시작할 수 없어요. 대화 기록은 그대로 남아요',
  // 프로젝트 화면
  threads: '대화',
  newChat: '새 대화',
  threadsEmpty: `아직 대화가 없어요. 위에서 시작하면 이 ${P}에 들어가요`,
  composerHint: (name: string) => `'${name}'에 새 대화`,
} as const;

// 로컬 폴더 (slice 09) — 이 PC 폴더를 연결하면 이 프로젝트 대화에서 읽을 수 있다 (읽기만)
export const FOLDER = {
  connect: '로컬 폴더 연결', // e2e 계약 후보
  pickTitle: `${P}에 연결할 폴더`,
  change: '바꾸기',
  disconnect: '연결 끊기',
  label: '로컬 폴더',
  hint: '이 PC의 폴더를 연결하면 대화에서 파일을 찾아 읽어요. 고치거나 실행하지는 않아요',
  readOnly: '읽기만',
  missing: '폴더를 찾을 수 없어요. 다시 연결해 주세요',
  connected: (name: string) => `'${name}' 폴더를 연결했어요`,
} as const;

const FOLDER_ERRORS: Record<string, string> = {
  local_folders_off: '이 PC에서 도는 서버일 때만 폴더를 연결할 수 있어요',
  not_absolute: '폴더 경로가 올바르지 않아요',
  not_found: '그 폴더를 찾을 수 없어요',
  not_dir: '폴더가 아니에요',
  too_broad: '집 폴더 전체나 디스크 전체는 연결할 수 없어요. 프로젝트 폴더를 골라 주세요',
  outside_home: '내 집 폴더 안의 폴더만 연결할 수 있어요',
  hidden: '숨김 폴더 안은 연결할 수 없어요',
  system: '시스템 폴더는 연결할 수 없어요',
  offline: '서버에 연결할 수 없어요',
};
export const folderError = (code: string | undefined) =>
  code && Object.prototype.hasOwnProperty.call(FOLDER_ERRORS, code) ? FOLDER_ERRORS[code] : projectError(code);

const ERRORS: Record<string, string> = {
  bad_name: '이름은 1~80자로 적어 주세요',
  forbidden: '이 작업을 할 권한이 없어요',
  project_not_found: `${P}를 찾지 못했어요`,
  project_archived: `보관된 ${P}예요`,
  project_in_other_space: `같은 ${KIND_LABEL.space}의 ${P}로만 옮길 수 있어요`,
  space_archived: `보관된 ${KIND_LABEL.space}예요`,
  offline: '서버에 연결할 수 없어요',
};
export const projectError = (code: string | undefined) =>
  code && Object.prototype.hasOwnProperty.call(ERRORS, code) ? ERRORS[code] : '잠시 후 다시 시도해 주세요';
