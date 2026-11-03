# ADR-0014 · 에이전트 팀 = 도구 하나(delegate)로 팀원을 부른다 · 게이트는 LLM 없이 · hello 는 그대로

- 상태: 확정 · 2026-11-03 (사용자: 팀원 = 이미 연결된 앱의 읽기 도구만 · 멈추기 = 실행 전체만 · sticky delegate 받아들임 · 패널은 처음 팀이 생기면 저절로 열림 + 대화별 닫기 기억)
- 맥락: P4-1 · P4-2 를 slice 06 으로 앞당김. 복합 요청은 팀원 2~3명이 동시에 하고 오른쪽 패널에 총괄 → 팀원 → 도구가 실시간으로 보여야 한다. 그런데 hello 요청은 바이트 · 토큰이 지금과 같아야 한다 (slice 05 토큰 다이어트).
- 결정
  - 모양: agent-as-tool. 총괄 도구 `delegate {role, task}` 를 한 응답에 2~3번 = 팀원 2~3명 (역할 · 할 일은 모델이 정함 · 사람이 미리 정의 안 함). 깊이 1 = 팀원에게 delegate · use_skill 없음. 실행당 3명 · 한 응답에 1번이면 `team_too_small`.
  - 게이트: `team.py offer_team` = LLM 없는 규칙표(복합 신호 · 진리표 테스트). 꺼지면 요청이 바이트까지 같다(골든 파일 테스트). 켜지면 약 100토큰 · 그 대화는 sticky(불렀거나 게이트가 켜진 질문이 기록에 있음) = 도구 배열 고정 = 캐시 · resume 같은 배열.
  - 팀원: 같은 모델(가격 한 줄) · 추론 끔 · 고정 지침 한 줄 + task 만(대화 기록 없음) · 자기 `RunUsage`(요청 4 · 입력 4만 = 총괄 8 을 못 깎음) · 90초(`asyncio.timeout` · ToolDefinition.timeout 은 커스텀 toolset 에서 안 지켜짐) · 도구 = ready 앱의 확실한 읽기 도구만(`Tool.read_only` · 정책 auto · 실패하면 닫힘) · 공개 장부 따로(`member_view`). 쓰기 · 로그인 카드는 총괄만(07).
  - 결과: 팀원당 4KB · `untrusted` 맨 앞(데이터이지 지시 아님) · 오류는 코드만(`member_timeout` · `member_limit` · `member_model_error` · `gateway_*`) · 한 팀원 실패는 그 결과만 error, 실행은 계속.
  - 이벤트: 팀이 있는 실행만 FIFO 큐 하나(pump 가 소비자 속도로 읽음) · 팀원 이벤트는 그 delegate 의 END 뒤 · RESULT 앞. CUSTOM `brewai.team_member` · `brewai.agent_step` · `brewai.run.team` 더하기만 = 새 HTTP 경로 없음.
  - 저장: store 그대로(SCHEMA_VERSION 4) · `runs.steps` 에 자식 줄 `{parent, agent}` + delegate `ToolReturn.metadata` → 다시 열어도 같은 트리. 팀원 대화 기록 · 새 audit 없음. usage_events 는 실행당 1줄(팀원 몫 더함). span `brewai.team.member` 만(08 Langfuse).
- 탈락: LLM 라우터로 팀 여부 판단(요청마다 왕복 · 토큰) · 팀원 역할 사전 정의 · 팀원마다 싼 모델(가격 줄 분리 · 나중) · 팀원 대화 저장 · 팀원 하나 멈추기(새 API · 나중) · delegate 를 도구 배열 맨 뒤(공개 순간 캐시 깨짐) · 팀원에게 쓰기 도구.
- 주의: delegate 설명은 98/100 토큰 = 여유 2. 문구를 늘리면 `TEAM_TOOL_EXTRA` 테스트가 깨진다. 팀원 결과 · 도구 설명은 데이터로만 다룬다.
- 재검토: 07 승인 카드(팀원 쓰기 · 로그인 올림) · 08 trace(P4-3 계층 일치) · 금요일 trace 에서 게이트 오탐 · 미탐이 보일 때.
