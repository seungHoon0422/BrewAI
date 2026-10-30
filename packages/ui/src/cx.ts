// 클래스 이름 잇기 (false · undefined 는 뺀다)
export const cx = (...parts: Array<string | false | null | undefined>): string => parts.filter(Boolean).join(' ');

// data-* 불리언 = 참이면 빈 값(있음), 거짓이면 속성 없음 → CSS 는 [data-x] 로 고른다
export const flag = (on: boolean | undefined): '' | undefined => (on ? '' : undefined);
