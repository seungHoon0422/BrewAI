// 로그인 화면 아래 한 줄 — '서버 127.0.0.1:8787 ● 연결됨' · 꺼져 있으면 [다시 시도]
import { Button, StatusDot } from '@brewai/ui';
import { AUTH } from '../copy';
import { retryServer, useAuth } from '../hooks';

export function ServerStatus() {
  const server = useAuth((s) => s.server);
  const state = server.status === 'ok' ? 'ok' : server.status === 'offline' ? 'fail' : 'wait';
  const text = server.status === 'ok' ? AUTH.serverOk : server.status === 'offline' ? AUTH.serverDown : AUTH.serverChecking;
  return (
    <p className="auth-server" role="status">
      {server.host && <span>{AUTH.server(server.host)}</span>}
      <StatusDot state={state} size="sm" />
      <span>{text}</span>
      {server.status === 'offline' && <Button size="sm" variant="ghost" onClick={() => void retryServer()}>{AUTH.retry}</Button>}
    </p>
  );
}
