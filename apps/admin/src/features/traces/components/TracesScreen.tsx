import { Button, Card, Chip, Toolbar } from '@brewai/ui';
import { EmptyTable } from '../../../shared/components/EmptyTable';
import { TRACES_COPY as C } from '../copy';
import '../traces.css';

// 트레이스 화면은 Langfuse 로 가는 입구다. 여기에 trace 를 복제해 두지 않는다
export default function TracesScreen() {
  return (
    <div className="traces">
      <Card padding="md" className="traces-about">
        <p>{C.about.map((t, i) => (i % 2 ? <code key={i}>{t}</code> : t))}</p>
        <div className="traces-open">
          <Button icon="external" disabled>{C.open}</Button>
          <span className="traces-hint">{C.later}</span>
        </div>
      </Card>
      <Toolbar label={C.filters}>
        <span className="traces-hint">{C.filters}</span>
        {C.filterKeys.map((k) => (
          <Chip key={k} icon="plus" className="traces-key" disabled>{k}</Chip>
        ))}
      </Toolbar>
      <EmptyTable label={C.table} cols={C.cols} icon="waterfall" title={C.empty}>
        {C.when}
      </EmptyTable>
    </div>
  );
}
