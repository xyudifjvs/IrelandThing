"use client";

import SavedIntakeDetails from "../../../../_components/SavedIntakeDetails";
import { useData } from "../../_components/data";
import type { Review } from "./review-model";

export function TransactionIntake({ matterId }: { matterId: string }) {
  const receipt = useData<Review["intake"]>(
    `/api/v1/creation-reviews/matter/${encodeURIComponent(matterId)}/intake`,
  );
  if (receipt.loading)
    return <p role="status">Opening the submitted intake…</p>;
  if (receipt.error)
    return (
      <p role="alert">
        {receipt.error}{" "}
        <button type="button" onClick={() => void receipt.refresh()}>
          Try again
        </button>
      </p>
    );
  if (!receipt.data)
    return <p>This transaction started without an agent intake.</p>;
  return (
    <SavedIntakeDetails
      value={receipt.data.snapshot}
      agent={receipt.data.agent}
      agentSource={receipt.data.agentSource}
      documents={receipt.data.documents}
    />
  );
}
