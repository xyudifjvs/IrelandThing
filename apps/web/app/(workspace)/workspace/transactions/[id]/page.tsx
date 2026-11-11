"use client";

import { use } from "react";
import { TransactionDetail } from "../../_features/transaction-workspace/TransactionWorkspace";

export default function Detail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <TransactionDetail key={id} id={id} />;
}
