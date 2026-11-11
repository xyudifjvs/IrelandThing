"use client";
import Link from "next/link";
import { mutate, label, date, type Matter } from "../../_components/data";
import s from "../../_components/workspace.module.css";
import type { TransactionAction } from "../../_components/transaction-controls";

export function LegacyBrokerPanel({
  matter,
  id,
  busy,
  act,
}: {
  matter: Matter;
  id: string;
  busy: string;
  act: TransactionAction;
}) {
  const tasks = matter.tasks || [];
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <div>
          <h2>Broker file & compliance</h2>
          <p>Approved brokerage requirements guide the final file review.</p>
        </div>
      </div>
      <div className={s.sectionBody}>
        {tasks
          .filter((t) => ["compliance", "broker"].includes(t.kind || ""))
          .map((t) => (
            <div className={s.taskLine} key={t.id}>
              <span style={{ flex: 1 }}>{t.title}</span>
              <select
                className={s.select}
                style={{ maxWidth: 150 }}
                aria-label={`Status for ${t.title}`}
                value={t.status}
                disabled={!!busy}
                onChange={(e) =>
                  void act(t.id, () =>
                    mutate(
                      `/api/v1/matters/${id}/tasks/${t.id}`,
                      {
                        expectedRevision: t.revision,
                        status: e.target.value,
                      },
                      "PATCH",
                    ),
                  )
                }
              >
                {[
                  "pending",
                  "received",
                  "proposed",
                  "completed",
                  "signed",
                  "not_applicable",
                ].map((value) => (
                  <option key={value} value={value}>
                    {label(value)}
                  </option>
                ))}
              </select>
            </div>
          ))}
        <div className={s.notice}>
          Review the approved brokerage checklist and supporting documents
          before marking a file complete. AI findings require coordinator
          review.
        </div>
        <Link
          href={`/workspace/review?matterId=${id}`}
          className={s.buttonSecondary}
        >
          Open document review
        </Link>
      </div>
    </section>
  );
}
