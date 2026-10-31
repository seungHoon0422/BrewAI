// 대화 상태의 모양 — 대화(Conv) › 턴(Turn: 질문 + 답) › 답(Answer: 조각 · 단계 · 모델). hooks · events · trace · 화면이 같이 본다.
import type { ScopePath } from '@brewai/ui';
import type { Failure, Reasoning } from '../../lib/api';
import type { Step, ThreadScope, Usage } from './api';

export type ModelTag = { id: string; label: string; provider: string; provider_label: string };

export type ReasoningPart = { kind: 'reasoning'; id: string; text: string; live: boolean; ms: number | null; at: number };
export type TextPart = { kind: 'text'; id: string; text: string };
export type ToolStatus = 'running' | 'done' | 'error' | 'cancelled';
// at = 부르기 시작(TOOL_CALL_START) · ms = 그때부터 결과까지 · ready = 인자를 다 받은 때(TOOL_CALL_END · 기록에서 연 답은 null)
// batch = 툴을 부른 모델 응답 번호 (같은 batch = 한 응답에서 같이 불려 동시에 돌았다 · 화면이 '동시에 n개' 로 묶는다)
export type ToolPart = {
  kind: 'tool'; id: string; name: string; label: string; argsText: string; args: unknown; result: unknown; status: ToolStatus; ms: number | null; at: number;
  ready: number | null; batch: number;
};
export type Part = ReasoningPart | TextPart | ToolPart;

// sending = 보냈고 RUN_STARTED 전 · running = 흐르는 중 · stopped = 사용자가 멈춤
export type AnswerStatus = 'sending' | 'running' | 'done' | 'failed' | 'stopped';
export type Answer = {
  runId: string;
  status: AnswerStatus;
  failure: Failure | null;
  failureDetail: string | null; // RUN_ERROR.detail (copy.ts DETAIL)
  parts: Part[];
  steps: Step[];
  model: ModelTag | null;
  reasoning: Reasoning;
  startedAt: number; // Date.now() (기록에서 연 답은 0)
  durationMs: number | null;
  usage: Usage;
  fromHistory: boolean;
};
export type Turn = { id: string; ask: string; answer: Answer };
// path = 범위 경로 (서버 기록 · 이 창에서 막 시작한 대화는 그 스페이스 · 프로젝트의 경로) · scope = 어디 있고 누구 것인지
export type Conv = {
  id: string; title: string; path: ScopePath; scope: ThreadScope; turns: Turn[]; load: 'local' | 'loading' | 'ready' | 'error'; loadError: Failure | null;
};

export const isLive = (a: Answer) => a.status === 'sending' || a.status === 'running';
