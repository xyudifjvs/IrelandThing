"use client";

import { useState } from "react";
import { mutate } from "../../_components/data";
import type { RosterDetail } from "./model";
import s from "../../_components/workspace.module.css";
import styles from "./roster.module.css";

export function PersonalTestInvitation({
  agent,
  onSaved,
}: {
  agent: RosterDetail;
  onSaved: () => Promise<void>;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    delivery: string;
    acceptanceToken: string;
  } | null>(null);
  return (
    <details className={styles.detailSection}>
      <summary>Personal test invitation</summary>
      <p>
        Try the real agent signup using your own email. The account starts with
        no assigned transactions. This does not record a signed service
        agreement.
      </p>
      <p>
        Send to <strong>{agent.email}</strong>
      </p>
      <form
        className={styles.form}
        onSubmit={async (event) => {
          event.preventDefault();
          if (!confirmed || busy || result) return;
          setBusy(true);
          setError("");
          try {
            const saved = await mutate<{
              delivery: string;
              acceptanceToken: string;
            }>("/api/v1/invitations", {
              email: agent.email,
              role: "agent",
              rosterAgentId: agent.id,
              personalTest: { ownEmailConfirmed: true },
            });
            setResult(saved);
            await onSaved();
          } catch (failure) {
            setError(
              failure instanceof Error
                ? failure.message
                : "Could not prepare the test invitation.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className={s.todo}>
          <input
            type="checkbox"
            checked={confirmed}
            disabled={busy || !!result}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          This is my own personal email, and I want to test the agent signup.
        </label>
        <button
          className={s.buttonSmall}
          disabled={!confirmed || busy || !!result}
        >
          {busy
            ? "Preparing invitation…"
            : agent.invitation
              ? "Resend personal test invitation"
              : "Send personal test invitation"}
        </button>
        {error && (
          <p role="alert" className={s.error}>
            {error}
          </p>
        )}
        {result && (
          <p role="status">
            {result.delivery === "queued"
              ? "Personal test invitation queued for delivery."
              : "Personal test invitation ready to share."}
          </p>
        )}
        {result?.delivery === "manual" && (
          <label className={s.field}>
            Personal test invitation link
            <input
              className={s.input}
              readOnly
              value={`${window.location.origin}/invite?token=${encodeURIComponent(result.acceptanceToken)}`}
            />
          </label>
        )}
      </form>
    </details>
  );
}
