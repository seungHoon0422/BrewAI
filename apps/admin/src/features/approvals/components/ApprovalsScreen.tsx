import { EmptyTable } from '../../../shared/components/EmptyTable';
import { APPROVALS_COPY as C } from '../copy';

export default function ApprovalsScreen() {
  return (
    <EmptyTable label={C.table} cols={C.cols} icon="shield" title={C.empty}>
      {C.when}
    </EmptyTable>
  );
}
