# ADR-0002 · 실행 루프는 Pydantic AI, MCP·승인은 코어가 직접

- 상태: 제안 · 2026-10-28
- 근거: 프레임워크 비교 워크플로(3개 관점 심사). 속도·장기 비전 관점 1위 Pydantic AI(9점), 표준·lock-in 관점은 자체 루프 9 > Pydantic AI 8.5.
  3개 관점 모두 "루프만 빌리고 MCP·승인은 코어가 직접" 하이브리드를 권장.
- 결정: 언어 = **Python** (UI·E2E 는 P1부터 TypeScript). 에이전트 루프 = **Pydantic AI 2.x** (MIT, OTel GenAI 네이티브, AG-UI 1st-party, deferred tool 승인, LiteLLMProvider).
  **MCP 연결·elicitation·OAuth는 공식 MCP Python SDK로 코어가 직접 소유**하고 툴셋으로 주입한다.
- 이유: 프레임워크 내장 MCP의 elicitation 지원이 제한적이고 런타임 서버 제거 API가 없다.
- 대안: Microsoft Agent Framework · Strands (교체 후보) / OpenAI Agents SDK(OTel 비네이티브, elicitation 없음) / Claude Agent SDK(Claude 전용) — 탈락.
  TypeScript 스택은 비교 범위 밖.
- 리스크: 릴리스가 매우 잦음 → 정확한 버전 고정 + `uv.lock` 커밋 + 4주 cool-down 때 일괄 업그레이드(보안 패치만 즉시). 프레임워크 의존은 `adapter` 한 파일에 격리.
- 주의: UI 승인은 권한 경계가 아님 → 대기 중 요청·승인 결과는 서버에서 세션에 묶어 재검증.
