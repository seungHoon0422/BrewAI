// 설정 — 테마(시스템 따름) · 기본 모델(허용된 모델만) · 앱 정보
import { useSyncExternalStore } from 'react';
import { Icon } from '../icons';
import { Page, Section } from './Page';

const dark = matchMedia('(prefers-color-scheme: dark)');

function onScheme(change: () => void) {
  dark.addEventListener('change', change);
  return () => dark.removeEventListener('change', change);
}

function runtime() {
  const ua = navigator.userAgent;
  const os = /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  const shell = ua.includes('Electron/') ? '데스크톱' : '브라우저';
  const build = import.meta.env.DEV ? '개발 서버' : '로컬 빌드';
  return [os, shell, build].filter(Boolean).join(' · ');
}

export function Settings() {
  const isDark = useSyncExternalStore(onScheme, () => dark.matches);
  return (
    <Page id="settings" sub="이 기기의 BrewAI 설정이에요.">
      <Section title="일반">
        <ul className="rows">
          <li className="row">
            <span className="row-main">
              <b>테마</b>
              <span className="row-sub">시스템 설정을 따라요</span>
            </span>
            <span className="val">시스템 따름 · 지금 {isDark ? '다크' : '라이트'}</span>
          </li>
        </ul>
      </Section>
      <Section title="모델">
        <ul className="rows">
          <li className="row">
            <span className="row-main">
              <b>기본 모델</b>
              <span className="row-sub">허용된 모델 중에서만 고를 수 있어요</span>
            </span>
            <button className="select" type="button" disabled title="서버 연결 후 고를 수 있어요">
              서버 연결 후<Icon name="down" small />
            </button>
          </li>
        </ul>
      </Section>
      <Section title="앱 정보">
        <ul className="rows">
          <li className="row">
            <span className="row-main"><b>버전</b></span>
            <span className="val">{__APP_VERSION__}</span>
          </li>
          <li className="row">
            <span className="row-main"><b>실행 환경</b></span>
            <span className="val">{runtime()}</span>
          </li>
        </ul>
      </Section>
    </Page>
  );
}
