"use client";

import { useState } from "react";
import { mutate } from "../../_components/data";
import SignedAgreementBatch from "../../_components/SignedAgreementBatch";
import s from "../../_components/workspace.module.css";
import styles from "./roster.module.css";
import {
  rosterDate,
  rosterEndpoint,
  type RosterAction,
  type RosterDetail,
} from "./model";

export function AgentSignupActions({
  agent,
  action,
  onSaved,
}: {
  agent: RosterDetail;
  action: RosterAction;
  onSaved: () => Promise<void>;
}) {
  const [sentOn, setSentOn] = useState(
    () =>
      agent.agreementSentOn ||
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [invite, setInvite] = useState<{
    url: string;
    expiresAt: string;
  } | null>(null);
  if (!agent.revision || !action) return null;

  async function run(work: () => Promise<void>) {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await work();
      await onSaved();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not save the signup step.",
      );
    } finally {
      setPending(false);
    }
  }

  if (action === "agreement" && agent.email && agent.business === "weatherly")
    return (
      <SignedAgreementBatch
        agent={{ id: agent.id, email: agent.email, userId: agent.userId }}
        onSaved={onSaved}
      />
    );

  return (
    <div className={styles.signupAction}>
      {action === "sent" && (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await mutate(`${rosterEndpoint}/${agent.id}/agreement-sent`, {
                expectedRevision: agent.revision,
                sentOn,
              });
              setMessage("Agreement sent date saved.");
            });
          }}
        >
          <label className={s.field}>
            Agreement sent date
            <input
              className={s.input}
              type="date"
              required
              value={sentOn}
              onChange={(event) => setSentOn(event.target.value)}
            />
          </label>
          <button className={s.button} disabled={pending}>
            Mark agreement sent
          </button>
        </form>
      )}
      {action === "invite" && agent.email && (
        <button
          className={s.button}
          disabled={pending}
          onClick={() => {
            void run(async () => {
              const result = await mutate<{
                acceptanceToken: string;
                expiresAt: string;
                delivery: "manual" | "queued";
              }>("/api/v1/invitations", {
                email: agent.email,
                role: "agent",
                rosterAgentId: agent.id,
              });
              setInvite(
                result.delivery === "manual"
                  ? {
                      url: `${window.location.origin}/invite?token=${encodeURIComponent(result.acceptanceToken)}`,
                      expiresAt: result.expiresAt,
                    }
                  : null,
              );
              setMessage(
                result.delivery === "queued"
                  ? "Portal invitation queued for delivery."
                  : "Portal invitation link ready to share.",
              );
            });
          }}
        >
          {agent.phase === "invited" || agent.invitation
            ? "Resend invite"
            : "Send portal invite"}
        </button>
      )}
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {invite && (
        <label className={s.field}>
          Invitation link · Expires {rosterDate(invite.expiresAt)}
          <input
            className={s.input}
            value={invite.url}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
      )}
    </div>
  );
}
