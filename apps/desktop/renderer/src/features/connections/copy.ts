// 연결된 앱 문구 (한국어) + 예시. 실제 목록은 검수된 카탈로그에서 온다 — 연결되면 SAMPLE_APPS 를 지운다.
import type { IconName } from '@brewai/ui';

export const CONNECTIONS = {
  sub: '에이전트가 일할 때 쓰는 내 앱 연결이에요.',
  available: '연결할 수 있는 앱',
  notConnected: '미연결',
  connect: '연결',
  connectLabel: (name: string) => `${name} 연결`,
  soon: '준비 중',
  needs: '필요 · 앱 로그인(OAuth) 연결',
} as const;

export const CONNECTION_NOTES = [
  ['연결이 필요하면 대화 중에 먼저 물어봐요.'],
  ['로그인은 각 서비스 공식 화면에서 해요. 비밀번호는 저희가 보지 않아요.'],
  ['검수된 연결만 보이고, 언제든 여기서 끊을 수 있어요.'],
] as const;

// 흔한 연결 (예시 — 화면에도 '예시' 로 표시)
export const SAMPLE_APPS: readonly { id: string; name: string; can: string; icon: IconName }[] = [
  { id: 'mail', name: '메일', can: '받은편지함 읽기 · 답장 초안 저장', icon: 'mail' },
  { id: 'calendar', name: '캘린더', can: '내 일정 읽기', icon: 'calendar' },
  { id: 'files', name: '파일', can: '문서 찾기 · 읽기', icon: 'folder' },
  { id: 'messenger', name: '메신저', can: '대화방 메시지 읽기', icon: 'chat' },
];
