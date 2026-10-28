# ADR-0001 · 코어 4개만 만들고 나머지는 빌린다

- 상태: 제안 · 2026-10-28 (팀 구성 추가)
- 맥락: 혼자 개발. 게이트웨이·관측·레지스트리·UI까지 다 만들면 진도가 안 나간다.
- 결정: 직접 만드는 건 **conductor 코어 4개**뿐
  ① 능력 찾기·설치(capability resolver) ② 승인·정책(policy/approval)
  ③ Skill 작성·저장소(격리 → 테스트 → 승인 → 활성) ④ 팀 구성(서브에이전트 자동 편성 + 활동 이벤트).
  실행 루프는 ADR-0002대로 빌리고 연결부(adapter)만 소유.
  나머지는 표준·기성품: LLM 게이트웨이(LiteLLM) · 관측(Langfuse) · 도구 규격(MCP, Agent Skills) · UI 규격(AG-UI, MCP Apps) · UI 부품(shadcn/ui, assistant-ui, React Flow).
- 경계 규칙: 부품 사이는 OpenAI 호환 API · MCP · OTLP(표준)와 AG-UI(사실상 표준, CopilotKit 주도)로만 연결.
  AG-UI는 내부 이벤트 모델과 어댑터를 분리해 둔다. OTel GenAI semconv는 아직 Development → 버전 고정.
- 재검토: 기성품이 핵심 시나리오를 2주 이상 막을 때.
