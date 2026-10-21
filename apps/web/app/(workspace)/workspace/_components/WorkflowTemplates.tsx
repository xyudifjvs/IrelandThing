"use client";
import { useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { useData, mutate, label } from "./data";
import s from "./workspace.module.css";
type Rule = {
  anchor: string;
  offsetDays: number;
  businessDays: boolean;
  skipDates: string[];
};
type Step = {
  key: string;
  title: string;
  kind: "checklist" | "broker";
  visibility: "agent" | "client" | "coordinator";
  when?: { financing?: "cash" | "financed"; pre1978?: boolean };
  rule?: Rule;
};
type Template = {
  id: string;
  name: string;
  side: string;
  packageCode: string;
  active: boolean;
  revision: number;
  definition: { steps: Step[] };
};
const freshStep = (): Step => ({
  key: crypto.randomUUID(),
  title: "",
  kind: "checklist",
  visibility: "agent",
});
export default function WorkflowTemplates() {
  const q = useData<Template[]>("/api/v1/workflows/templates");
  const [selected, setSelected] = useState<Template | null>(null),
    [editing, setEditing] = useState(false),
    [name, setName] = useState(""),
    [side, setSide] = useState("any"),
    [pkg, setPkg] = useState("any"),
    [active, setActive] = useState(true),
    [steps, setSteps] = useState<Step[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  function edit(t: Template | null) {
    setSelected(t);
    setName(t?.name || "");
    setSide(t?.side || "any");
    setPkg(t?.packageCode || "any");
    setActive(t?.active ?? true);
    setSteps(t?.definition.steps || [freshStep()]);
    setEditing(true);
    setError("");
    setMessage("");
  }
  function patch(i: number, value: Partial<Step>) {
    setSteps((v) => v.map((x, j) => (j === i ? { ...x, ...value } : x)));
  }
  function rule(i: number, value: Partial<Rule>) {
    patch(i, {
      rule: {
        anchor: "",
        offsetDays: 0,
        businessDays: false,
        skipDates: [],
        ...steps[i].rule,
        ...value,
      },
    });
  }
  return (
    <section className={s.section} style={{ marginTop: 25 }}>
      <div className={s.sectionHead}>
        <div>
          <h2>Checklist & date rules</h2>
          <p>
            Build your preferred steps for new transactions. Existing files keep
            their current checklist.
          </p>
        </div>
        <button className={s.buttonSmall} onClick={() => edit(null)}>
          <Plus size={12} />
          New checklist
        </button>
      </div>
      <div className={s.sectionBody}>
        {q.error && <p className={s.error}>{q.error}</p>}
        {q.loading ? (
          <div className={s.loading}>Loading checklist templates…</div>
        ) : (
          q.data?.map((t) => (
            <button
              key={t.id}
              className={s.message}
              style={{ padding: "13px 0" }}
              onClick={() => edit(t)}
            >
              <strong>{t.name}</strong>
              <small style={{ display: "block", marginTop: 7 }}>
                {label(t.side)} side · {label(t.packageCode)} ·{" "}
                {t.definition.steps.length} steps ·{" "}
                {t.active ? "Active" : "Inactive"}
              </small>
            </button>
          ))
        )}
        {!q.loading && !q.data?.length && !editing && (
          <p className={s.tiny}>
            Create a checklist to match your coordination and brokerage
            requirements.
          </p>
        )}
        {editing && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              setMessage("");
              try {
                if (!steps.length)
                  throw new Error("Add at least one checklist step.");
                const definition = {
                  steps: steps.map((step) => ({
                    key: step.key,
                    title: step.title,
                    kind: step.kind,
                    visibility: step.visibility,
                    ...(step.when && Object.keys(step.when).length
                      ? { when: step.when }
                      : {}),
                    ...(step.rule?.anchor
                      ? {
                          rule: {
                            ...step.rule,
                            skipDates: step.rule.skipDates.filter(Boolean),
                          },
                        }
                      : {}),
                  })),
                };
                const saved = await mutate<Template>(
                  `/api/v1/workflows/templates${selected ? "/" + selected.id : ""}`,
                  selected
                    ? {
                        expectedRevision: selected.revision,
                        name,
                        active,
                        definition,
                      }
                    : { name, side, packageCode: pkg, definition },
                  selected ? "PATCH" : "POST",
                );
                setSelected(saved);
                await q.refresh();
                setMessage(
                  "Checklist template saved. These changes apply to new transactions.",
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
            style={{ marginTop: 25 }}
          >
            <div className={s.formGrid}>
              <label className={s.field}>
                Checklist name
                <input
                  className={s.input}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </label>
              <label className={s.field}>
                Represented side
                <select
                  className={s.select}
                  value={side}
                  disabled={!!selected}
                  onChange={(e) => setSide(e.target.value)}
                >
                  {["any", "buyer", "seller"].map((v) => (
                    <option key={v} value={v}>
                      {label(v)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={s.field}>
                Service level
                <select
                  className={s.select}
                  value={pkg}
                  disabled={!!selected}
                  onChange={(e) => setPkg(e.target.value)}
                >
                  {["any", "essentials", "complete", "full_listing"].map(
                    (v) => (
                      <option key={v} value={v}>
                        {label(v)}
                      </option>
                    ),
                  )}
                </select>
              </label>
              {selected && (
                <label className={s.todo}>
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={(e) => setActive(e.target.checked)}
                  />
                  Apply to new matching transactions
                </label>
              )}
            </div>
            {steps.map((step, i) => (
              <div
                key={step.key}
                style={{ padding: "22px 0", borderBottom: "1px solid #e3d6c1" }}
              >
                <div className={s.split}>
                  <p className={s.eyebrow}>Step {i + 1}</p>
                  <button
                    type="button"
                    className={s.buttonSmall}
                    aria-label={`Remove step ${i + 1}`}
                    onClick={() => setSteps((v) => v.filter((_, j) => j !== i))}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <label className={s.field}>
                  Step title
                  <input
                    className={s.input}
                    required
                    value={step.title}
                    onChange={(e) => patch(i, { title: e.target.value })}
                  />
                </label>
                <div className={s.formGrid} style={{ marginTop: 16 }}>
                  <label className={s.field}>
                    Checklist area
                    <select
                      className={s.select}
                      value={step.kind}
                      onChange={(e) =>
                        patch(i, { kind: e.target.value as Step["kind"] })
                      }
                    >
                      <option value="checklist">Transaction checklist</option>
                      <option value="broker">Broker file</option>
                    </select>
                  </label>
                  <label className={s.field}>
                    Visible to
                    <select
                      className={s.select}
                      value={step.visibility}
                      onChange={(e) =>
                        patch(i, {
                          visibility: e.target.value as Step["visibility"],
                        })
                      }
                    >
                      <option value="agent">Agent & coordinator</option>
                      <option value="client">
                        Client, agent & coordinator
                      </option>
                      <option value="coordinator">Coordinator only</option>
                    </select>
                  </label>
                </div>
                <details style={{ marginTop: 18 }}>
                  <summary
                    className={s.fieldHint}
                    style={{ cursor: "pointer" }}
                  >
                    Only include this step for certain transactions
                  </summary>
                  <div className={s.formGrid} style={{ marginTop: 15 }}>
                    <label className={s.field}>
                      Financing
                      <select
                        className={s.select}
                        value={step.when?.financing || "any"}
                        onChange={(e) => {
                          const when = { ...step.when };
                          if (e.target.value === "any") delete when.financing;
                          else
                            when.financing = e.target.value as
                              "cash" | "financed";
                          patch(i, { when });
                        }}
                      >
                        <option value="any">Any purchase type</option>
                        <option value="cash">Cash only</option>
                        <option value="financed">Financed only</option>
                      </select>
                    </label>
                    <label className={s.field}>
                      Property age
                      <select
                        className={s.select}
                        value={
                          step.when?.pre1978 === undefined
                            ? "any"
                            : String(step.when.pre1978)
                        }
                        onChange={(e) => {
                          const when = { ...step.when };
                          if (e.target.value === "any") delete when.pre1978;
                          else when.pre1978 = e.target.value === "true";
                          patch(i, { when });
                        }}
                      >
                        <option value="any">Any year</option>
                        <option value="true">Before 1978</option>
                        <option value="false">1978 or later</option>
                      </select>
                    </label>
                  </div>
                </details>
                <details style={{ marginTop: 18 }} open={!!step.rule?.anchor}>
                  <summary
                    className={s.fieldHint}
                    style={{ cursor: "pointer" }}
                  >
                    Set a date rule for this step
                  </summary>
                  <div className={s.formGrid} style={{ marginTop: 15 }}>
                    <label className={s.field}>
                      Count from milestone (exact label)
                      <input
                        className={s.input}
                        value={step.rule?.anchor || ""}
                        onChange={(e) => rule(i, { anchor: e.target.value })}
                        placeholder="e.g. Closing"
                      />
                    </label>
                    <label className={s.field}>
                      Days before (−) or after (+)
                      <input
                        className={s.input}
                        type="number"
                        min={-365}
                        max={365}
                        value={step.rule?.offsetDays || 0}
                        onChange={(e) =>
                          rule(i, { offsetDays: Number(e.target.value) })
                        }
                      />
                    </label>
                  </div>
                  <label className={s.todo}>
                    <input
                      type="checkbox"
                      checked={step.rule?.businessDays || false}
                      onChange={(e) =>
                        rule(i, { businessDays: e.target.checked })
                      }
                    />
                    Count business days, skipping weekends
                  </label>
                  <label className={s.field}>
                    Also skip these dates (YYYY-MM-DD, separated by commas)
                    <input
                      className={s.input}
                      value={step.rule?.skipDates.join(", ") || ""}
                      onChange={(e) =>
                        rule(i, {
                          skipDates: e.target.value
                            .split(",")
                            .map((d) => d.trim()),
                        })
                      }
                    />
                  </label>
                  <p className={s.fieldHint}>
                    Clear the milestone label to remove the date rule. Review
                    proposed dates before relying on the timeline.
                  </p>
                </details>
              </div>
            ))}
            <button
              type="button"
              className={s.buttonSecondary}
              style={{ marginTop: 20 }}
              onClick={() => setSteps((v) => [...v, freshStep()])}
            >
              <Plus />
              Add a step
            </button>
            {error && (
              <p className={s.error} role="alert">
                {error}
              </p>
            )}
            {message && (
              <p className={s.notice} role="status">
                {message}
              </p>
            )}
            <div className={s.formRow}>
              <button className={s.button} disabled={busy}>
                <Save />
                {busy ? "Saving…" : "Save checklist template"}
              </button>
              <button
                className={s.buttonSecondary}
                type="button"
                onClick={() => setEditing(false)}
              >
                Close editor
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
