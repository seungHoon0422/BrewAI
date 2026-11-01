// node --test scripts/*.test.mjs — dev-all 이 원격 게이트웨이(ADR-0014)를 알아보는 규칙. 네트워크 없음
import assert from 'node:assert/strict';
import test from 'node:test';
import { gatewayTarget } from './gateway-target.mjs';

test('비어 있으면 로컬 기본값', () => {
  assert.equal(gatewayTarget(undefined).kind, 'default');
  assert.equal(gatewayTarget('  ').kind, 'default');
});

test('이 PC 주소 = local (로컬 스택 / venv 를 띄운다)', () => {
  for (const u of ['http://127.0.0.1:4000', 'http://localhost:4000/', 'http://[::1]:4000', 'http://127.0.0.2:4100'])
    assert.equal(gatewayTarget(u).kind, 'local', u);
});

test('원격 https = remote, 끝 / 는 뗀다', () => {
  assert.deepEqual(gatewayTarget(' https://129-146-1-2.sslip.io/ '), {
    kind: 'remote', url: 'https://129-146-1-2.sslip.io', https: true, insecure: false,
  });
});

test('공개 주소인데 http = insecure (conductor 가 거부)', () => {
  for (const u of ['http://129-146-1-2.sslip.io', 'http://129.146.1.2:4000', 'http://gw.example.com'])
    assert.equal(gatewayTarget(u).insecure, true, u);
});

test('사설망 · Docker 서비스 이름 http 는 원격이지만 허용', () => {
  for (const u of ['http://192.168.0.10:4000', 'http://10.0.0.5:4000', 'http://172.20.1.1:4000', 'http://litellm:4000']) {
    const t = gatewayTarget(u);
    assert.equal(t.kind, 'remote', u);
    assert.equal(t.insecure, false, u);
  }
  assert.equal(gatewayTarget('http://172.32.0.1:4000').insecure, true); // 172.16/12 밖
});

test('주소 모양이 아니면 invalid', () => {
  for (const u of ['129-146-1-2.sslip.io', 'ftp://gw.example.com', 'https://'])
    assert.equal(gatewayTarget(u).kind, 'invalid', u);
});
