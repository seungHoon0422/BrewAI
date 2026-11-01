# ADR-0014 · 게이트웨이 서버 = Oracle 무료 VM 1대 (LiteLLM + Postgres + Caddy · 공개 https)

- 상태: 확정 · 2026-11-01 (사용자: "무료로 공개주소를 쓸수있다면 그렇게하는게 나을거같은데?" → Oracle 무료 서버 선택)
- 맥락: PC 마다 로컬 스택(ADR-0009)이면 모델 · provider 키를 두 번 등록하고 두 PC 결과가 다르다. 무료 + 공개 주소 + 두 PC 공용이 필요.
- 결정
  - 서버: Oracle Always Free **Ampere A1 2 OCPU / 12 GB** · Ubuntu 24.04 (arm64). 주소 = `https://<IP-대시>.sslip.io` (무료 DNS) · Caddy 자동 https(Let's Encrypt) · `DOMAIN` 으로 내 도메인 대체.
  - `infra/deploy/`: compose(LiteLLM 1.106.2 + Postgres 17.10 + Caddy 2.11.7) · `bootstrap.sh`(Docker 공식 apt · swap · Oracle iptables 80/443 · `/opt/brewai/.env` root 600) · `deploy.sh` · `backup.sh`(매일 pg_dump 7개). `infra/litellm/config.yaml` 은 마운트(복사본 없음 · mock · 콜백 끔 ADR-0003).
  - 배포: `deploy-gateway.yml` = develop push(infra/deploy · infra/litellm) · ssh + rsync → `deploy.sh` → https 확인 + 공개 범위 확인. GitHub 엔 SSH 4개(`DEPLOY_HOST` · `USER` · `SSH_KEY` · `KNOWN_HOSTS`)만, 없으면 건너뜀.
  - PC: conductor 만 `.env` 의 `LLM_GATEWAY_URL`(https) + `LITELLM_MASTER_KEY` 를 읽는다. 데스크톱은 키 없음(AGENTS.md). `npm run dev` 는 원격 주소면 로컬 게이트웨이를 안 띄운다. conductor 는 공개 주소의 http 를 거부(키 평문 방지).
- 보안 원칙
  - master key 필수(bootstrap 이 `sk-`+64hex 생성). 비밀값은 서버 `.env` 에만 · 화면 · 로그 · GitHub 에 0. `LITELLM_LICENSE` 금지(deploy.sh 거부).
  - 공개 = conductor 가 쓰는 4경로(`/v1/chat/completions` · `/model_group/info` · `/v1/model/info` · `/health/liveliness`), 그것도 master key. `/ui` · 관리 API = Caddy basic auth(bcrypt) 로 받은 게이트 쿠키 뒤 + LiteLLM 로그인. docs · openapi · metrics = 404. 본문 16 MB · 보안 헤더 · 로그에 Authorization/Cookie 없음.
  - 쿠키인 이유: `/ui` 는 자기 `Authorization: Bearer` 로 API 를 불러 경로마다 basic auth 를 걸면 화면이 깨진다.
  - Postgres · LiteLLM 은 호스트에 안 열림(Caddy 만 80/443). 이미지 tag@sha256 · 멀티 아키텍처(arm64 확인) · 게시 7일 지난 것.
  - **`LITELLM_SALT_KEY` 는 절대 안 바꾼다.** 새 서버 = 새 DB(모델 /ui 재등록) 또는 같은 SALT + pg_dump 복원. bootstrap 은 DB 가 있는데 SALT 가 없으면 멈춘다.
- 탈락: Tailscale 사설망(회사 맥 설치 불확실 · 두 PC 모두 클라이언트 필요 · 사용자가 공개 주소 선택) · Cloud Run(무료 한도 밖 DB 비용) · Cloudflare Tunnel(도메인 · 계정 하나 더) · Fly/Render 무료(DB 유료 · 잠듦) · 관리 화면 SSH 터널 전용(두 PC 매번 터널) · 경로마다 basic auth(/ui 깨짐).
- 리스크: Oracle 이 한가한 Always Free VM 회수 가능(→ Pay As You Go 전환, 한도 안 0원) · A1 "Out of capacity" · 자동 업데이트는 Ubuntu 보안 패키지만 → Docker 엔진 · 커널 재부팅은 매달 손으로(README 서버 명령) · 배포 키 = 서버 root → GitHub Environment `gateway`(develop 만) 시크릿 · `/brewai-admin` bcrypt 요청이 CPU 를 먹는 DoS 는 감수(cost 10) · sslip.io 장애 시 내 도메인으로.
