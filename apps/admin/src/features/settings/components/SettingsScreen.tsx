import { KeyValue } from '@brewai/ui';
import { SETTINGS_ROWS } from '../copy';

// 출처 글의 두 번째 조각 = 설정 키 이름 (코드 글꼴)
export default function SettingsScreen() {
  return (
    <KeyValue
      items={SETTINGS_ROWS.map((r) => ({
        key: r.key,
        label: r.label,
        value: r.value,
        aside: r.from.map((t, i) => (i % 2 ? <code key={i}>{t}</code> : t)),
      }))}
    />
  );
}
