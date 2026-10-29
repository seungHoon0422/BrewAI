# ADR-0008 · 관리자 콘솔 '문서' 메뉴 + 모델 연동(LiteLLM) 먼저

- 상태: 확정 · 2026-10-29 (사용자 결정)
- 맥락: 사용자: "docs 메뉴 하나 만들어서 진행 현황 · 아키텍처 · 시스템 구성을 확인" · "기본적인 모델 연동부터 — LiteLLM 프록시로 등록하기로 했잖아".
- 결정
  - 관리자 콘솔 8번째 메뉴 **문서** (`#/docs`): 진행 현황 · 아키텍처 · 구성 · 결정 기록 · 보고서.
    레포 파일(roadmap · HANDOFF · ADR · slices · package.json · lock)을 빌드 때 읽는다 → 새 문서 없음, 개발 중엔 고치면 바로 반영.
    사용자 앱(데스크톱 · 웹)에는 넣지 않는다 (AGENTS.md 경계).
  - slice 순서: 02 = **모델 연동** (LiteLLM 게이트웨이 → conductor 최소 API → 관리자 '모델' 목록 · 데스크톱 대화 답) ·
    03 = MCP 툴 1개 + Langfuse trace · 04 = 승인 카드 + CI E2E + eval 3건.
  - 모델 등록은 `infra/litellm/config.yaml` 에서만. 키 없는 mock 모델 하나 + provider 는 `.env` 키로.
    회사 게이트웨이를 쓰게 되면 `LLM_GATEWAY_URL` · 키만 바꾼다 → 결정 대기 ①(모델 키) 해소.
- roadmap 에서 바뀐 것: P1-5 관리자 7 → 8개 메뉴(문서) · P1 slice_hint 02~04. 옛 문구는 git 이력.
- 재검토: 관리자 콘솔이 별도 배포·인증(P2-3)될 때 문서 메뉴를 개발 빌드 전용으로 뺄지.
