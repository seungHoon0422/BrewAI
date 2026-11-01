// scripts/gateway-target.mjs — LLM_GATEWAY_URL 이 이 PC 안인지, 원격 서버(ADR-0014)인지 본다. dev-all 이 쓴다 (의존성 없음)
// default = 비어 있음 → 로컬 (http://127.0.0.1:4000)
// local   = 127.0.0.1 · localhost · ::1 → 로컬 Docker 스택 / venv 게이트웨이를 띄운다
// remote  = 그 밖 → 아무것도 띄우지 않고 그 주소를 쓴다. insecure = 공개 주소인데 http (conductor 가 거부 · settings.gateway_url 과 같은 규칙)
// invalid = 주소 모양이 아님

function privateHost(host) {
  if (host === 'localhost' || (!host.includes('.') && !host.includes(':'))) return true; // 점 없는 이름 = Docker 서비스 이름 등
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  return host === '::1' || /^f[cd][0-9a-f]{0,2}:/i.test(host) || /^fe[89ab][0-9a-f]?:/i.test(host);
}

export function gatewayTarget(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { kind: 'default' };
  let u;
  try {
    u = new URL(text);
  } catch {
    return { kind: 'invalid', url: text };
  }
  if (!['http:', 'https:'].includes(u.protocol) || !u.hostname) return { kind: 'invalid', url: text };
  const url = text.replace(/\/+$/, '');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || /^127\.\d+\.\d+\.\d+$/.test(host)) return { kind: 'local', url };
  return { kind: 'remote', url, https: u.protocol === 'https:', insecure: u.protocol === 'http:' && !privateHost(host) };
}
