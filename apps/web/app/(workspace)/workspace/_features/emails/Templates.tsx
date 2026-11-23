"use client";

import { useState } from "react";
import { Save, Plus } from "lucide-react";
import { useData, mutate, label } from "../../_components/data";
import s from "../../_components/workspace.module.css";
import type { Template } from "./email-model";
import { checklistTemplate } from "../../../../../../../packages/matters/src/checklist/templates";
import { CustomMergeFields } from "./CustomMergeFields";
import { BuiltinMergeFields } from "./BuiltinMergeFields";
import { AvailableFieldCodes } from "./AvailableFieldCodes";
import { clientTemplateDefault } from "../../../../../../../packages/communications/src/template-line-policy";

const templateGroups = [
  ["buyer_ctc", "Buyer · Contract to Close"],
  ["seller_ctc", "Seller · Contract to Close"],
  ["buyer_compliance", "Buyer · Contract to Close + Compliance"],
  ["seller_compliance", "Seller · Contract to Close + Compliance"],
] as const;

export function Templates() {
  const [selectedGroup, setSelectedGroup] = useState("buyer_ctc");
  const q = useData<Template[]>("/api/v1/communications/templates");
  const [selected, setSelected] = useState<Template | null>(null);
  const [creating, setCreating] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [linePolicy, setLinePolicy] = useState<{
    id: string;
    value: boolean;
  } | null>(null);
  const [audience, setAudience] = useState<{
    id: string;
    recipientRoles: string[];
    recipientGroup: string | null;
  } | null>(null);
  const policyId = selected?.id || "new";
  const currentAudience = audience?.id === policyId ? audience : selected;
  const hideLines =
    linePolicy?.id === policyId
      ? linePolicy.value
      : (selected?.hideNotNeededLines ??
        clientTemplateDefault(currentAudience ?? {}));
  const visible = (q.data || []).filter((entry) =>
    selectedGroup === "legacy"
      ? !entry.serviceGroup
      : entry.serviceGroup === selectedGroup,
  );
  const sides =
    selected?.side === "both"
      ? (["buyer", "seller"] as const)
      : ([
          selected?.side === "seller" || selectedGroup.startsWith("seller_")
            ? "seller"
            : "buyer",
        ] as const);
  const steps = [
    ...new Map(
      sides
        .flatMap((side) => checklistTemplate(side, null))
        .map((step) => [step.key, step.title]),
    ).entries(),
  ];

  async function move(template: Template, delta: number) {
    const group = visible.filter(
      (entry) =>
        entry.side === template.side &&
        (entry.recipientGroup ?? null) === (template.recipientGroup ?? null),
    );
    const current = group.findIndex((entry) => entry.id === template.id);
    const next = current + delta;
    if (next < 0 || next >= group.length) return;
    [group[current], group[next]] = [group[next], group[current]];
    setBusy(true);
    setError("");
    try {
      await mutate("/api/v1/communications/templates/reorder", {
        side: template.side,
        recipientGroup: template.recipientGroup ?? null,
        serviceGroup: template.serviceGroup ?? null,
        items: group.map(({ id, revision }) => ({
          id,
          expectedRevision: revision,
        })),
      });
      await q.refresh();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not reorder the templates.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(template: Template) {
    setBusy(true);
    setError("");
    try {
      await mutate(
        `/api/v1/communications/templates/${template.id}`,
        { expectedRevision: template.revision },
        "DELETE",
      );
      setSelected(null);
      await q.refresh();
      setMessage("Template deleted from the active list.");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not delete this template.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={s.section} style={{ marginTop: 25 }}>
      <div className={s.sectionHead}>
        <div>
          <h2>Your email templates</h2>
          <p>
            Save reusable messages and check the filled-in details before
            sending.
          </p>
        </div>
        <button
          className={s.buttonSmall}
          onClick={() => {
            setSelected(null);
            setCreating(true);
            setLinePolicy(null);
            setAudience(null);
            setMessage("");
          }}
        >
          <Plus size={12} />
          New template
        </button>
      </div>
      <div className={s.sectionBody}>
        <div className={s.formRow}>
          {templateGroups.map(([value, name]) => (
            <button
              className={
                selectedGroup === value ? s.buttonSmall : s.buttonSecondary
              }
              key={value}
              onClick={() => {
                setSelectedGroup(value);
                setSelected(null);
                setCreating(false);
              }}
            >
              {name}
            </button>
          ))}
          {q.data?.some((t) => !t.serviceGroup) && (
            <button
              className={s.buttonSecondary}
              onClick={() => setSelectedGroup("legacy")}
            >
              Existing unassigned templates
            </button>
          )}
        </div>
        {q.error && <p className={s.error}>{q.error}</p>}
        {q.loading ? (
          <div className={s.loading}>Loading templates…</div>
        ) : (
          visible.map((t) => (
            <div className={s.actions} key={t.id}>
              <button
                className={s.message}
                style={{ padding: "13px 0" }}
                onClick={() => {
                  setSelected(t);
                  setCreating(false);
                  setError("");
                  setMessage("");
                }}
              >
                <strong>{t.name}</strong>
                <small style={{ display: "block", marginTop: 6 }}>
                  {label(t.side)} · {label(t.phase)}
                </small>
              </button>
              <button
                type="button"
                className={s.buttonSmall}
                disabled={busy}
                aria-label={`Move ${t.name} up`}
                onClick={() => void move(t, -1)}
              >
                Move up
              </button>
              <button
                type="button"
                className={s.buttonSmall}
                disabled={busy}
                aria-label={`Move ${t.name} down`}
                onClick={() => void move(t, 1)}
              >
                Move down
              </button>
            </div>
          ))
        )}
        {!q.loading &&
          !q.data?.some((t) =>
            selectedGroup === "legacy"
              ? !t.serviceGroup
              : t.serviceGroup === selectedGroup,
          ) &&
          !creating && (
            <p className={s.tiny}>
              No templates in this group yet. Ireland’s workbook will supply the
              wording.
            </p>
          )}
        {selected || creating ? (
          <form
            key={selected?.id || "new"}
            style={{ marginTop: 22 }}
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true);
              setError("");
              setMessage("");
              const group = String(f.get("serviceGroup") || "");
              const values = {
                serviceGroup: group || null,
                name: String(f.get("name")),
                side: group
                  ? group.startsWith("buyer_")
                    ? "buyer"
                    : "seller"
                  : selected?.side || "buyer",
                phase: String(f.get("phase")),
                subject: String(f.get("subject")),
                body: String(f.get("body")),
                recipientGroup:
                  String(f.get("recipientGroup") || "").trim() || null,
                recipientRoles: String(f.get("recipientRoles") || "")
                  .split(",")
                  .map((role) =>
                    role
                      .trim()
                      .toLowerCase()
                      .replace(/[\s-]+/g, "_"),
                  )
                  .filter(Boolean),
                linkedStepKey: String(f.get("linkedStepKey") || "") || null,
                isPlaceholder: f.get("isPlaceholder") === "on",
                hideNotNeededLines: f.get("hideNotNeededLines") === "on",
              };
              try {
                const saved = await mutate<Template>(
                  `/api/v1/communications/templates${selected ? "/" + selected.id : ""}`,
                  selected
                    ? { expectedRevision: selected.revision, ...values }
                    : values,
                  selected ? "PATCH" : "POST",
                );
                setSelected(saved);
                setCreating(false);
                await q.refresh();
                setMessage(
                  "Template saved. Existing drafts are not changed automatically.",
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className={s.formGrid}>
              <label className={s.field}>
                Template name
                <input
                  className={s.input}
                  name="name"
                  required
                  defaultValue={selected?.name}
                />
              </label>
              <label className={s.field}>
                Template group
                <select
                  className={s.select}
                  name="serviceGroup"
                  defaultValue={
                    selected?.serviceGroup ||
                    (selected
                      ? ""
                      : selectedGroup === "legacy"
                        ? ""
                        : selectedGroup)
                  }
                  required={!selected}
                >
                  <option value="">Existing template · unassigned</option>
                  {templateGroups.map(([value, name]) => (
                    <option value={value} key={value}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={s.field}>
                Transaction phase
                <input
                  className={s.input}
                  name="phase"
                  required
                  defaultValue={selected?.phase || "under_contract"}
                  placeholder="e.g. closing"
                />
              </label>
              <label className={s.field}>
                Subject
                <input
                  className={s.input}
                  name="subject"
                  required
                  defaultValue={selected?.subject}
                />
              </label>
              <label className={s.field}>
                Recipient group
                <input
                  className={s.input}
                  name="recipientGroup"
                  defaultValue={selected?.recipientGroup || ""}
                  onChange={(event) =>
                    setAudience({
                      id: policyId,
                      recipientGroup: event.target.value,
                      recipientRoles: currentAudience?.recipientRoles ?? [],
                    })
                  }
                  placeholder="To buyer"
                  maxLength={100}
                />
              </label>
              <label className={s.field}>
                Default recipient roles
                <input
                  className={s.input}
                  name="recipientRoles"
                  defaultValue={selected?.recipientRoles?.join(", ") || ""}
                  onChange={(event) =>
                    setAudience({
                      id: policyId,
                      recipientRoles: event.target.value
                        .split(",")
                        .map((value) => value.trim())
                        .filter(Boolean),
                      recipientGroup: currentAudience?.recipientGroup ?? null,
                    })
                  }
                  placeholder="Client, lender"
                />
              </label>
              <label className={s.field}>
                Link to checklist step
                <select
                  className={s.select}
                  name="linkedStepKey"
                  defaultValue={selected?.linkedStepKey || ""}
                >
                  <option value="">No linked step</option>
                  {steps.map(([key, title]) => (
                    <option value={key} key={key}>
                      {title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className={s.todo}>
              <input
                type="checkbox"
                name="hideNotNeededLines"
                checked={hideLines}
                onChange={(event) =>
                  setLinePolicy({ id: policyId, value: event.target.checked })
                }
              />
              Hide not-needed lines
            </label>
            <p className={s.fieldHint}>
              Hide an entire email line when it contains a checklist date marked
              Not needed. On by default for buyer/client and seller/client
              templates; off for agent, title and lender templates.
            </p>
            <label className={s.todo}>
              <input
                type="checkbox"
                name="isPlaceholder"
                defaultChecked={selected?.isPlaceholder ?? false}
              />
              Placeholder. Add the final content before sending.
            </label>
            <label className={s.field} style={{ marginTop: 18 }}>
              Email body
              <textarea
                className={s.textarea}
                style={{ minHeight: 180 }}
                name="body"
                required
                defaultValue={selected?.body}
              />
            </label>
            <AvailableFieldCodes />
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
                {busy ? "Saving…" : "Save template"}
              </button>
              <button
                type="button"
                className={s.buttonSecondary}
                onClick={() => {
                  setSelected(null);
                  setCreating(false);
                }}
              >
                Close editor
              </button>
              {selected && (
                <button
                  type="button"
                  className={s.buttonSmall}
                  disabled={busy}
                  onClick={() => void remove(selected)}
                >
                  Delete template
                </button>
              )}
            </div>
          </form>
        ) : null}
        <BuiltinMergeFields />
        <CustomMergeFields />
      </div>
    </section>
  );
}
