"use client";
import { useState } from "react";
import Link from "next/link";
import { mutate } from "../_components/data";
import UserPicker from "../_components/UserPicker";
import s from "../_components/workspace.module.css";
export default function Page() {
  const [agentId, setAgentId] = useState(""),
    [side, setSide] = useState("buyer"),
    [service, setService] = useState("essentials"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <Link className={s.backLink} href="/workspace/intakes">
        ← Submitted intakes
      </Link>
      <div className={s.heading}>
        <div>
          <p className={s.eyebrow}>Manual creation</p>
          <h1>Start a transaction manually</h1>
          <p>
            For a contract sent by email or a file without an agent intake.
            Create the file, then upload the contract and review its dates.
          </p>
        </div>
      </div>
      <section className={s.section}>
        <form
          className={s.sectionBody}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const f = new FormData(e.currentTarget);
            try {
              const address = String(f.get("address")).trim();
              const matter = await mutate<{ id: string }>("/api/v1/matters", {
                title: address,
                propertyAddress: address,
                packageCode: service,
                side,
                ...(agentId ? { agentId } : {}),
                details: {
                  purchaseType: String(f.get("purchaseType")),
                  source: "coordinator_manual",
                },
              });
              window.location.href = `/workspace/transactions/${matter.id}/setup`;
            } catch (err) {
              setError((err as Error).message);
              setBusy(false);
            }
          }}
        >
          <label className={s.field}>
            Property address
            <input
              className={s.input}
              name="address"
              required
              maxLength={200}
            />
          </label>
          <div className={s.formRow}>
            <label className={s.field}>
              Service package
              <select
                className={s.select}
                value={service}
                onChange={(e) => {
                  setService(e.target.value);
                  if (e.target.value === "full_listing") setSide("seller");
                }}
              >
                <option value="essentials">Contract to Close</option>
                <option value="complete">Contract to Close + Compliance</option>
              </select>
            </label>
            <label className={s.field}>
              Representing
              <select
                className={s.select}
                value={side}
                onChange={(e) => setSide(e.target.value)}
                disabled={service === "full_listing"}
              >
                <option value="buyer">Buyer</option>
                <option value="seller">Seller</option>
              </select>
            </label>
            <label className={s.field}>
              Purchase type
              <select className={s.select} name="purchaseType">
                <option value="financed">Financed</option>
                <option value="cash">Cash</option>
              </select>
            </label>
          </div>
          <UserPicker
            label="Assigned agent (optional)"
            role="agent"
            required={false}
            value={agentId}
            onChange={setAgentId}
            disabled={busy}
          />
          <p className={s.fieldHint}>
            You can add or update people and documents once the file is created.
          </p>
          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}
          <button className={s.button} disabled={busy}>
            {busy ? "Creating…" : "Create transaction & add contract"}
          </button>
        </form>
      </section>
    </>
  );
}
