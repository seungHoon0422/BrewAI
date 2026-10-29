# ADR-0009 · 로컬 스택 = Docker Compose (기본 LiteLLM · trace 때 Langfuse 셀프호스트)

- 상태: 확정 · 2026-10-29 (사용자 결정) · **ADR-0003 의 "Docker 없이"·관측(Langfuse Cloud) 행, ADR-0006 의 "개발은 Cloud" 문장을 대체**
- 맥락: Langfuse Cloud 는 사용량 요금 · 프롬프트 국외 전송. 두 PC 모두 Docker Desktop. 사용자: "Compose(쿠버네티스 아님) · 가볍게 · 한 번에 · Cloud 안 씀".
- 결정
  - `infra/compose.yaml` 하나. 기본 = LiteLLM 1.106.2(non_root) + 전용 Postgres 17.10 `litellm-db` (`npm run stack`). profile `trace` = Langfuse **4.67.0** web·worker + Postgres 17.10 · ClickHouse 26.4.5.143 · Redis 7.2.16 · MinIO (`npm run stack:trace`).
  - 컨테이너마다 `mem_limit` (trace 묶음 합 ~2.4 GiB · LiteLLM 896m + DB 160m, 상시 ~630 MiB). 호스트 포트는 127.0.0.1 에만: 4000 · 3000 · 9090. 바인드 마운트는 `infra/litellm/config.yaml:ro` 하나.
  - `npm run dev`·start 파일: Docker 가 켜져 있으면 스택 LiteLLM(`.env` 의 `BREWAI_TRACE=1` 이면 Langfuse 도) → conductor → 데스크톱 → 관리자. Docker 가 없거나 꺼져 있으면 venv 게이트웨이로 대체(한국어 안내). Ctrl+C 뒤에도 스택은 남는다 (`restart: unless-stopped` → Docker Desktop 을 다시 켜도 뜬다 · 끄기 = `npm run stack:down`).
  - `scripts/stack.mjs`: Docker 확인 → `.env` 에 없는 비밀값만 만듦(값은 안 찍음) → `up -d --wait`. 종료 코드 3 = Docker 없음.
  - 이미지는 모두 tag@sha256(멀티 아키텍처 index · MinIO 는 digest 만: Chainguard 무료는 :latest 뿐) · 게시 7일 지난 것만 · floating 태그(latest·main-*) 금지.
  - LiteLLM: read_only · cap_drop ALL · no-new-privileges · 원격 호출 끔 · 콜백 끔(trace 소유 = conductor) · `LITELLM_LICENSE` 금지(GHSA-w4c7).
  - 2026-10-29 추가 (사용자 결정, 집 윈도우 "Not connected to DB!"): LiteLLM **DB 모드** (`STORE_MODEL_IN_DB`) = 관리 화면 `/ui` 로그인 · 모델은 `config.yaml` + UI 에서 등록(ADR-0008 "config.yaml 에서만" 대체) · conductor 가 `/model_group/info` 로 가져와 노출만 정함. `LITELLM_DB_PASSWORD`·`LITELLM_SALT_KEY` 는 stack.mjs 가 만듦 · SALT 는 바꾸지 않음(DB 가 있는데 없으면 stack 이 멈춤).
  - Langfuse: 텔레메트리·가입 끔 · 처음 뜰 때 org/project/user/key 자동 생성(키 = `.env`) · OTLP/HTTP `127.0.0.1:3000/api/public/otel`.
  - venv LiteLLM(`npm run gateway`)은 대체 경로로 남긴다. E2E 는 Docker 없이 Node mock 게이트웨이 그대로.
- v3 가 아니라 v4.67.0: v3 는 2027-01 까지 보안 패치만. v4 는 `GET /api/public/traces` 가 없음 → `/api/public/v2/observations`. 4.68.0 은 게시 7일 전.
- 리스크: Docker 메모리 4~6 GB 권장 · 이미지 ~1.5 GB/PC · LiteLLM 이미지 서명 없음(provenance·빌드 시각·IOC 로 판정) · Chainguard 예전 digest 보장 없음(대체 SeaweedFS) · 첫 기동 뒤 Langfuse 키·SALT 를 바꾸려면 `stack:reset -- --yes`.
- 이후: 1.106.5 는 2026-11-03 부터(이미지 digest + venv lock 같이) · trace 연결은 slice 03 · virtual key·쿠버네티스는 P2 검토.
