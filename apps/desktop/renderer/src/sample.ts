// 예시 데이터 — 화면 모양을 보이려고 넣은 가짜 항목. 화면에도 '예시' 로 표시한다.
// 대화 기록·카탈로그가 연결되면 이 파일을 지운다.
import type { IconName } from './icons';

export const SAMPLE_RECENTS: readonly { title: string; project: string; unread?: boolean }[] = [
  { title: '주간 보고서 초안', project: '업무', unread: true },
  { title: '견적 메일 답장', project: '업무' },
  { title: '여행 일정 정리', project: '개인', unread: true },
  { title: '발표 자료 다듬기', project: '업무' },
  { title: '가계부 분류', project: '개인' },
  { title: '이사 체크리스트', project: '개인' },
];

export const SAMPLE_PROJECTS: readonly string[] = ['개인', '업무', '사이드 프로젝트'];

// 흔한 연결. 실제 목록은 검수된 카탈로그에서 온다.
export const SAMPLE_APPS: readonly { id: string; name: string; can: string; icon: IconName }[] = [
  { id: 'mail', name: '메일', can: '받은편지함 읽기 · 답장 초안 저장', icon: 'mail' },
  { id: 'calendar', name: '캘린더', can: '내 일정 읽기', icon: 'cal' },
  { id: 'files', name: '파일', can: '문서 찾기 · 읽기', icon: 'folder' },
  { id: 'messenger', name: '메신저', can: '대화방 메시지 읽기', icon: 'chat' },
];

export const SAMPLE_SCHEDULES: readonly { when: string; task: string }[] = [
  { when: '매주 월요일 9:00', task: '지난주 메일에서 할 일만 정리' },
  { when: '매일 18:00', task: '오늘 회의 메모를 한 장으로 요약' },
  { when: '매월 1일 9:00', task: '지난달 가계부 분류' },
];
