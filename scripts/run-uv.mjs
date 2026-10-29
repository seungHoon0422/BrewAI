// scripts/run-uv.mjs — uv 로 파이썬 서버를 띄우는 공통 부분. 셸 없이 spawn → 맥·윈도우 같은 방식.
// - 윈도우: spawn('uv') 가 PATH 에서 uv.exe 를 찾는다 (.cmd 래퍼가 아니라 진짜 exe 라 shell 필요 없음)
// - Ctrl+C: 터미널은 포그라운드 그룹 전체(node · uv · python)에 SIGINT 를 보낸다. 여기서 또 보내면 uvicorn 이
//   두 번째 SIGINT 를 '강제 종료'로 읽어 lifespan shutdown 을 건너뛴다 → SIGINT 는 1초 뒤 아직 살아 있을 때만 전달.
//   SIGTERM · SIGHUP 은 바로 uv 에 전달 (uv 가 python 에 넘긴다).
// - 윈도우 Ctrl+C 는 콘솔의 모든 프로세스가 받는다 → 아무것도 안 보내고 기다린다.
// - 10초 안에 안 꺼지면 강제 종료 (윈도우 taskkill /T /F · POSIX SIGKILL).
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';

export function runUv(name, args, { cwd, env = {}, drop = [] }) {
  // 기본값 < 셸 env < 이 스크립트가 강제하는 값. drop = 자식에게 절대 넘기지 않을 변수
  const childEnv = { UV_HTTP_TIMEOUT: '300', PYTHONUTF8: '1', ...process.env, ...env };
  // 대소문자 무시: 윈도우는 env 이름을 안 가리므로 litellm_license 같은 변형도 지운다
  const banned = new Set(drop.map((k) => k.toUpperCase()));
  for (const k of Object.keys(childEnv)) if (banned.has(k.toUpperCase())) delete childEnv[k];
  const child = spawn('uv', args, { cwd, stdio: 'inherit', env: childEnv, windowsHide: true, shell: false });
  child.on('error', (err) => {
    console.error(err.code === 'ENOENT' ? `[${name}] uv 를 찾지 못했어요 → README 1단계 (uv 0.13.5)` : `[${name}] ${err.message}`);
    process.exit(127);
  });
  let forced = null;
  const stop = (signal) => {
    if (process.platform !== 'win32') {
      if (signal !== 'SIGINT') child.kill(signal);
      // 터미널 Ctrl+C 면 자식도 이미 받았다 → 1초 뒤에도 살아 있으면(나만 받은 kill -INT) 그때 전달
      else setTimeout(() => child.exitCode === null && child.signalCode === null && child.kill('SIGINT'), 1000).unref();
    }
    forced ??= setTimeout(() => {
      console.error(`[${name}] 10초 안에 안 꺼져서 강제로 끕니다`);
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else child.kill('SIGKILL');
    }, 10_000).unref();
  };
  for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, () => stop(s));
  child.on('exit', (code, signal) => process.exit(code ?? 128 + (os.constants.signals[signal] ?? 1)));
  return child;
}
