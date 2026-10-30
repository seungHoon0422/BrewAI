// 화면 사이 이동 — 여러 기능을 잇는 곳은 여기 한 곳 (사이드바 · 경로 줄 · 프로젝트 화면이 부른다).
// 경로 칸(crumb)은 층 역할로 간다: 멤버십 층 = 그 스페이스로 · 묶음 층 = 그 프로젝트 화면 (층 이름은 모른다).
import type { ScopeCrumb } from '@brewai/ui';
import { newChat, openThread } from '../features/chat/hooks';
import { focusProject, switchSpace } from '../features/scope/hooks';
import { GROUP, MEMBERSHIP } from '../features/scope/model';
import { go } from './router';

// 새 대화 (지금 스페이스 · 프로젝트 없음)
export function startChat() {
  focusProject(null);
  newChat();
  go('chat');
}

export function openProject(id: string) {
  focusProject(id);
  newChat();
  go('chat');
}

export function openChat(id: string) {
  openThread(id);
  go('chat');
}

export function openCrumb(c: ScopeCrumb) {
  if (c.kind === MEMBERSHIP) {
    switchSpace(c.id);
    go('chat');
  } else if (c.kind === GROUP) openProject(c.id);
}
