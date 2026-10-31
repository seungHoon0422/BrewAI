#!/usr/bin/env node
// 가짜 LLM 게이트웨이 (LiteLLM 프록시 흉내) — E2E·로컬 테스트 전용. 의존성 없음 (Node 24 내장 모듈만).
// Playwright webServer 로 윈도우·맥 같은 명령으로 띄운다:
//   node e2e/mock/gateway.mjs --port 4010        (기본 127.0.0.1:4010)
// 환경변수:
//   FAKE_GATEWAY_KEY     Bearer 키 (기본 sk-fake-gateway). conductor 의 LLM_GATEWAY_KEY 와 같아야 한다
//   FAKE_GATEWAY_DELAY   스트림 조각 사이 지연 ms (기본 15)
//   FAKE_GATEWAY_RECORD  요청을 JSONL 로 남길 파일 (Authorization 은 가린다)
//   FAKE_GATEWAY_LATE    1 = 처음부터 '늦게 추가되는 모델'(fake-chat-late, gemini)도 카탈로그에 둔다
// 구현: GET /health/liveliness (인증 없음) · GET /model_group/info · GET /v1/models · POST /v1/chat/completions
//       (stream / non-stream, OpenAI chunk 형식, stream_options.include_usage). 답은 결정적인 한국어 문장.
//       답 끝에 ', 이전 질문: <앞 user 메시지>' (멀티턴: conductor 가 기록을 보냈는지 E2E 가 본다)
// 생각: 요청에 reasoning_effort 가 있으면 (생각 지원 모델만 — 아니면 LiteLLM 처럼 400) reasoning_content 조각을 먼저 흘린다.
//   Anthropic 모델 = LiteLLM 1.106.2 가 Claude thinking 을 바꾼 모양 그대로 (llms/anthropic/chat/handler.py):
//   thinking_delta → delta {content:"", reasoning_content, thinking_blocks:[{type:"thinking", thinking}], provider_specific_fields:{thinking_blocks}}
//   그 뒤 signature_delta → reasoning_content "" + thinking_blocks [{thinking:"", signature}] · usage.completion_tokens_details.reasoning_tokens
//   [fake:omitted] → 서명만 (display omitted · redacted 흉내: 생각은 했지만 글은 없음)
//   [fake:nothink] → reasoning_effort 가 있어도 생각 없이 바로 답 (adaptive 모델이 쉬운 질문에 생각을 건너뛴 흉내 · reasoning_tokens 0)
// 툴: 요청 tools 에 그 툴이 있을 때만 tool_calls 로 부른다 → 다음 요청(role tool 결과)에서 결과로 답한다 (OpenAI 왕복 그대로)
// Anthropic 생각 + 툴 (진짜 Anthropic · LiteLLM modify_params 없음): 생각이 켜진 요청에서 이번 질문 뒤 assistant tool_calls 가
//   서명된 thinking_blocks 없이 다시 오면 400 (실제 오류 문구 흉내). conductor 는 툴 결과를 들고 가는 요청에서 생각을 꺼야 한다
// 마지막 사용자 메시지에 넣는 표시: [fake:500] → 500 · [fake:cut] → 스트림 중간에 끊기 · [fake:slow] → 조각마다 250ms (중지 버튼 등)
//   실패 흉내 (LiteLLM 1.106.2 의 실제 status · type · 문구 — FAILURES 표): [fake:401] provider 키 없음 · [fake:key-invalid] provider 키 틀림
//   · [fake:gateway-key] 게이트웨이 키 틀림(DB 모드) · [fake:model-404] provider 에 없는 모델 · [fake:reasoning-400] 생각 파라미터 거절
//   · [fake:bad-request] provider 400 · [fake:openai-missing] OpenAI 키 없음(500 Missing credentials)
//   [fake:md] → 마크다운 답(제목 · 굵게 · 표 · 목록 · 코드 · 인용 · 링크)을 3글자씩 잘게 (흐르는 중 날것 문법이 안 보이는지 · chat-markdown.spec)
//   [fake:md-big] → 다른 마크다운 답을 120글자씩 크게 (큰 조각으로 보내는 provider 흉내: 첫 조각도 펼쳐지는지 · 칸 안 <br> · 줄 넘는 굵게)
//   [fake:think] → reasoning_effort 없이도 생각 조각 · [fake:system] → 답 끝에 ', 지침: <system 메시지 마지막 줄>' (프로젝트 지침이 모델까지 갔는지)
//   툴 (적은 순서대로 하나씩 부른다 · 요청 tools 에 있을 때만): [fake:skill <이름>] → use_skill · [fake:convert <값> <단위> <단위>] → unit_convert
//   · [fake:calc] <수식> → calculator (줄 끝까지가 수식, 없으면 12*(3+4)) · [fake:time] → current_time. 다 부르면 결과들로 답한다
//   병렬 (한 응답에 tool_calls 여럿 = conductor 가 동시에 돌린다): [fake:parallel] → current_time 서울 · 뉴욕 + unit_convert 68 F → C 를 한 번에
//   여러 단계 (한 응답에 하나씩 차례로): [fake:chain] → current_time → date_calc(오늘부터 12-25 까지) → use_skill meeting-prep → 답
// drop_params: 요청에 drop_params true 면 (LiteLLM 처럼) 모델이 지원 안 하는 reasoning_effort 를 400 대신 버린다
// 등록 출처: GET /v1/model/info (LiteLLM 모양: data[{model_name, litellm_params, model_info:{id, db_model, 가격}}]) — db_model true = 관리 화면(DB)
//   model_info 의 캐시 가격 (cache_read_input_token_cost · cache_creation_input_token_cost) = conductor 가 캐시 비용을 셈 (/model_group/info 에는 없다)
// 캐시 토큰 (usage · LiteLLM 모양, prompt_tokens 안에 들어 있다): Anthropic 모델 = 입력의 절반 읽기 + 4분의 1 쓰기
//   (prompt_tokens_details.cached_tokens · cache_read_input_tokens · cache_creation_input_tokens) · OpenAI 모델 = 입력의 30% 읽기 (cached_tokens 만)
//   [fake:cache-write] → OpenAI 모델도 입력의 4분의 1 을 캐시 쓰기로 (작은 모델은 쓰기 가격이 없다 = 관리자 사용량의 '어림' 흉내)
// 테스트 조작 (Bearer 필요): POST /__fake/catalog {"late": true|false, "hide": ["fake-chat-large"], "broken": {"<모델>": "<FAILURES 이름>"}, "reset": true}
//   → 카탈로그를 바꾼다 (새 모델 = 관리자 '후보', 숨긴 모델 = '사라짐', broken = 그 모델의 모든 채팅 호출이 그 실패). 응답 {"models": [id…]}
import http from 'node:http';
import fs from 'node:fs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const PORT = Number(arg('port', process.env.FAKE_GATEWAY_PORT ?? 4010));
const HOST = arg('host', process.env.FAKE_GATEWAY_HOST ?? '127.0.0.1');
const KEY = process.env.FAKE_GATEWAY_KEY ?? 'sk-fake-gateway';
const DELAY = Number(process.env.FAKE_GATEWAY_DELAY ?? 15);
const RECORD = process.env.FAKE_GATEWAY_RECORD ?? '';
const CREATED = 1761696000; // 고정 시각 → 응답이 매번 같다
const MAX_BODY = 1024 * 1024;

// LiteLLM 1.106.2 `GET /model_group/info` 의 data 항목 = 키 26개 (진짜 프록시 응답에서 확인한 모양). 값은 가짜.
const OPENAI_PARAMS = ['max_tokens', 'max_completion_tokens', 'stream', 'stream_options', 'temperature', 'tools', 'tool_choice'];
const group = (g) => ({
  model_group: g.id,
  providers: g.providers,
  max_input_tokens: g.maxIn ?? null,
  max_output_tokens: g.maxOut ?? null,
  input_cost_per_token: g.inCost ?? null,
  output_cost_per_token: g.outCost ?? null,
  input_cost_per_pixel: null,
  mode: g.mode ?? 'chat',
  tpm: null,
  rpm: null,
  itpm: null,
  otpm: null,
  supports_parallel_function_calling: false,
  supports_vision: g.vision ?? false,
  supports_web_search: false,
  supports_url_context: false,
  supports_reasoning: g.reasoning ?? false,
  supports_function_calling: g.tools ?? false,
  supports_fast_mode: false,
  supported_reasoning_efforts: null,
  supported_openai_params: g.mode === 'embedding' ? [] : OPENAI_PARAMS,
  configurable_clientside_auth_params: null,
  is_public_model_group: false,
  health_status: null,
  health_response_time: null,
  health_checked_at: null,
});
const BASE_GROUPS = [
  group({ id: 'fake-chat-small', providers: ['openai'], maxIn: 128000, maxOut: 16384, inCost: 1.5e-7, outCost: 6e-7, vision: true, tools: true }),
  group({ id: 'fake-chat-large', providers: ['anthropic'], maxIn: 200000, maxOut: 64000, inCost: 3e-6, outCost: 1.5e-5, vision: true, tools: true, reasoning: true }),
  group({ id: 'fake-embed', providers: ['openai'], maxIn: 8191, inCost: 2e-8, outCost: 0, mode: 'embedding' }), // 채팅 목록에서 빠져야 한다
];
// LiteLLM 에 나중에 등록되는 모델 (관리자 '후보' 흉내). provider = gemini → conductor 는 google 로 묶는다
const LATE_GROUP = group({ id: 'fake-chat-late', providers: ['gemini'], maxIn: 1000000, maxOut: 8192, inCost: 1e-7, outCost: 4e-7, tools: true });
// 캐시 가격 (USD/토큰 · /v1/model/info model_info). 작은 모델은 쓰기 가격 없음 (OpenAI 는 캐시 쓰기를 따로 받지 않는다) · late = 모름
const CACHE_PRICES = {
  'fake-chat-small': { cache_read_input_token_cost: 7.5e-8 },
  'fake-chat-large': { cache_read_input_token_cost: 3e-7, cache_creation_input_token_cost: 3.75e-6 },
};
// 관리 화면(DB)에서 추가한 모델 = db_model true. 나머지 = config.yaml
const DB_MODELS = new Set(['fake-chat-large', 'fake-chat-late']);
const catalog = { late: process.env.FAKE_GATEWAY_LATE === '1', hide: new Set(), broken: new Map() };

// LiteLLM 1.106.2 실패 모양 [status, type, message] (infra/litellm/.venv 소스로 확인). 키처럼 보이는 값은 가짜
const FAILURES = {
  '401': [401, 'authentication_error', 'litellm.AuthenticationError: Missing Anthropic API Key - A call is being made to anthropic but no key is set either in the environment variables or via params. Please set `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` in your environment vars'],
  'key-invalid': [401, 'authentication_error', 'litellm.AuthenticationError: AnthropicException - {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_fake0123456789abcdefghijklmn"}'],
  'gateway-key': [401, 'token_not_found_in_db', 'Authentication Error, Invalid proxy server token passed. Received API Key = sk-...fake, Key Hash (Token) =4c1f0e7b2d9a8f6e5d4c3b2a19087f6e5d4c3b2a19087f6e5d4c3b2a19087f6e. Unable to find token in cache or `LiteLLM_VerificationTokenTable`'],
  'model-404': [404, 'invalid_request_error', 'litellm.NotFoundError: AnthropicException - {"type":"error","error":{"type":"not_found_error","message":"model: claude-sonnet-9-9"}}'],
  'reasoning-400': [400, 'invalid_request_error', 'litellm.BadRequestError: AnthropicException - {"type":"error","error":{"type":"invalid_request_error","message":"thinking: this model does not support thinking"}}'],
  'bad-request': [400, 'invalid_request_error', 'litellm.BadRequestError: AnthropicException - {"type":"error","error":{"type":"invalid_request_error","message":"messages: text content blocks must be non-empty"}}'],
  'openai-missing': [500, 'internal_server_error', 'litellm.InternalServerError: OpenAIException - Missing credentials. Please pass an `api_key`, or set the `OPENAI_API_KEY` environment variable.'],
};
const failureIn = (question) => Object.keys(FAILURES).find((k) => question.includes(`[fake:${k}]`));
const modelGroups = () =>
  [...BASE_GROUPS, ...(catalog.late ? [LATE_GROUP] : [])].filter((m) => !catalog.hide.has(m.model_group));
const findGroup = (id) => modelGroups().find((m) => m.model_group === id);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function send(res, status, body, headers = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json',
    'content-length': Buffer.byteLength(text),
    ...headers,
  });
  res.end(text);
}

// LiteLLM 오류 모양: {"error": {"message", "type", "param", "code"}}
const error = (res, status, message, type, param = null) =>
  send(res, status, { error: { message, type, param, code: String(status) } });

function authorized(req) {
  const h = req.headers.authorization ?? '';
  return h === `Bearer ${KEY}`;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function record(req, body) {
  if (!RECORD) return;
  const headers = { ...req.headers };
  if (headers.authorization) headers.authorization = headers.authorization.replace(/Bearer\s+(.{4}).*/, 'Bearer $1***');
  fs.appendFileSync(RECORD, JSON.stringify({ method: req.method, url: req.url, headers, body }) + '\n');
}

// OpenAI 메시지 content 는 문자열 또는 [{type:'text', text}] 배열
const textOf = (content) =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((p) => (p && p.type === 'text' ? p.text : '')).join('')
      : '';

const userTexts = (messages) => messages.filter((m) => m?.role === 'user').map((m) => textOf(m.content));
const lastUserText = (messages) => userTexts(messages).at(-1) ?? '';
// system 메시지(들)의 마지막 글 줄 — conductor 는 프로젝트 지침을 시스템 프롬프트 맨 뒤에 붙인다
const systemTail = (messages) =>
  messages.filter((m) => m?.role === 'system').map((m) => textOf(m.content)).join('\n').split('\n').map((l) => l.trim()).filter(Boolean).at(-1) ?? '';

// 결정적인 답: 같은 대화 + 같은 모델 = 같은 답. 앞 질문이 있으면 끝에 붙인다 (멀티턴 확인)
function replyFor(model, messages) {
  const users = userTexts(messages);
  const question = users.at(-1) ?? '';
  const prev = users.length > 1 ? `, 이전 질문: ${users.at(-2).trim()}` : '';
  const system = question.includes('[fake:system]') ? `, 지침: ${systemTail(messages) || '(없음)'}` : '';
  return `안녕하세요! 가짜 게이트웨이(${model})가 답해요. 받은 질문: ${question.trim() || '(빈 메시지)'}${prev}${system}`;
}

const THOUGHT = '질문을 살펴보는 중이에요. 무엇을 묻는지 나눠 보고, 필요한 도구가 있는지 확인해요.';

// [fake:md] 답 — 블록 종류마다 하나씩 (코드 안에는 | · ** 를 넣지 않는다: 스펙이 화면 글에서 날것 기호를 찾는다)
const MD_REPLY = [
  '## 노트북 비교',
  '',
  '세 제품을 **무게**와 *배터리* 기준으로 비교했어요. 설치는 `npm ci` 로 해요.',
  '',
  '| 모델 | 무게 | 배터리 |',
  '| --- | ---: | :---: |',
  '| **A14** | 1.2kg | 18시간 |',
  '| B15 | 1.6kg | 12시간 |',
  '| C13 | 1.1kg | 15시간 |',
  '',
  '- 가장 가벼운 모델: C13',
  '- 배터리가 긴 모델: **A14**',
  '',
  '1. 무게를 먼저 봐요',
  '2. 그다음 배터리를 봐요',
  '',
  '> 실제 무게는 구성에 따라 달라요.',
  '',
  '```js',
  "const lightest = 'C13';",
  '```',
  '',
  '---',
  '',
  '자세한 내용은 [제조사 문서](https://example.com/laptops)를 보세요.',
].join('\n');

// [fake:md-big] 답 — 첫 조각(120글자)이 첫 문단을 거의 다 담는다 · 줄을 넘는 굵게 · 표 칸의 <br> · 인라인 코드 안 &lt;
const MD_BIG_REPLY = [
  '큰 조각으로 오는 답이에요. 게이트웨이가 한 번에 백스무 글자씩 보내도 첫 문단이 한꺼번에 떨어지지 않고 천천히 펼쳐져야 해요. 이 문장은 일부러 길게 썼어요.',
  '',
  '**두 줄에',
  '걸친 굵은 글**도 흐르는 중에 별표가 보이지 않아요.',
  '',
  '| 항목 | 설명 |',
  '| --- | --- |',
  '| 줄바꿈 | 첫 줄<br>둘째 줄 |',
  '| 코드 | `&lt;div&gt;` 는 글자 그대로 |',
  '',
  '끝이에요.',
].join('\n');

// 툴 결과(role tool) 하나 → 한 문장. content = conductor(Pydantic AI) 가 보낸 JSON 문자열
function sentenceFromTool(message) {
  let out;
  try {
    out = JSON.parse(textOf(message.content));
  } catch {
    out = { raw: textOf(message.content) };
  }
  if (out?.error) return `도구가 오류를 냈어요: ${out.message ?? out.error}`;
  if (out?.instructions !== undefined) return `스킬 '${out.label ?? out.name}' 지침을 따랐어요.`;
  if (out?.text !== undefined && out?.from_unit !== undefined) return `변환 결과는 ${out.text}예요.`;
  if (out?.result !== undefined) return `계산 결과는 ${out.result}예요. (수식 ${out.expression})`;
  if (out?.iso) return `지금은 ${out.date} ${out.time} ${out.weekday}이에요. (${out.timezone})`;
  if (out?.operation === 'diff') return `${out.to?.date}까지 ${out.days}일 남았어요.`;
  return `도구 결과를 받았어요: ${JSON.stringify(out)}`;
}

// 이번 질문 뒤 툴 결과들 → 답 (부른 순서대로)
function replyFromTools(messages) {
  const lastUser = messages.findLastIndex((m) => m?.role === 'user');
  return messages.slice(lastUser + 1).filter((m) => m?.role === 'tool').map(sentenceFromTool).join(' ');
}

// 마지막 user 메시지의 표시 → 차례(round) 목록. 차례 하나 = 모델 응답 하나의 tool_calls (여럿이면 병렬).
// 적은 순서대로 · 요청 tools 에 그 이름이 있는 툴만 (빈 차례는 뺀다)
function plannedRounds(body, question) {
  const offered = new Set((body.tools ?? []).map((t) => t?.function?.name).filter(Boolean));
  const found = [];
  const one = (at, name, args) => found.push({ at, calls: [{ name, args }] });
  for (const m of question.matchAll(/\[fake:skill\s+([a-z0-9-]+)\]/g)) one(m.index, 'use_skill', { name: m[1] });
  for (const m of question.matchAll(/\[fake:convert\s+([-\d.]+)\s+(\S+)\s+([^\]\s]+)\]/g)) {
    one(m.index, 'unit_convert', { value: Number(m[1]), from_unit: m[2], to_unit: m[3] });
  }
  const calc = question.match(/\[fake:calc\]\s*([^\n]*)/);
  if (calc) one(calc.index, 'calculator', { expression: calc[1].trim() || '12*(3+4)' });
  const time = question.indexOf('[fake:time]');
  if (time >= 0) one(time, 'current_time', { timezone: 'Asia/Seoul' });
  const parallel = question.indexOf('[fake:parallel]');
  if (parallel >= 0) {
    found.push({
      at: parallel,
      calls: [
        { name: 'current_time', args: { timezone: 'Asia/Seoul' } },
        { name: 'current_time', args: { timezone: 'America/New_York' } },
        { name: 'unit_convert', args: { value: 68, from_unit: 'F', to_unit: 'C' } },
      ],
    });
  }
  const chain = question.indexOf('[fake:chain]');
  if (chain >= 0) {
    one(chain, 'current_time', { timezone: 'Asia/Seoul' });
    one(chain + 0.1, 'date_calc', { operation: 'diff', date: 'today', other_date: '2026-12-25' });
    one(chain + 0.2, 'use_skill', { name: 'meeting-prep' });
  }
  return found
    .sort((x, y) => x.at - y.at)
    .map((r) => r.calls.filter((c) => offered.has(c.name)))
    .filter((calls) => calls.length > 0);
}

// 조각 나누기: 코드 포인트 기준 6글자씩 (한글이 깨지지 않게)
function chunks(text, size = 6) {
  const cps = Array.from(text);
  const out = [];
  for (let i = 0; i < cps.length; i += size) out.push(cps.slice(i, i + size).join(''));
  return out;
}

function usage(messages, reply, reasoning = 0, info = null, cacheWrite = false) {
  const prompt = messages.reduce((n, m) => n + Array.from(textOf(m?.content)).length, 0);
  const completion = Array.from(reply).length + reasoning;
  const out = { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion };
  if (reasoning) out.completion_tokens_details = { reasoning_tokens: reasoning };
  if (info?.providers.includes('anthropic')) {
    const read = Math.floor(prompt / 2);
    const write = Math.floor(prompt / 4);
    out.prompt_tokens_details = { cached_tokens: read };
    out.cache_read_input_tokens = read;
    out.cache_creation_input_tokens = write;
  } else if (info?.providers.includes('openai')) {
    out.prompt_tokens_details = { cached_tokens: Math.floor((prompt * 3) / 10) };
    if (cacheWrite) out.cache_creation_input_tokens = Math.floor(prompt / 4);
  }
  return out;
}

// LiteLLM 1.106.2 Anthropic thinking 조각 (handler.py _content_block_delta_helper → Delta)
const thinkingDelta = (text) => {
  const blocks = [{ type: 'thinking', thinking: text }];
  return { content: '', reasoning_content: text, thinking_blocks: blocks, provider_specific_fields: { thinking_blocks: blocks } };
};
const signatureDelta = () => {
  const blocks = [{ type: 'thinking', thinking: '', signature: 'EqQBCkYIBxgCKkBfakeSignatureForE2E==' }];
  return { content: '', reasoning_content: '', thinking_blocks: blocks, provider_specific_fields: { thinking_blocks: blocks } };
};

async function chatCompletions(req, res) {
  let body;
  try {
    body = await readJson(req);
  } catch {
    return error(res, 400, 'Invalid JSON body', 'invalid_request_error');
  }
  record(req, body);
  const model = body.model;
  const info = findGroup(model);
  if (!info) {
    return error(
      res,
      400,
      `Invalid model name passed in model=${model}. Call \`/v1/models\` to view available models for your key.`,
      'invalid_request_error',
      'model',
    );
  }
  if (info.mode !== 'chat') {
    return error(res, 400, `${model} is not a chat model`, 'invalid_request_error', 'model');
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const question = lastUserText(messages);
  if (question.includes('[fake:500]')) return error(res, 500, 'fake upstream failure', 'internal_server_error');
  const failure = catalog.broken.get(model) ?? failureIn(question);
  if (failure) {
    const [status, type, message] = FAILURES[failure];
    return error(res, status, message, type);
  }
  if (body.reasoning_effort !== undefined && !info.supports_reasoning && body.drop_params === true) {
    delete body.reasoning_effort; // LiteLLM drop_params: 지원 안 하는 파라미터는 버린다
  }
  if (body.reasoning_effort !== undefined && !info.supports_reasoning) {
    // LiteLLM drop_params 없음 = 지원 안 하는 파라미터는 400 (conductor 가 생각 미지원 모델엔 안 보내야 한다)
    return error(res, 400, `litellm.UnsupportedParamsError: ${model} does not support parameters: ['reasoning_effort']`, 'invalid_request_error');
  }

  if (body.reasoning_effort !== undefined && info.providers.includes('anthropic')) {
    const lastUser = messages.findLastIndex((m) => m?.role === 'user');
    const unsigned = messages
      .slice(lastUser + 1)
      .some((m) => m?.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0 && !m.thinking_blocks);
    if (unsigned) {
      return error(
        res,
        400,
        'litellm.BadRequestError: AnthropicException - messages.1.content.0.type: Expected `thinking` or `redacted_thinking`, but found `tool_use`. When `thinking` is enabled, a final `assistant` message must start with a thinking block.',
        'invalid_request_error',
      );
    }
  }

  const afterTool = messages.at(-1)?.role === 'tool';
  const lastUser = messages.findLastIndex((m) => m?.role === 'user');
  // 이번 질문에서 이미 지난 차례 수 = 툴을 부른 assistant 메시지 수
  const done = messages.slice(lastUser + 1).filter((m) => m?.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0).length;
  const calls = plannedRounds(body, question)[done] ?? [];
  const call = calls.length > 0;
  const thinking = !afterTool && !question.includes('[fake:nothink]') && (body.reasoning_effort !== undefined || question.includes('[fake:think]'));
  const anthropic = info.providers.includes('anthropic');
  const omitted = thinking && question.includes('[fake:omitted]');
  const reasoningTokens = thinking ? Array.from(THOUGHT).length : 0;
  const mdBig = question.includes('[fake:md-big]');
  const md = mdBig || question.includes('[fake:md]');
  const reply = call ? '' : afterTool ? replyFromTools(messages) : mdBig ? MD_BIG_REPLY : md ? MD_REPLY : replyFor(model, messages);
  // 차례 하나의 tool_calls (index 0, 1, …). id 는 대화 길이 + 순번 (첫 것은 예전 그대로 call_fake_<n>)
  const toolCalls = calls.map((c, i) => ({
    index: i, id: `call_fake_${messages.length}${i ? `_${i}` : ''}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) },
  }));
  const id = 'chatcmpl-fake';
  const base = { id, created: CREATED, model, system_fingerprint: null };
  const finish = call ? 'tool_calls' : 'stop';

  if (!body.stream) {
    const message = { role: 'assistant', content: call ? null : reply, tool_calls: call ? toolCalls.map(({ id: tid, type, function: fn }) => ({ id: tid, type, function: fn })) : null };
    if (thinking && !omitted) message.reasoning_content = THOUGHT;
    return send(res, 200, {
      ...base,
      object: 'chat.completion',
      choices: [{ index: 0, message, logprobs: null, finish_reason: finish }],
      usage: usage(messages, reply, reasoningTokens, info, question.includes('[fake:cache-write]')),
    });
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  const event = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const chunk = (delta, finish_reason = null) =>
    event({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta, logprobs: null, finish_reason }] });

  const delay = question.includes('[fake:slow]') ? 250 : DELAY;
  chunk({ role: 'assistant', content: '' });
  if (thinking) {
    // LiteLLM 은 Anthropic thinking 을 delta.reasoning_content 로 준다 (OpenAI 호환 확장) + thinking_blocks (서명은 끝 조각)
    for (const part of omitted ? [] : chunks(THOUGHT, 8)) {
      if (res.destroyed) return;
      await sleep(delay);
      chunk(anthropic ? thinkingDelta(part) : { reasoning_content: part });
    }
    if (anthropic) {
      await sleep(delay);
      chunk(signatureDelta());
    }
  }
  for (const tc of toolCalls) {
    // OpenAI 스트림 툴 호출: 첫 조각 = id · 이름, 다음 조각들 = arguments 이어 붙이기 (여럿이면 index 마다 차례로)
    await sleep(delay);
    chunk({ tool_calls: [{ index: tc.index, id: tc.id, type: 'function', function: { name: tc.function.name, arguments: '' } }] });
    for (const part of chunks(tc.function.arguments, 10)) {
      if (res.destroyed) return;
      await sleep(delay);
      chunk({ tool_calls: [{ index: tc.index, function: { arguments: part } }] });
    }
  }
  const parts = chunks(reply, mdBig ? 120 : md ? 3 : 6);
  for (const [i, part] of parts.entries()) {
    if (res.destroyed) return;
    if (i === 2 && question.includes('[fake:cut]')) return res.destroy(); // 중간 끊김
    await sleep(delay);
    chunk({ content: part });
  }
  chunk({}, finish);
  if (body.stream_options?.include_usage) {
    event({ ...base, object: 'chat.completion.chunk', choices: [], usage: usage(messages, reply, reasoningTokens, info, question.includes('[fake:cache-write]')) });
  }
  res.write('data: [DONE]\n\n');
  res.end();
}

// 테스트 조작: 카탈로그 바꾸기 (LiteLLM Admin UI 에서 모델을 추가·삭제한 것 흉내)
async function fakeCatalog(req, res) {
  let body;
  try {
    body = await readJson(req);
  } catch {
    return error(res, 400, 'Invalid JSON body', 'invalid_request_error');
  }
  if (body.reset) {
    catalog.late = process.env.FAKE_GATEWAY_LATE === '1';
    catalog.hide.clear();
    catalog.broken.clear();
  }
  if (typeof body.late === 'boolean') catalog.late = body.late;
  if (Array.isArray(body.hide)) catalog.hide = new Set(body.hide.filter((x) => typeof x === 'string'));
  if (body.broken && typeof body.broken === 'object') {
    catalog.broken = new Map(Object.entries(body.broken).filter(([, v]) => typeof v === 'string' && v in FAILURES));
  }
  return send(res, 200, { models: modelGroups().map((m) => m.model_group) });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const route = `${req.method} ${url.pathname}`;
  res.on('finish', () => console.error(`[fake-gateway] ${route} → ${res.statusCode}`));
  try {
    if (route === 'GET /health/liveliness' || route === 'GET /health/liveness') return send(res, 200, "I'm alive!");
    if (!authorized(req)) {
      return error(res, 401, 'Authentication Error, Invalid proxy server token passed.', 'auth_error', 'None');
    }
    if (route === 'GET /model_group/info') {
      record(req, null);
      const only = url.searchParams.get('model_group');
      return send(res, 200, { data: only ? modelGroups().filter((m) => m.model_group === only) : modelGroups() });
    }
    if (route === 'GET /v1/model/info' || route === 'GET /model/info') {
      // LiteLLM model_info_v1 모양 (키 · api_base 는 진짜 프록시도 지운다)
      return send(res, 200, {
        data: modelGroups().map((m) => ({
          model_name: m.model_group,
          litellm_params: { model: `${m.providers[0]}/${m.model_group}` },
          model_info: {
            id: `fake-${m.model_group}`, db_model: DB_MODELS.has(m.model_group), mode: m.mode,
            input_cost_per_token: m.input_cost_per_token, output_cost_per_token: m.output_cost_per_token, ...CACHE_PRICES[m.model_group],
          },
        })),
      });
    }
    if (route === 'GET /v1/models' || route === 'GET /models') {
      return send(res, 200, {
        data: modelGroups().map((m) => ({ id: m.model_group, object: 'model', created: 1677610602, owned_by: 'openai' })),
        object: 'list',
      });
    }
    if (route === 'POST /v1/chat/completions' || route === 'POST /chat/completions') return await chatCompletions(req, res);
    if (route === 'POST /__fake/catalog') return await fakeCatalog(req, res);
    return error(res, 404, `Not Found: ${route}`, 'not_found_error');
  } catch (e) {
    console.error('[fake-gateway] error', e);
    if (!res.headersSent) error(res, 500, 'fake gateway crashed', 'internal_server_error');
    else res.destroy();
  }
});

server.listen(PORT, HOST, () => console.error(`[fake-gateway] listening on http://${HOST}:${PORT} (key ${KEY.slice(0, 4)}***)`));
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    server.closeAllConnections(); // keep-alive 연결이 남아 있어도 바로 끈다
  });
}
