// 보내기 움직임 — 새 대화 홈에서 첫 질문을 보내면 홈(마크 · 제목 · 제안)은 위로 흐려지며 빠지고, 내 말을 쓴 자리(입력창 · 누른 제안)에서
// 말풍선이 대화 자리로 올라간다 (FLIP: 끝 자리에 그린 뒤 처음 자리만큼 되돌려 놓고 0으로 풀어 준다). 입력창은 제자리.
// 보내면 App 이 대화 화면을 key 로 새로 그린다 → 보내기 직전 자리를 여기(handoff) 잠깐 두고, 새 화면이 그려질 때 읽는다.
// 움직임 줄이기 = 아무것도 안 한다 (바로 끝 모양). 움직임은 transform · opacity 만 (자리를 밀지 않는다 · 누르기 · 읽기를 막지 않는다).
import { reduceMotion } from '../../lib/hooks';

type Handoff = { ask: string; from: DOMRect; composer: DOMRect | null; at: number };
let handoff: Handoff | null = null;
const FRESH_MS = 1500; // 이보다 늦게 그려진 화면은 다른 일로 본다

const EASE = 'cubic-bezier(.2,0,0,1)'; // --ease-standard
export const MOVE_MS = 460;
const LEAVE_MS = 220;

// 홈에서 보내기 직전: 떠날 것(.hero · .suggest)을 그 자리에 복제해 흐리게 빼고, 말이 시작된 자리를 남긴다.
// from = 글이 있던 자리 (입력창 글 칸 · 누른 제안의 글). 홈 원본은 곧 사라지므로 복제본(그림만 · 화면 읽기 · 누르기 없음)이 빠진다
export function leaveHome(home: HTMLElement | null, ask: string, from: Element | null) {
  handoff = null;
  if (!home || !from || reduceMotion()) return;
  const composer = home.classList.contains('home') ? home.querySelector('.composer') : null; // 프로젝트 화면 입력창은 위에 있다 → 옮기지 않는다
  handoff = { ask, from: from.getBoundingClientRect(), composer: composer?.getBoundingClientRect() ?? null, at: performance.now() };
  for (const el of home.querySelectorAll<HTMLElement>('.hero, .suggest-box')) ghostOut(el);
}

function ghostOut(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const ghost = el.cloneNode(true) as HTMLElement;
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  ghost.classList.add('home-ghost');
  Object.assign(ghost.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  document.body.append(ghost);
  const a = ghost.animate(
    [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-14px) scale(.985)' }],
    { duration: LEAVE_MS, easing: EASE, fill: 'forwards' },
  );
  const done = () => ghost.remove();
  a.onfinish = done;
  a.oncancel = done;
  setTimeout(done, LEAVE_MS + 200); // 창이 가려져 애니메이션이 멈춰도 남지 않게
}

// 대화 화면이 처음 그려질 때 (첫 턴 말풍선): 홈에서 넘겨받은 자리에서 끝 자리로. 넘겨받은 게 없거나 다른 질문이면 false
export function arriveFromHome(bubble: HTMLElement, ask: string): boolean {
  const h = handoff;
  handoff = null;
  if (!h || h.ask !== ask || performance.now() - h.at > FRESH_MS || reduceMotion()) return false;
  bubble.closest('.msg')?.getAnimations().forEach((a) => a.cancel()); // 들어올 때 떠오르는 기본 움직임 대신 (재기 전에: transform 이 자리를 바꾼다)
  const to = bubble.getBoundingClientRect();
  const cs = getComputedStyle(bubble);
  // 글 첫 줄끼리 맞춘다: 말풍선 글 칸(안쪽 여백 안) 왼쪽 위 = 처음 글 자리 왼쪽 위
  const dx = h.from.left - (to.left + parseFloat(cs.paddingLeft));
  const dy = h.from.top - (to.top + parseFloat(cs.paddingTop));
  const bg = cs.backgroundColor;
  bubble.animate(
    [
      { transform: `translate(${dx}px, ${dy}px)`, backgroundColor: 'transparent', offset: 0 },
      { backgroundColor: bg, offset: 0.55 },
      { transform: 'none', backgroundColor: bg },
    ],
    { duration: MOVE_MS, easing: EASE },
  );
  const view = bubble.closest('.thread');
  // 입력창은 제자리: 두 화면의 자리가 다르면 그만큼만 풀어 준다
  const composer = view?.querySelector<HTMLElement>('.composer');
  if (composer && h.composer) {
    const now = composer.getBoundingClientRect();
    const shift = h.composer.top - now.top;
    if (Math.abs(shift) > 1) composer.animate([{ transform: `translateY(${shift}px)` }, { transform: 'none' }], { duration: MOVE_MS, easing: EASE });
  }
  // 머리 줄 · 답 자리는 말풍선이 거의 올라간 뒤 떠오른다
  for (const el of view?.querySelectorAll<HTMLElement>('.conv-head, .turn .msg.agent') ?? []) {
    el.getAnimations().forEach((a) => a.cancel());
    el.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], {
      duration: 280, delay: el.classList.contains('conv-head') ? 120 : 260, easing: EASE, fill: 'backwards',
    });
  }
  return true;
}
