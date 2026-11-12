"use client";
import {
  agentCanSee,
  clientCanSee,
  audienceVisibility,
} from "../../../../_lib/checklist-audiences";
import { mutate, label, date, type Matter } from "../../_components/data";
import s from "../../_components/workspace.module.css";
import {
  BusyForm,
  type TransactionAction,
} from "../../_components/transaction-controls";

import { DeadlineEditor } from "./LegacyDeadlineEditor";
import { hasVersionedChecklist } from "./canonical-checklist-model";

export function LegacyDatesPanel({
  matter: m,
  id,
  busy,
  act,
  setNotice,
}: {
  matter: Matter;
  id: string;
  busy: string;
  act: TransactionAction;
  setNotice: (notice: string) => void;
}) {
  if (hasVersionedChecklist(m)) return null;
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <div>
          <h2 id="dates">Dates & deadlines</h2>
          <p>Confirm contract dates before relying on the timeline.</p>
        </div>
        <button
          className={s.buttonSmall}
          disabled={!!busy}
          onClick={() =>
            void act("recalculate", async () => {
              await mutate(`/api/v1/workflows/matters/${id}/recalculate`, {
                expectedRevision: m.revision,
              });
              setNotice(
                "Proposed timeline recalculated. Manual dates are preserved. Review the updated milestones below.",
              );
            })
          }
        >
          Recalculate timeline
        </button>
      </div>
      <div className={s.sectionBody}>
        {m.deadlines?.length ? (
          m.deadlines.map((d) => (
            <DeadlineEditor
              key={d.id}
              matterId={id}
              deadline={d}
              busy={!!busy}
              act={act}
            />
          ))
        ) : (
          <p className={s.empty}>
            Add a contract deadline to begin the timeline.
          </p>
        )}
        <details style={{ marginTop: 20 }}>
          <summary
            style={{
              fontSize: 11,
              cursor: "pointer",
              color: "#8c7251",
            }}
          >
            Add a deadline
          </summary>
          <BusyForm
            busy={!!busy}
            className={s.formGrid}
            style={{ marginTop: 18 }}
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const f = new FormData(form);
              void act("deadline-add", async () => {
                await mutate(`/api/v1/matters/${id}/deadlines`, {
                  label: String(f.get("label")),
                  date: f.get("date") ? String(f.get("date")) : null,
                  status: f.get("date") ? "confirmed" : "unknown",
                  visibility: audienceVisibility(
                    f.get("visibleAgent") === "on",
                    f.get("visibleClient") === "on",
                  ),
                  details: { source: "coordinator" },
                });
                form.reset();
              });
            }}
          >
            <label className={s.field}>
              Milestone
              <input
                className={s.input}
                name="label"
                required
                placeholder="e.g. Inspection response"
              />
            </label>
            <label className={s.field}>
              Confirmed contract date
              <input className={s.input} name="date" type="date" />
            </label>
            <button className={s.buttonSmall} disabled={!!busy}>
              Add deadline
            </button>
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend>Visible to</legend>
              <label>
                <input type="checkbox" name="visibleAgent" /> Agent
              </label>
              <label>
                <input type="checkbox" name="visibleClient" /> Client link
              </label>
              <p className={s.fieldHint}>
                New dates stay private until you choose an audience.
              </p>
            </fieldset>
          </BusyForm>
        </details>
      </div>
    </section>
  );
}
