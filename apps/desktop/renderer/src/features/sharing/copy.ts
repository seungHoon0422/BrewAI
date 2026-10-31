// 대화 공유 문구 (한국어) — 공유 = 지금 스페이스 멤버에게 보기만 (ADR-0011). 층 이름은 scope/copy.ts
import { KIND_LABEL } from '../scope/copy';

export const SHARE = {
  button: '공유',
  shared: '공유됨',
  title: '대화 공유',
  toggle: `이 ${KIND_LABEL.space} 멤버에게 보이기`,
  on: '멤버가 이 대화를 볼 수 있어요. 이어 쓰기는 나만 할 수 있어요',
  off: '지금은 나만 볼 수 있어요',
  failed: '바꾸지 못했어요. 잠시 후 다시 시도해 주세요',
  owner: (name: string) => `${name} 님이 공유한 대화예요. 보기만 할 수 있어요`,
} as const;
