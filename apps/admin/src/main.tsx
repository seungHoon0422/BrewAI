import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// 글꼴은 로컬 번들 (CDN 없음)
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './styles.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
