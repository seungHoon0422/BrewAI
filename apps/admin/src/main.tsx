import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// 글꼴은 로컬 번들 (CDN 없음) → 공용 토큰 · 기본 · 부품 CSS (ADR-0012) → 틀 CSS. 기능 CSS 는 각 화면이 불러온다
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import '@brewai/ui/styles.css';
import './app/app.css';
import App from './app/App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
