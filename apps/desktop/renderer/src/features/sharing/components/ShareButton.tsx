// 대화 머리 [공유] — 팝오버 안 스위치 하나 ('이 스페이스 멤버에게 보이기'). 내 스페이스 · 남의 대화엔 부르는 쪽이 그리지 않는다.
// 값 · 저장은 부르는 쪽이 쥔다 (onChange 가 실패하면 throw → 한 줄 안내)
import { useState } from 'react';
import { Button, Popover, Switch } from '@brewai/ui';
import { SHARE } from '../copy';

export function ShareButton({ shared, onChange }: { shared: boolean; onChange: (shared: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const toggle = async (next: boolean) => {
    setBusy(true);
    setFailed(false);
    try {
      await onChange(next);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Popover label={SHARE.title} placement="bottom-end" width={280}
      trigger={(t) => (
        <Button {...t} size="sm" variant={shared ? 'secondary' : 'ghost'} icon={shared ? 'people' : 'lock'}>
          {shared ? SHARE.shared : SHARE.button}
        </Button>
      )}>
      <div className="share">
        <Switch checked={shared} onCheckedChange={(v) => void toggle(v)} label={SHARE.toggle} disabled={busy} />
        <p className="share-note" role="status">{failed ? SHARE.failed : shared ? SHARE.on : SHARE.off}</p>
      </div>
    </Popover>
  );
}
