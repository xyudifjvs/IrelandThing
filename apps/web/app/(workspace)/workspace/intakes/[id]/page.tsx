"use client";
import { use, useState } from "react";
import Link from "next/link";
import { useData, mutate, label, date } from "../../_components/data";
import SavedIntakeDetails from "../../../../_components/SavedIntakeDetails";
import type { IntakeReceipt } from "../../_components/IntakeInbox";
import s from "../../_components/workspace.module.css";
const names: Record<string, string> = {
  packageCode: "Service package",
  side: "Representing",
  purchaseType: "Purchase type",
  contractSource: "Contract source",
  directContact: "Client communication",
  title: "Title company",
  lender: "Lender",
  broker: "Brokerage",
  hoa: "HOA handling",
  priorPolicy: "Prior title policy",
  linkedMatterId: "Linked transaction",
  pre1978: "Built before 1978",
  ownChecklist: "Brokerage checklist provided",
  relationship: "Client relationship",
  requested: "Closing gift requested",
  deliveryAddress: "Delivery address",
  copy_agent: "Contact client and copy agent",
  through_agent: "Communicate through agent",
  not_yet_executed: "Not yet executed",
  have: "Contact details supplied",
  essentials: "Contract to Close",
  complete: "Contract to Close + Compliance",
  full_listing: "Full Listing",
};
function Entry({ name, value }: { name: string; value: unknown }) {
  if (
    [
      "documentIds",
      "checklistDocumentId",
      "checklistDocumentIds",
      "referenceIntake",
      "fileReview",
      "serviceSnapshot",
    ].includes(name)
  )
    return null;
  const title = names[name] || label(name.replace(/([A-Z])/g, " $1"));
  if (Array.isArray(value))
    return (
      <div>
        <h3>{title}</h3>
        {value.length ? (
          value.map((v, i) => (
            <Entry key={i} name={`${title} ${i + 1}`} value={v} />
          ))
        ) : (
          <p>Not provided</p>
        )}
      </div>
    );
  if (value && typeof value === "object")
    return (
      <div
        style={{
          margin: "16px 0",
          paddingLeft: 16,
          borderLeft: "2px solid #d6c5aa",
        }}
      >
        <h3>{title}</h3>
        {Object.entries(value).map(([k, v]) => (
          <Entry key={k} name={k} value={v} />
        ))}
      </div>
    );
  return (
    <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
      <strong>{title}: </strong>
      {typeof value === "boolean"
        ? value
          ? "Yes"
          : "No"
        : value
          ? names[String(value)] || String(value).replaceAll("_", " ")
          : "Not provided"}
    </p>
  );
}
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useData<IntakeReceipt>(`/api/v1/intakes/submissions/${id}`);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function create() {
    setBusy(true);
    setError("");
    try {
      const result = await mutate<{ matter: { id: string } }>(
        `/api/v1/intakes/submissions/${id}/create-transaction`,
        {},
      );
      window.location.href = `/workspace/transactions/${result.matter.id}/setup`;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  const intake = q.data;
  if (!intake)
    return (
      <p className={q.error ? s.error : s.loading}>
        {q.error || "Opening intake…"}
      </p>
    );
  return (
    <>
      <Link className={s.backLink} href="/workspace/intakes">
        ← Submitted intakes
      </Link>
      <div className={s.heading}>
        <div>
          <p className={s.eyebrow}>
            {intake.processedAt ? "Transaction created" : "New intake"}
          </p>
          <h1>
            {String(intake.snapshot.propertyAddress || "Address not provided")}
          </h1>
          <p>
            Submitted by {intake.agent?.name} ({intake.agent?.email}) ·{" "}
            {date(intake.createdAt)}
          </p>
        </div>
        {intake.processedAt ? (
          <Link
            className={s.button}
            href={`/workspace/transactions/${intake.matterId}/setup`}
          >
            Open transaction & date review
          </Link>
        ) : (
          <button
            className={s.button}
            disabled={busy}
            onClick={() => void create()}
          >
            {busy ? "Creating transaction…" : "Create transaction"}
          </button>
        )}
      </div>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      {!intake.processedAt && (
        <p className={s.notice}>
          Creating the transaction carries over the people and all uploaded
          files. The attached contracts start date extraction when AI is
          available. You’ll review and confirm the dates before they update the
          checklist and email fields. If no contract is attached, you can upload
          one in the next step or continue without it.
        </p>
      )}
      <section className={s.section}>
        <div className={s.sectionHead}>
          <h2>Uploaded documents</h2>
        </div>
        <div className={s.sectionBody}>
          {intake.documents?.length ? (
            intake.documents.map((doc) => (
              <div className={s.attention} key={doc.id}>
                <div style={{ flex: 1 }}>
                  <strong>{doc.name}</strong>
                  <p>
                    {label(doc.category)} ·{" "}
                    {label(doc.versions[0]?.processingStatus || "saved")}
                  </p>
                </div>
                <a
                  className={s.buttonSmall}
                  href={`/api/v1/documents/${doc.id}/download`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View / download
                </a>
              </div>
            ))
          ) : (
            <p>
              No contract or supporting documents were uploaded. You can add the
              contract after creating the transaction.
            </p>
          )}
        </div>
      </section>
      <section className={s.section}>
        <div className={s.sectionHead}>
          <h2>Everything the agent submitted</h2>
        </div>
        <div className={s.sectionBody}>
          <SavedIntakeDetails value={intake.snapshot.referenceIntake} />
          {Object.entries(intake.snapshot).map(([name, value]) => (
            <Entry key={name} name={name} value={value} />
          ))}
        </div>
      </section>
    </>
  );
}
