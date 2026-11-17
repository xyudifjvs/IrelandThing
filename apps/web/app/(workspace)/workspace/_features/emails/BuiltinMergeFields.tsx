"use client";

import { useState } from "react";
import { mutate, useData } from "../../_components/data";
import type {
  FieldDefinition,
  FieldSource,
} from "../../../../../../../packages/communications/src/field-catalog";
import s from "../../_components/workspace.module.css";

type Company = {
  kind: "title" | "brokerage";
  normalizedName: string;
  name: string;
  text: string;
  revision: number;
};
type Configuration = {
  definitions: FieldDefinition[];
  settings: {
    name: string;
    signature: string;
    reviewLink: string;
    revision: number | null;
  };
  companies: Company[];
  checklistSteps: { key: string; label: string }[];
  intakeAnswers: string[];
};

export function BuiltinMergeFields() {
  const query = useData<Configuration>(
    "/api/v1/communications/field-configuration",
  );
  const [kind, setKind] = useState("details");
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function save(path: string, body: unknown, method = "POST") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await mutate(`/api/v1/communications/${path}`, body, method);
      await query.refresh();
      setMessage("Saved. Existing sent messages keep their original wording.");
      return true;
    } catch (failure) {
      setError((failure as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <section style={{ marginTop: 30 }} aria-labelledby="builtin-merge-heading">
      <h3 id="builtin-merge-heading">Built-in merge fields</h3>
      <p className={s.fieldHint}>
        Add a field connected to a saved source. It fills from that source on
        each transaction; fixed text belongs in Custom merge fields.
      </p>
      {query.error && (
        <p className={s.error} role="alert">
          {query.error}
        </p>
      )}
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget,
            values = new FormData(form);
          const key = String(values.get("key") || "").trim();
          let source: FieldSource;
          if (kind === "details") source = { kind: "details", key };
          else if (kind === "checklist")
            source = {
              kind: "checklist",
              stepKey: String(values.get("sourceKey")),
              property: String(values.get("property")) as Extract<
                FieldSource,
                { kind: "checklist" }
              >["property"],
            };
          else if (kind === "person")
            source = {
              kind: "person",
              role: String(values.get("role")),
              property: String(values.get("property")) as Extract<
                FieldSource,
                { kind: "person" }
              >["property"],
            };
          else if (kind === "agent")
            source = {
              kind: "agent",
              property: String(values.get("property")) as Extract<
                FieldSource,
                { kind: "agent" }
              >["property"],
            };
          else
            source = {
              kind: "intake",
              key: String(values.get("sourceKey") || "").trim(),
            };
          if (
            await save("field-definitions", {
              key,
              label: String(values.get("label")),
              side: String(values.get("side")),
              source,
            })
          )
            form.reset();
        }}
      >
        <fieldset disabled={busy} style={{ border: 0, padding: 0 }}>
          <div className={s.formGrid}>
            <label className={s.field}>
              Name
              <input
                className={s.input}
                name="label"
                required
                maxLength={200}
              />
            </label>
            <label className={s.field}>
              Exact field key
              <input
                className={s.input}
                name="key"
                required
                pattern="[a-z][a-z0-9_]{0,79}"
                maxLength={80}
                placeholder="delivery_instructions"
              />
            </label>
            <label className={s.field}>
              Show on
              <select className={s.select} name="side" defaultValue="both">
                <option value="both">Buyer and seller files</option>
                <option value="buyer">Buyer files</option>
                <option value="seller">Seller files</option>
              </select>
            </label>
            <label className={s.field}>
              Comes from
              <select
                className={s.select}
                value={kind}
                onChange={(event) => setKind(event.target.value)}
              >
                <option value="details">A box in transaction Details</option>
                <option value="checklist">A checklist step</option>
                <option value="person">A person on the deal</option>
                <option value="intake">An intake answer</option>
                <option value="agent">The agent’s profile</option>
              </select>
            </label>
            {kind === "checklist" && (
              <>
                <label className={s.field}>
                  Checklist step
                  <select className={s.select} name="sourceKey" required>
                    {query.data?.checklistSteps.map((step) => (
                      <option key={step.key} value={step.key}>
                        {step.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={s.field}>
                  Use its
                  <select className={s.select} name="property">
                    <option value="date">Due date / email date wording</option>
                    <option value="wording">Step wording</option>
                    <option value="status">Status</option>
                    <option value="amount">Amount</option>
                    <option value="holder">EMD holder</option>
                    <option value="company">Warranty company</option>
                    <option value="schedule">Scheduled appointment</option>
                  </select>
                </label>
              </>
            )}
            {kind === "person" && (
              <>
                <label className={s.field}>
                  Person’s role
                  <input
                    className={s.input}
                    name="role"
                    list="merge-person-roles"
                    required
                    maxLength={80}
                    placeholder="lender"
                  />
                  <datalist id="merge-person-roles">
                    {[
                      "client",
                      "buyer",
                      "seller",
                      "agent",
                      "coop",
                      "title",
                      "lender",
                      "attorney",
                    ].map((role) => (
                      <option key={role} value={role} />
                    ))}
                  </datalist>
                </label>
                <label className={s.field}>
                  Use their
                  <select className={s.select} name="property">
                    <option value="name">Name</option>
                    <option value="first_name">First word of name</option>
                    <option value="email">Email</option>
                    <option value="phone">Phone</option>
                    <option value="company">Company</option>
                    <option value="contact_info">Contact information</option>
                  </select>
                </label>
              </>
            )}
            {kind === "intake" && (
              <label className={s.field}>
                Saved intake answer key
                <input
                  className={s.input}
                  name="sourceKey"
                  list="merge-intake-answers"
                  required
                  pattern="[A-Za-z][A-Za-z0-9_]{0,79}"
                />
                <datalist id="merge-intake-answers">
                  {query.data?.intakeAnswers.map((answer) => (
                    <option key={answer} value={answer} />
                  ))}
                </datalist>
                <small>
                  Use the exact answer key from the intake form. Missing answers
                  stay blank.
                </small>
              </label>
            )}
            {kind === "agent" && (
              <label className={s.field}>
                Use the agent’s
                <select className={s.select} name="property">
                  <option value="name">Name</option>
                  <option value="first_name">First word of name</option>
                  <option value="email">Email</option>
                  <option value="phone">Phone</option>
                  <option value="brokerage">Brokerage</option>
                  <option value="contact_info">Email and phone</option>
                </select>
              </label>
            )}
          </div>
          <button className={s.buttonSmall} style={{ marginTop: 12 }}>
            Add built-in field
          </button>
        </fieldset>
      </form>
      {query.data && (
        <form
          key={`sender:${query.data.settings.revision}`}
          style={{ marginTop: 24 }}
          onSubmit={async (event) => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            await save(
              "field-settings",
              {
                name: String(values.get("name")),
                signature: String(values.get("signature")),
                reviewLink: String(values.get("reviewLink")),
                expectedRevision: query.data!.settings.revision,
              },
              "PATCH",
            );
          }}
        >
          <h4>Your reusable email information</h4>
          <fieldset disabled={busy} style={{ border: 0, padding: 0 }}>
            <label className={s.field}>
              Your name · {"{{tc_name}}"}
              <input
                className={s.input}
                name="name"
                defaultValue={query.data.settings.name}
                required
                maxLength={150}
              />
            </label>
            <label className={s.field}>
              Signature · {"{{tc_signature}}"}
              <textarea
                className={s.textarea}
                name="signature"
                rows={4}
                maxLength={8000}
                defaultValue={query.data.settings.signature}
              />
            </label>
            <label className={s.field}>
              Review link · {"{{review_link}}"}
              <input
                className={s.input}
                type="url"
                name="reviewLink"
                defaultValue={query.data.settings.reviewLink}
              />
            </label>
            <button className={s.buttonSmall}>Save email information</button>
          </fieldset>
        </form>
      )}
      <section style={{ marginTop: 24 }}>
        <h4>Shared company information</h4>
        <p className={s.fieldHint}>
          Wiring instructions are shared by agents with the same saved brokerage
          name. Closing information is shared by the selected title company.
        </p>
        {query.data?.companies.map((company) => (
          <div
            key={`${company.kind}:${company.normalizedName}`}
            className={s.actions}
          >
            <span>
              {company.name} ·{" "}
              {company.kind === "brokerage"
                ? "Commission wiring instructions"
                : "Closing hours and locations"}
            </span>
            <button
              className={s.buttonSmall}
              type="button"
              onClick={() => setEditingCompany(company)}
            >
              Edit
            </button>
          </div>
        ))}
        <form
          key={
            editingCompany
              ? `${editingCompany.kind}:${editingCompany.normalizedName}:${editingCompany.revision}`
              : "new-company"
          }
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget,
              values = new FormData(form);
            if (
              await save("company-field-settings", {
                kind: String(values.get("kind")),
                name: String(values.get("name")),
                text: String(values.get("text")),
                expectedRevision: editingCompany?.revision ?? null,
              })
            ) {
              setEditingCompany(null);
              form.reset();
            }
          }}
        >
          <fieldset disabled={busy} style={{ border: 0, padding: 0 }}>
            <label className={s.field}>
              Company type
              <select
                className={s.select}
                name="kind"
                aria-readonly={!!editingCompany}
                onChange={(event) => {
                  if (editingCompany) event.target.value = editingCompany.kind;
                }}
                defaultValue={editingCompany?.kind ?? "brokerage"}
              >
                <option value="brokerage">
                  Brokerage · commission wiring instructions
                </option>
                <option value="title">
                  Title company · closing hours and locations
                </option>
              </select>
            </label>
            <label className={s.field}>
              Exact saved company / brokerage name
              <input
                className={s.input}
                name="name"
                required
                maxLength={250}
                defaultValue={editingCompany?.name}
                readOnly={!!editingCompany}
              />
            </label>
            <label className={s.field}>
              Instructions
              <textarea
                className={s.textarea}
                name="text"
                rows={5}
                maxLength={8000}
                defaultValue={editingCompany?.text}
              />
            </label>
            <button className={s.buttonSmall}>Save company information</button>
            {editingCompany && (
              <button
                type="button"
                className={s.buttonSecondary}
                onClick={() => setEditingCompany(null)}
              >
                Cancel edit
              </button>
            )}
          </fieldset>
        </form>
      </section>
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
    </section>
  );
}
