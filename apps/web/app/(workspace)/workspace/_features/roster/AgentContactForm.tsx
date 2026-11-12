"use client";

import { useState } from "react";
import { mutate } from "../../_components/data";
import s from "../../_components/workspace.module.css";
import styles from "./roster.module.css";
import { rosterEndpoint, type RosterEntry } from "./model";

export function AgentContactForm({
  agent,
  onSaved,
  onCancel,
}: {
  agent?: RosterEntry;
  onSaved: (id: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [business, setBusiness] = useState<"hto" | "weatherly">(
    agent?.business || "weatherly",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className={styles.form}
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending) return;
        const values = new FormData(event.currentTarget);
        const email = String(values.get("email") || "").trim();
        const input = {
          name: String(values.get("name") || ""),
          phone: String(values.get("phone") || ""),
          brokerage: String(values.get("brokerage") || ""),
          business,
          ...(email && !agent?.email ? { email } : {}),
        };
        setPending(true);
        setError("");
        try {
          const row = agent
            ? await mutate<{ id: string }>(
                `${rosterEndpoint}/${agent.id}`,
                { ...input, expectedRevision: agent.revision },
                "PATCH",
              )
            : await mutate<{ id: string }>(rosterEndpoint, input);
          await onSaved(row.id);
        } catch (failure) {
          setError(
            failure instanceof Error
              ? failure.message
              : "Could not save this agent.",
          );
        } finally {
          setPending(false);
        }
      }}
    >
      <fieldset disabled={pending}>
        <label className={s.field}>
          Name
          <input
            className={s.input}
            name="name"
            autoComplete="name"
            defaultValue={agent?.name}
            required
            maxLength={150}
          />
        </label>
        <label className={s.field}>
          Email
          <input
            className={s.input}
            name="email"
            autoComplete="email"
            type="email"
            defaultValue={agent?.email || ""}
            readOnly={!!agent?.email}
            required={!agent && business === "weatherly"}
          />
        </label>
        <label className={s.field}>
          Phone
          <input
            className={s.input}
            name="phone"
            autoComplete="tel"
            type="tel"
            defaultValue={agent?.phone || ""}
            maxLength={60}
          />
        </label>
        <label className={s.field}>
          Brokerage
          <input
            className={s.input}
            name="brokerage"
            autoComplete="organization"
            defaultValue={agent?.brokerage || ""}
            maxLength={250}
          />
        </label>
        <label className={s.field}>
          Business
          <select
            className={s.input}
            value={business}
            onChange={(event) =>
              setBusiness(event.target.value === "hto" ? "hto" : "weatherly")
            }
          >
            <option value="weatherly">Weatherly TC</option>
            <option value="hto">Home Team Ohio</option>
          </select>
        </label>
      </fieldset>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <button className={s.button} disabled={pending}>
          {agent ? "Save agent" : "Add agent"}
        </button>
        <button
          className={s.buttonSecondary}
          type="button"
          disabled={pending}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
