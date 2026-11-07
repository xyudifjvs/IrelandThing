"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import {
  useData,
  mutate,
  type Matter,
  type Session,
} from "../../../_components/data";
import InitialFileReview from "../../../_components/InitialFileReview";
import ReviewQueue from "../../../_components/ReviewQueue";
import DocumentFiles from "../../../_components/DocumentFiles";
import { useTransactionDocumentUploads } from "../../../../../_components/useTransactionDocumentUploads";
import s from "../../../_components/workspace.module.css";
type Contract = {
  id: string;
  name: string;
  category: string;
  versions: { processingStatus: string }[];
};
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Setup key={id} id={id} />;
}
function Setup({ id }: { id: string }) {
  const matter = useData<Matter>(`/api/v1/matters/${id}`),
    session = useData<Session>("/api/v1/session");
  const docs = useData<Contract[]>(`/api/v1/documents?matterId=${id}`);
  const [selected, setSelected] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [reviewKey, setReviewKey] = useState(0);
  const uploads = useTransactionDocumentUploads({
    matterId: id,
    coordinator: true,
    actorId: session.data?.user?.id,
    authorized: !!matter.data && session.data?.user?.role === "coordinator",
  });
  useEffect(
    () => uploads.registerRefresh(docs.refresh),
    [uploads.registerRefresh, docs.refresh],
  );
  const contracts = [...(docs.data || [])].sort(
    (a, b) =>
      Number(b.category === "contract") - Number(a.category === "contract"),
  );
  if (!matter.data)
    return (
      <p className={matter.error ? s.error : s.loading}>
        {matter.error || "Opening transaction…"}
      </p>
    );
  return (
    <>
      <Link className={s.backLink} href="/workspace/intakes">
        ← Submitted intakes
      </Link>
      <div className={s.heading}>
        <div>
          <p className={s.eyebrow}>Contract & date review</p>
          <h1>{matter.data.propertyAddress || "New transaction"}</h1>
          <p className={s.subtitle}>
            The transaction is created. Review its contract dates, then continue
            to the checklist.
          </p>
        </div>
        <Link
          className={s.buttonSecondary}
          href={`/workspace/transactions/${id}`}
        >
          Open transaction
        </Link>
      </div>
      <p className={s.notice}>
        Agent uploads are already attached below. If the contract is missing,
        upload it here now or add it later. Confirmed dates populate this
        transaction’s checklist and email-template fields. No emails are sent by
        confirming dates.
      </p>
      <section className={s.section}>
        <div className={s.sectionHead}>
          <h2>Extract dates from a saved contract</h2>
        </div>
        <div className={s.sectionBody}>
          {docs.error && <p className={s.error}>{docs.error}</p>}
          {contracts.length ? (
            <>
              <label className={s.field}>
                Contract or amendment
                <select
                  className={s.select}
                  value={selected || contracts[0].id}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  {contracts.map((doc) => (
                    <option key={doc.id} value={doc.id}>
                      {doc.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className={s.fieldHint}>
                Intake contracts are queued automatically when AI is configured
                and the document is readable. Review additional contracts or
                amendments individually after confirming the previous findings.
              </p>
              <button
                className={s.button}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await mutate("/api/v1/ai/reviews", {
                      matterId: id,
                      documentId: selected || contracts[0].id,
                    });
                    setReviewKey((k) => k + 1);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy
                  ? "Requesting date extraction…"
                  : "Extract contract dates"}
              </button>
            </>
          ) : (
            <p>
              No contract is attached yet. Use the upload section below when you
              have one; you can also open the transaction and return later.
            </p>
          )}
          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}
          <p>
            <Link
              className={s.backLink}
              href={`/workspace/transactions/${id}#dates`}
            >
              Review or enter dates manually
            </Link>
          </p>
        </div>
      </section>
      {matter.data.stage === "pending_review" ? (
        <>
          <InitialFileReview
            key={reviewKey}
            matter={matter.data}
            refresh={matter.refresh}
            uploads={uploads}
            actorId={session.data?.user?.id}
          />
        </>
      ) : (
        <>
          <ReviewQueue key={reviewKey} matterId={id} />
          <DocumentFiles
            matterId={id}
            coordinator
            actorId={session.data?.user?.id}
            uploads={uploads}
          />
        </>
      )}
    </>
  );
}
