// UI 부품 모음(#/ui) 화면 문구 · 예시 데이터 — 개발용 화면이라 제품 문구가 아니다
import type { ScopePath } from '../scope';

export const COPY = {
  title: 'UI 부품',
  desc: '@brewai/ui 의 토큰과 부품 전부 — 다시 그릴 때 여기 한 곳에서 라이트와 다크를 같이 본다.',
  back: '관리자 콘솔로',
  themes: { both: '둘 다', light: '라이트', dark: '다크' },
  themeLabel: '테마',
  sections: {
    color: '색', type: '글자', shape: '둥글기, 그림자, 유리', buttons: '버튼', inputs: '입력', choice: '고르기',
    display: '배지, 점, 아바타', cards: '카드, 알림, 빈 상태', table: '표', overlays: '떠 있는 층', nav: '길 찾기', icons: '아이콘', wait: '기다림',
  },
} as const;

export const SCOPE_PATH: ScopePath = [
  { kind: 'org', id: 'o1', name: 'BrewAI' },
  { kind: 'space', id: 's1', name: '제품팀' },
  { kind: 'project', id: 'p1', name: '로그인 화면' },
];
export const LONG_PATH: ScopePath = [
  { kind: 'org', id: 'o1', name: 'BrewAI' },
  { kind: 'space', id: 's2', name: '공유 스페이스' },
  { kind: 'project', id: 'p2', name: '분기 계획' },
  { kind: 'folder', id: 'f1', name: '3분기' },
  { kind: 'thread', id: 't1', name: '예산 정리 대화' },
];
export const KIND_LABEL: Record<string, string> = { org: '조직', space: '스페이스', project: '프로젝트', folder: '폴더', thread: '대화' };

export type SampleModel = { id: string; name: string; provider: string; state: 'exposed' | 'hidden' | 'candidate' | 'missing'; ctx: number; isDefault?: boolean };
export const MODELS: SampleModel[] = [
  { id: 'claude-sonnet', name: 'Claude Sonnet', provider: 'anthropic', state: 'exposed', ctx: 200, isDefault: true },
  { id: 'gpt-mini', name: 'GPT mini', provider: 'openai', state: 'exposed', ctx: 128 },
  { id: 'gemini-flash', name: 'Gemini Flash', provider: 'google', state: 'candidate', ctx: 1000 },
  { id: 'mistral-small', name: 'Mistral Small', provider: 'mistral', state: 'hidden', ctx: 32 },
  { id: 'old-model', name: 'Old Model', provider: 'deepseek', state: 'missing', ctx: 64 },
];
export const STATE_TEXT = { exposed: '노출', hidden: '숨김', candidate: '새로 들어옴', missing: '게이트웨이에 없음' } as const;

// 모델 기능 아이콘 (관리자 모델 표 '기능' 칸과 같은 짝)
export const MODEL_CAPS = [
  { icon: 'text', label: '텍스트' },
  { icon: 'image', label: '이미지 입력' },
  { icon: 'wrench', label: '도구 호출' },
  { icon: 'bulb', label: '생각(추론)' },
  { icon: 'embed', label: '임베딩' },
] as const;
