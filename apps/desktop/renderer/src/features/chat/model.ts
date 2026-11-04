// 대화 상태의 모양 — 대화(Conv) › 턴(Turn: 질문 + 답) › 답(Answer: 조각 · 단계 · 모델). hooks · events · trace · 화면이 같이 본다.
import type { FileItem } from '../files/api';
import type { ScopePath } from '@brewai/ui';
import type { Failure, Reasoning } from '../../lib/api';
import type { AppAuthMode, AppAuthReason, AppServer, Step, StepStatus, ThreadScope, Usage, Via } from './api';

export type ModelTag = { id: string; label: string; provider: string; provider_label: string };

export type ReasoningPart = { kind: 'reasoning'; id: string; text: string; live: boolean; ms: number | null; at: number };
export type TextPart = { kind: 'text'; id: string; text: string };
// waiting = 앱 연결을 기다리며 멈춘 호출 (연결 뒤 이어서 하기)
export type ToolStatus = 'running' | 'done' | 'error' | 'cancelled' | 'waiting';
// MCP 앱 도구 · use_app 카드 (brewai.app_tool · use_app 결과 · 기록) — write = 앱의 데이터를 바꾸는 도구 (지금은 표시만 · 승인은 slice 07)
export type AppTag = { handle: string; name: string; write: boolean };
// at = 부르기 시작(TOOL_CALL_START) · ms = 그때부터 결과까지 · ready = 인자를 다 받은 때(TOOL_CALL_END · 기록에서 연 답은 null)
// batch = 툴을 부른 모델 응답 번호 (같은 batch = 한 응답에서 같이 불려 동시에 돌았다 · 화면이 '동시에 n개' 로 묶는다)
// agent · role = 팀원에게 맡기기(delegate) 호출 = 팀원 하나 (a1 · 역할 이름 · brewai.team_member 가 채운다)
export type ToolPart = {
  kind: 'tool'; id: string; name: string; label: string; argsText: string; args: unknown; result: unknown; status: ToolStatus; ms: number | null; at: number;
  ready: number | null; batch: number; app?: AppTag; agent?: string; role?: string;
};
export type Part = ReasoningPart | TextPart | ToolPart;

// 에이전트 팀 (slice 06) — 팀원 하나 = delegate 호출 하나. 실시간 = brewai.team_member (시작 · 끝 upsert) + brewai.agent_step (팀원 도구 줄)
// · 기록 = delegate 도구 칸의 팀원 요약 (render_run). 팀원 사이 순서는 정해지지 않는다 → call id 로 upsert
// waiting_user = '내 확인 필요' (승인 카드 · slice 07 몫 · 지금은 자리만)
export type MemberStatus = 'waiting' | 'running' | 'done' | 'error' | 'cancelled' | 'waiting_user';
export type MemberTool = { name: string; label: string; app: string | null };
// 팀원 도구 줄: name = tool:<앱>__<도구> | app:<앱> · startedMs = 실행 시작부터 (서버) · at = 받은 때 (이 창 · 기록 = 0)
export type MemberStep = { id: string; name: string; label: string; app: string | null; status: StepStatus; startedMs: number; durationMs: number | null; at: number };
export type MemberUsage = { requests: number; input_tokens: number; output_tokens: number; tool_calls: number };
// code = 실패 이유 (member_timeout · member_limit · member_model_error · gateway_* · 거절된 호출 team_too_small · team_full)
// ms = 팀원이 걸린 시간 (끝 이벤트 · 기록엔 없음) · at = 일을 시작한 때 (이 창 · 기록 = 0)
export type TeamMember = {
  callId: string; agent: string; role: string; task: string; modelLabel: string; tools: MemberTool[]; status: MemberStatus;
  ms: number | null; code: string | null; usage: MemberUsage | null; steps: MemberStep[]; at: number;
};

// 답 아래 앱 카드 (ADR-0013 · slice 05 카드 A~D)
//   auth   = 연결 필요 (brewai.app_auth): mode ask = A (처음 한 번 묻기) · auto = B (바로 로그인 화면) · manual = C (연결된 앱에서)
//   import = 공유됐지만 안 가져온 앱 (brewai.app_needs_import) = D
// phase = 카드에서 한 일: idle → opening (브라우저 로그인 중) → resuming (이어서 하기 보냄) / failed (error = 문구 code) / stopped (그만두기)
// done = 이어서 하기가 끝남 (카드를 접는다)
export type CardPhase = 'idle' | 'opening' | 'failed' | 'stopped' | 'resuming' | 'done';
export type AuthCard = {
  kind: 'auth'; callId: string; server: AppServer; mode: AppAuthMode; reason: AppAuthReason; autoOpen: boolean; scope: string | null;
  write: boolean; label: string | null; // 멈춘 호출이 쓰기 도구 = 로그인 뒤 저절로 잇지 않는다 (무엇을 할지 보여 주고 누르게)
  phase: CardPhase; error: string | null;
};
export type ImportCard = { kind: 'import'; server: Pick<AppServer, 'id' | 'name' | 'domain'>; via: Via[] };
export type AppCard = AuthCard | ImportCard;

// sending = 보냈고 RUN_STARTED 전 · running = 흐르는 중 · stopped = 사용자가 멈춤
export type AnswerStatus = 'sending' | 'running' | 'done' | 'failed' | 'stopped';
export type Answer = {
  runId: string;
  status: AnswerStatus;
  failure: Failure | null;
  failureDetail: string | null; // RUN_ERROR.detail (copy.ts DETAIL)
  failureRaw?: string | null; // RUN_ERROR.provider_message = 거절 원문 (실패 카드에 그대로)
  parts: Part[];
  steps: Step[];
  model: ModelTag | null;
  reasoning: Reasoning;
  startedAt: number; // Date.now() (기록에서 연 답은 0)
  durationMs: number | null;
  usage: Usage;
  fromHistory: boolean;
  cards: AppCard[];
  team?: TeamMember[]; // 이 실행의 팀원 (delegate 를 부른 답만)
};
// resumed = 앱 연결 뒤 '이어서 하기' 실행 (질문 말풍선 없이 답만)
// resume = 이어서 하기로 다시 계산할 호출 id (이 창에서 보낸 것 · 다시 시도에도 그대로)
export type Turn = { id: string; ask: string; answer: Answer; resumed?: boolean; resume?: string; files?: FileItem[] }; // files = 이 턴 첨부 (내 말풍선 칩)
// path = 범위 경로 (서버 기록 · 이 창에서 막 시작한 대화는 그 스페이스 · 프로젝트의 경로) · scope = 어디 있고 누구 것인지
export type Conv = {
  id: string; title: string; path: ScopePath; scope: ThreadScope; turns: Turn[]; load: 'local' | 'loading' | 'ready' | 'error'; loadError: Failure | null;
};

export const isLive = (a: Answer) => a.status === 'sending' || a.status === 'running';
