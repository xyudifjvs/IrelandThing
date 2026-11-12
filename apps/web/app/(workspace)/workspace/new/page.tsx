import { Suspense } from "react";
import CreationEntry from "../_features/creation/CreationEntry";

export default function Page() {
  return (
    <Suspense fallback={<p role="status">Opening the review…</p>}>
      <CreationEntry />
    </Suspense>
  );
}
