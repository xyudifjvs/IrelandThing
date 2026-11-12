"use client";

import { useId, useState } from "react";
import { useData } from "../../_components/data";
import UserPicker from "../../_components/UserPicker";
import type { ReviewFacts } from "./review-model";
import s from "./creation.module.css";

type RosterChoice = {
  id: string;
  name: string;
  email: string | null;
  userId: string | null;
  revision: number | null;
  business: "hto" | "weatherly";
  phase: string;
};

export function ReviewAgentPicker({
  agentId,
  agentRosterId,
  onChange,
}: Pick<ReviewFacts, "agentId" | "agentRosterId"> & {
  onChange: (
    assignment: Pick<ReviewFacts, "agentId" | "agentRosterId">,
  ) => void;
}) {
  const id = useId();
  const roster = useData<RosterChoice[]>("/api/v1/onboarding/roster");
  const [search, setSearch] = useState("");
  const text = search.trim().toLowerCase();
  const options = (roster.data ?? []).filter(
    ({ revision, phase }) =>
      typeof revision === "number" && phase !== "access_revoked",
  );
  const visible = options.filter(
    (entry) =>
      entry.id === agentRosterId ||
      entry.name.toLowerCase().includes(text) ||
      entry.email?.toLowerCase().includes(text),
  );
  const choose = (rosterId: string) => {
    const entry = options.find(({ id }) => id === rosterId);
    onChange({
      agentRosterId: entry?.id ?? null,
      agentId: entry?.userId ?? null,
    });
  };

  return (
    <div className={s.agentPicker}>
      <label htmlFor={`${id}-search`}>Find an agent on the roster</label>
      <input
        id={`${id}-search`}
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <label htmlFor={id}>Assigned roster agent</label>
      <select
        id={id}
        value={agentRosterId ?? ""}
        onChange={(event) => choose(event.target.value)}
      >
        <option value="">Choose a roster agent</option>
        {agentRosterId && !visible.some(({ id }) => id === agentRosterId) && (
          <option value={agentRosterId}>Selected roster entry</option>
        )}
        {visible.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.name} ·{" "}
            {entry.business === "hto" ? "Home Team Ohio" : "Weatherly"}
          </option>
        ))}
      </select>
      {roster.loading && <p role="status">Loading the roster…</p>}
      {roster.error && (
        <p role="alert">
          {roster.error}{" "}
          <button
            className={s.textButton}
            type="button"
            onClick={() => void roster.refresh()}
          >
            Retry roster
          </button>
        </p>
      )}
      {!roster.loading && !roster.error && text && !visible.length && (
        <p role="status">No matching roster agents.</p>
      )}
      <details open={!!agentId && !agentRosterId}>
        <summary>Choose an agent account</summary>
        <UserPicker
          label="Assigned agent account"
          role="agent"
          required={false}
          value={agentRosterId ? "" : (agentId ?? "")}
          onChange={(value) =>
            onChange({ agentId: value || null, agentRosterId: null })
          }
        />
      </details>
    </div>
  );
}
