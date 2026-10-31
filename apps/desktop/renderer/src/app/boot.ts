// 로그인한 뒤 한 번 — 범위(스페이스 · 프로젝트) · 모델 · 최근 대화 · 스킬 · 툴 이름 · 연결된 앱을 읽는다 (각 기능의 store 가 받는다).
// 최근 대화 · 프로젝트는 스페이스가 정해지면 각 기능이 스스로 읽는다 (watchScope).
import { loadThreads } from '../features/chat/hooks';
import { loadApps } from '../features/connections/hooks';
import { loadModels } from '../features/models/hooks';
import { currentSpaceId, initScope } from '../features/scope/hooks';
import { loadSkills, loadTools } from '../features/skills/hooks';

export function boot() {
  initScope();
  if (!currentSpaceId()) void loadThreads(); // 스페이스를 모르는 서버 = 기본(내 스페이스) 목록
  void loadModels();
  void loadSkills();
  loadTools();
  void loadApps(); // 활동 단계 app:<handle> 이름 · 대화 카드의 연결 상태
}
