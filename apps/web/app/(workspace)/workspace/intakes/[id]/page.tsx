"use client";
import { use } from "react";
import Link from "next/link";
import { useData, label, date } from "../../_components/data";
import SavedIntakeDetails from "../../../../_components/SavedIntakeDetails";
import type { IntakeReceipt } from "../../_components/IntakeInbox";
import s from "../../_components/workspace.module.css";
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useData<IntakeReceipt>(`/api/v1/intakes/submissions/${id}`);
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
          <Link
            className={s.button}
            href={`/workspace/new?intakeId=${encodeURIComponent(id)}`}
          >
            Create transaction
          </Link>
        )}
      </div>
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
              No contract or supporting documents were uploaded. You can add a
              contract while reviewing the intake.
            </p>
          )}
        </div>
      </section>
      <SavedIntakeDetails
        value={intake.snapshot}
        agent={
          intake.agent
            ? {
                ...intake.agent,
                brokerage: intake.agent.brokerage || null,
                phone: null,
              }
            : null
        }
      />
    </>
  );
}
