#!/usr/bin/env node
// 가짜 LLM 게이트웨이 (LiteLLM 프록시 흉내) — E2E·로컬 테스트 전용. 의존성 없음 (Node 24 내장 모듈만).
// Playwright webServer 로 윈도우·맥 같은 명령으로 띄운다:
//   node e2e/mock/gateway.mjs --port 4010        (기본 127.0.0.1:4010)
// 환경변수:
//   FAKE_GATEWAY_KEY     Bearer 키 (기본 sk-fake-gateway). conductor 의 LLM_GATEWAY_KEY 와 같아야 한다
//   FAKE_GATEWAY_DELAY   스트림 조각 사이 지연 ms (기본 15)
//   FAKE_GATEWAY_RECORD  요청을 JSONL 로 남길 파일 (Authorization 은 가린다)
// 구현: GET /health/liveliness (인증 없음) · GET /model_group/info · GET /v1/models · POST /v1/chat/completions
//       (stream / non-stream, OpenAI chunk 형식, stream_options.include_usage). 답은 결정적인 한국어 문장.
// 마지막 사용자 메시지에 넣는 표시: [fake:500] → 500 · [fake:401] → 401 (provider 키 없음 흉내) · [fake:cut] → 스트림 중간에 끊기 · [fake:slow] → 조각마다 250ms (중지 버튼 등)
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
const MODEL_GROUPS = [
  group({ id: 'fake-chat-small', providers: ['openai'], maxIn: 128000, maxOut: 16384, inCost: 1.5e-7, outCost: 6e-7, vision: true, tools: true }),
  group({ id: 'fake-chat-large', providers: ['anthropic'], maxIn: 200000, maxOut: 64000, inCost: 3e-6, outCost: 1.5e-5, vision: true, tools: true, reasoning: true }),
  group({ id: 'fake-embed', providers: ['openai'], maxIn: 8191, inCost: 2e-8, outCost: 0, mode: 'embedding' }), // 채팅 목록에서 빠져야 한다
];
const MODEL_IDS = new Set(MODEL_GROUPS.map((m) => m.model_group));

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

function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]?.role === 'user') return textOf(messages[i].content);
  return '';
}

// 결정적인 답: 같은 질문 + 같은 모델 = 같은 답
const replyFor = (model, question) => `안녕하세요! 가짜 게이트웨이(${model})가 답해요. 받은 질문: ${question.trim() || '(빈 메시지)'}`;

// 조각 나누기: 코드 포인트 기준 6글자씩 (한글이 깨지지 않게)
function chunks(text, size = 6) {
  const cps = Array.from(text);
  const out = [];
  for (let i = 0; i < cps.length; i += size) out.push(cps.slice(i, i + size).join(''));
  return out;
}

function usage(messages, reply) {
  const prompt = messages.reduce((n, m) => n + Array.from(textOf(m?.content)).length, 0);
  const completion = Array.from(reply).length;
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion };
}

async function chatCompletions(req, res) {
  let body;
  try {
    body = await readJson(req);
  } catch {
    return error(res, 400, 'Invalid JSON body', 'invalid_request_error');
  }
  record(req, body);
  const model = body.model;
  if (!MODEL_IDS.has(model)) {
    return error(
      res,
      400,
      `Invalid model name passed in model=${model}. Call \`/v1/models\` to view available models for your key.`,
      'invalid_request_error',
      'model',
    );
  }
  if (MODEL_GROUPS.find((m) => m.model_group === model).mode !== 'chat') {
    return error(res, 400, `${model} is not a chat model`, 'invalid_request_error', 'model');
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const question = lastUserText(messages);
  if (question.includes('[fake:500]')) return error(res, 500, 'fake upstream failure', 'internal_server_error');
  if (question.includes('[fake:401]')) return error(res, 401, 'AuthenticationError: fake missing provider key', 'auth_error');

  const reply = replyFor(model, question);
  const id = 'chatcmpl-fake';
  const base = { id, created: CREATED, model, system_fingerprint: null };

  if (!body.stream) {
    return send(res, 200, {
      ...base,
      object: 'chat.completion',
      choices: [
        { index: 0, message: { role: 'assistant', content: reply, tool_calls: null }, logprobs: null, finish_reason: 'stop' },
      ],
      usage: usage(messages, reply),
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

  chunk({ role: 'assistant', content: '' });
  const parts = chunks(reply);
  const delay = question.includes('[fake:slow]') ? 250 : DELAY;
  for (const [i, part] of parts.entries()) {
    if (res.destroyed) return;
    if (i === 2 && question.includes('[fake:cut]')) return res.destroy(); // 중간 끊김
    await sleep(delay);
    chunk({ content: part });
  }
  chunk({}, 'stop');
  if (body.stream_options?.include_usage) {
    event({ ...base, object: 'chat.completion.chunk', choices: [], usage: usage(messages, reply) });
  }
  res.write('data: [DONE]\n\n');
  res.end();
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
      return send(res, 200, { data: only ? MODEL_GROUPS.filter((m) => m.model_group === only) : MODEL_GROUPS });
    }
    if (route === 'GET /v1/models' || route === 'GET /models') {
      return send(res, 200, {
        data: MODEL_GROUPS.map((m) => ({ id: m.model_group, object: 'model', created: 1677610602, owned_by: 'openai' })),
        object: 'list',
      });
    }
    if (route === 'POST /v1/chat/completions' || route === 'POST /chat/completions') return await chatCompletions(req, res);
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
