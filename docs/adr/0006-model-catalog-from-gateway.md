# ADR-0006 · 모델은 게이트웨이에서 가져온다 (등록 금지) · trace는 Langfuse

- 상태: 제안 · 2026-10-28
- 원칙: 모델의 원본은 **LLM 게이트웨이**. 우리 서비스는 "어떤 모델을 누구에게 어떤 이름으로 보여줄지"만 정한다.
  가격·컨텍스트·provider·endpoint를 입력하는 화면이나 API는 만들지 않는다. 보정이 필요하면 게이트웨이의 model_info에서.
- 게이트웨이 = **LiteLLM** (확정). `GET /model_group/info` 가 가격·컨텍스트·기능 플래그를 준다.
  agentgateway는 `/v1/models` 에 가격이 없어 후순위 (adapter만 열어둠).
- 구조
  - `GatewayCatalogPort.list_models()` → 정규화된 모델 목록 (LiteLLMAdapter 우선)
  - DB: `gateway_model`(캐시, present/missing) · `model_exposure`(관리자 소유: 표시 이름·순서·켜짐·기본값) · `model_exposure_group` · `catalog_sync_run`
  - 새 모델은 '후보'로만 뜨고 기본 숨김. 게이트웨이에서 사라지면 missing 표시 후 자동 숨김.
- 키: P1 로컬은 config-only(master key, 개발 PC만). P2부터 Postgres + 서비스 전용 virtual key `svc-runtime` (카탈로그 읽기 = 호출 가능 목록과 일치).
- LiteLLM 1.106.2 주의: `LITELLM_LOCAL_MODEL_COST_MAP=True` (원격 가격표 실패 시 기동 오류 회피) → 가격은 그 시점 스냅샷.
  `/model_group/info` 응답을 contract test fixture로 고정해 업그레이드 때 깨짐을 잡는다.
- Langfuse: 모든 span에 `user.id` · `session.id` 전파 · 관리자 콘솔에서 trace 딥링크. trace 소유는 한쪽만(P1 에이전트, 게이트웨이 콜백 끔).
  Cloud에는 한국 리전이 없음 → 개발은 Cloud(JP 리전 추천), 일반 사용자 출시 전 국외이전·마스킹(`mask_otel_spans`) 검토.
