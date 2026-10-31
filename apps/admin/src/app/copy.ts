// 틀(사이드바 · 화면 머리) · 메뉴 문구 (해요체 — 데스크톱과 같은 말투). 화면 안 문구는 features/<이름>/copy.ts.
import { roleLabel } from '@brewai/ui';
import type { RouteId } from './routes';

const ORG = roleLabel('tenant');
const SPACE = roleLabel('membership');

// 메뉴 라벨 (E2E: 링크 이름 = 화면 h1) · h1 아래 한 줄
export const MENU_COPY: Record<RouteId, { label: string; desc: string }> = {
  overview: { label: '개요', desc: '호출, 토큰, 비용 흐름과 게이트웨이 상태를 한눈에 봐요.' },
  models: { label: '모델', desc: '사용자 앱 모델 목록에 무엇을 보일지 정해요.' },
  usage: { label: '사용량', desc: `${ORG}, ${SPACE}, 사용자, 모델별 호출과 토큰, 추정 비용이에요. 숫자만 보여요.` },
  catalog: { label: '카탈로그', desc: '에이전트가 찾아 설치할 수 있는 MCP 서버와 Skill이에요.' },
  approvals: { label: '승인 기록', desc: '승인 카드에서 내린 허용과 거절 기록이에요.' },
  traces: { label: '트레이스', desc: '트레이스 원본은 Langfuse에 있어요.' },
  users: { label: `사용자와 ${ORG}`, desc: `사용자, ${ORG}, ${SPACE}, 초대 코드를 관리해요. 예산은 P6에서.` },
  docs: { label: '문서', desc: '개발 진행, 구조, 구성 — 레포 파일에서 바로 읽어요.' },
  settings: { label: '설정', desc: '읽기 전용이에요. 값은 서버 설정에서 와요.' },
};

export const SHELL_COPY = {
  brand: 'BrewAI',
  brandTag: '관리자',
  nav: '관리 메뉴', // E2E: navigation 이름
  env: '로컬',
  envTitle: '실행 환경',
  gallery: 'UI 부품 (개발)',
} as const;
