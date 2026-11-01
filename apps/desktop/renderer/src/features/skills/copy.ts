// 스킬 화면 문구 (한국어). 화면 글에 '관리자' 를 쓰지 않는다 (사용자 앱).
export const SKILLS = {
  sub: '대화 중에 에이전트가 필요하면 스스로 불러 쓰는 일 처리 지침이에요.',
  mine: '내 Skill',
  list: '스킬 목록', // e2e 계약 (list 이름)
  builtin: '내장',
  usesTools: '쓰는 도구',
  usedTitle: '이 스킬을 쓴 답 수',
  used: (n: number) => (n > 0 ? `${n}번 사용` : '아직 안 씀'),
  loading: '불러오는 중…',
  loadFailed: '스킬 목록을 불러오지 못했어요',
  loadFailedText: '서버가 켜져 있는지 확인해 주세요.',
  retry: '다시',
  empty: '아직 Skill이 없어요',
  emptyText: '대화 중에 필요한 능력이 없으면 에이전트가 카탈로그에서 찾거나 새로 만들어요.',
  emptyNeeds: 'Skill 저장소',
  lifecycle: '새 Skill이 쓰이기까지',
} as const;

// 안내 줄 = [앞 글, 굵게, 뒤 글] (shell Notes)
export const SKILL_NOTES = [
  ['대화에서 "요약해 줘", "비교해 줘" 처럼 말하면 맞는 스킬을 골라 써요. 답 안에 ', '스킬 사용', ' 카드로 보여요.'],
  ['새 스킬 저장과 등록은 다음 단계에서 열려요.'],
] as const;
export const LIFECYCLE_NOTES = [['승인 전에는 격리된 곳에서만 실행돼요. 내 파일이나 계정에는 닿지 않아요.']] as const;

export const SKILL_STEPS: readonly { title: string; text: string; gate?: boolean }[] = [
  { title: '찾기와 만들기', text: '카탈로그에서 찾거나 에이전트가 새로 작성' },
  { title: '격리 테스트', text: '격리된 곳에서만 실행해 확인' },
  { title: '내 승인', text: '내가 허용해야 쓰기 시작', gate: true },
  { title: '사용', text: '필요할 때 대화에서 불러 씀' },
];
