# ADR-0003 · P1 스택: Docker 없이 Python + uv + Node

- 상태: 제안 · 2026-10-28 (UI 초안·Langfuse 확정 반영)
- 맥락: 현재 PC에 Python 3.13 + uv만 있음. Docker 없음. UI 초안(ADR-0005)과 Playwright 때문에 Node LTS는 P1에 설치.
- 결정 (P1 뼈대 관통 + UI 초안):

  | 층 | 선택 | 실행 방식 |
  |---|---|---|
  | LLM 게이트웨이 | LiteLLM proxy **1.106.2** (벤더 사고 공지 권장판, config.yaml, DB 없음) | `infra/litellm/` 전용 venv, `uv pip install --require-hashes` |
  | 에이전트 | Pydantic AI + FastAPI, AG-UI SSE | `uv run` |
  | 도구 | Python FastMCP (Streamable HTTP) — MCP 게이트웨이는 P3 | `uv run` |
  | 관측 | OTLP-HTTP → **Langfuse Cloud** (gRPC 미지원, `x-langfuse-ingestion-version: 4` 헤더) | SaaS |
  | UI | `apps/web` Vite + React (Codex 레퍼런스 3-pane, ADR-0005) | Node LTS |
  | E2E | Playwright `web` project + 게이트웨이 mock | Node LTS |

- trace 원천: P1은 **에이전트 span 하나**(Pydantic AI → Langfuse). LiteLLM 콜백은 끈다(이중 집계 방지).
- 리스크
  - LiteLLM: 2026년 악성 배포 2회(03월 1.82.7/1.82.8 PyPI, 10-21 1.107.0 PyPI + Docker Hub/GHCR latest 태그).
    1.106.3+ 는 벤더가 파이프라인 복구를 공지하고 게시 7일이 지난 뒤 cool-down 때 검토. 이미지는 digest 고정.
  - Langfuse Cloud로 프롬프트가 나감 → 개발 단계는 테스트 데이터만. 무료 50k units/월 → 샘플링.
- 이후: P2 관리자 콘솔·데스크톱·LiteLLM DB 모드(Postgres) · P3 MCP 게이트웨이 · P6 OTel Collector · MCP Apps sandbox.
