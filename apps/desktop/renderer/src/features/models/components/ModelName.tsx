// 모델 이름 한 칸 = 회사 아이콘 · 이름 · (같은 이름의 다른 모델이 있으면) 게이트웨이 id. 답 아래 줄 · 진행 상황 · 설정이 같이 쓴다.
// 부르는 쪽이 감싸는 요소(.by · .mtag · .mval)와 툴팁을 정한다.
import { ProviderIcon, type IconSize } from '@brewai/ui';
import { useDupCheck } from '../hooks';

export type ModelRef = { id: string; label: string; provider: string };

export function ModelName({ model, size = 'md', showId = true }: { model: ModelRef; size?: Exclude<IconSize, 'xs'>; showId?: boolean }) {
  const dup = useDupCheck();
  return (
    <>
      <ProviderIcon provider={model.provider} size={size} />
      <span className="nm ui-ell">{model.label}</span>
      {showId && dup(model) && <span className="mid">{model.id}</span>}
    </>
  );
}
