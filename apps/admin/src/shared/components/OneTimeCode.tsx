import { useState, type ReactNode } from 'react';
import { Button } from '@brewai/ui';
import { COMMON_COPY } from '../copy';
import './one-time-code.css';

const C = COMMON_COPY.code;

// 한 번만 보이는 코드 (초대 코드 · 재설정 코드). 서버는 sha256 만 갖고 있어 다시 보여 줄 수 없다
export function OneTimeCode({ code, label, children }: { code: string; label: string; children?: ReactNode }) {
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const copy = () =>
    navigator.clipboard.writeText(code).then(
      () => setCopied('ok'),
      () => setCopied('fail'),
    );
  return (
    <div className="otc">
      <div className="otc-row">
        <output className="otc-code" aria-label={label}>{code}</output>
        <Button icon={copied === 'ok' ? 'check' : 'copy'} onClick={() => void copy()}>{copied === 'ok' ? C.copied : C.copy}</Button>
      </div>
      {copied === 'fail' && <p className="otc-fail" role="alert">{C.copyFailed}</p>}
      {children}
      <p className="otc-note">{C.once}</p>
    </div>
  );
}
