import { Suspense } from "react";
import { NotesHistoryBoundary } from "../../_features/private-notes/NotesHistoryBoundary";
import { TransactionDetail } from "../../_features/transaction-workspace/TransactionWorkspace";

export default async function Detail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense fallback={<p role="status">Opening your transaction…</p>}>
      <NotesHistoryBoundary>
        <TransactionDetail key={id} id={id} />
      </NotesHistoryBoundary>
    </Suspense>
  );
}
