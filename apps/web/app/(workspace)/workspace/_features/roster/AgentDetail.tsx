"use client";

import Link from "next/link";
import { useState } from "react";
import { X } from "lucide-react";
import { label, mutate, useData } from "../../_components/data";
import s from "../../_components/workspace.module.css";
import styles from "./roster.module.css";
import { AgentContactForm } from "./AgentContactForm";
import { AgentSignupActions } from "./AgentSignupActions";
import { useRosterConfirmation } from "./useRosterConfirmation";
import { PersonalTestInvitation } from "./PersonalTestInvitation";
import { AgreementEvidence } from "./AgreementEvidence";
import {
  archivePrompt,
  nextRosterAction,
  phaseLabel,
  rosterDate,
  rosterEndpoint,
  type RosterAction,
  type RosterDetail,
} from "./model";

export function AgentDetail({
  id,
  initialAction,
  onClose,
  onChanged,
}: {
  id: string;
  initialAction: RosterAction;
  onClose: () => void;
  onChanged: (id: string | null, action?: RosterAction) => Promise<void>;
}) {
  const query = useData<RosterDetail>(
    `${rosterEndpoint}/${encodeURIComponent(id)}`,
  );
  return (
    <aside className={styles.panel} aria-label="Agent details" tabIndex={-1}>
      <div className={styles.panelHeader}>
        <h2>{query.data?.name || "Agent details"}</h2>
        <button
          className={s.buttonSmall}
          type="button"
          aria-label="Close agent details"
          onClick={onClose}
        >
          <X aria-hidden />
        </button>
      </div>
      {query.loading && !query.data && <p role="status">Loading agent…</p>}
      {query.error && (
        <p role="alert" className={s.error}>
          {query.error}
        </p>
      )}
      {query.data && (
        <AgentProfile
          key={id}
          agent={query.data}
          initialAction={initialAction}
          onRefresh={async () => {
            await Promise.all([query.refresh(), onChanged(id)]);
          }}
          onChanged={onChanged}
        />
      )}
    </aside>
  );
}

function AgentProfile({
  agent,
  initialAction,
  onRefresh,
  onChanged,
}: {
  agent: RosterDetail;
  initialAction: RosterAction;
  onRefresh: () => Promise<void>;
  onChanged: (id: string | null, action?: RosterAction) => Promise<void>;
}) {
  const confirmation = useRosterConfirmation();
  const [action, setAction] = useState<RosterAction>(initialAction);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const next = nextRosterAction(agent);
  const agreement = agent.agreementHistory.find(
    (item) => item.documentId && ["received", "approved"].includes(item.status),
  );
  const steps = [
    ["Inquiry", agent.inquiries.at(-1)?.createdAt ?? agent.booking?.startAt],
    ["Agreement sent", agent.agreementSentOn],
    [
      "Agreement signed",
      agreement ? agreement.signedOn || agreement.createdAt : null,
    ],
    ["Invited", agent.invitation?.createdAt],
    ["Active", agent.phase === "active" ? agent.phaseOn : null],
  ];

  async function materialize() {
    if (!agent.source) return agent;
    return mutate<{ id: string; revision: number }>(
      rosterEndpoint + "/import",
      agent.source,
    );
  }
  async function operate(work: () => Promise<void>) {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      await work();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not update this agent.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {confirmation.dialog}
      <div className={styles.identity}>
        <p className={styles.business}>
          {agent.business === "hto" ? "Home Team Ohio" : "Weatherly TC"}
        </p>
        {agent.personalTest && (
          <p>Personal test · No signed agreement recorded</p>
        )}
        {agent.brokerage && <p>{agent.brokerage}</p>}
        {agent.email && (
          <p>
            <a href={`mailto:${agent.email}`}>{agent.email}</a>
          </p>
        )}
        {agent.phone && (
          <p>
            <a href={`tel:${agent.phone}`}>{agent.phone}</a>
          </p>
        )}
        {agent.source ? (
          <button
            type="button"
            className={s.buttonSmall}
            disabled={busy}
            onClick={() =>
              void operate(async () => {
                const saved = await materialize();
                await onChanged(saved.id, action);
              })
            }
          >
            Add to roster
          </button>
        ) : (
          <button
            type="button"
            className={s.buttonSmall}
            aria-expanded={editing}
            onClick={() => setEditing(!editing)}
          >
            Edit agent
          </button>
        )}
      </div>
      {editing && (
        <AgentContactForm
          agent={agent}
          onCancel={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await onRefresh();
          }}
        />
      )}
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}

      <section className={styles.detailSection}>
        <h3>Sign-up</h3>
        {agent.business === "hto" ? (
          <p>Team member · No service agreement or fee needed</p>
        ) : (
          <ol className={styles.steps}>
            {steps.map(([step, date]) => (
              <li key={step ?? ""}>
                <span
                  aria-hidden
                  className={date ? styles.stepComplete : styles.stepPending}
                >
                  {date ? "✓" : ""}
                </span>
                <span>
                  {step}
                  {date && <small>{rosterDate(date)}</small>}
                </span>
              </li>
            ))}
          </ol>
        )}
        {agent.phase === "access_revoked" && <p>Portal access disabled.</p>}
        {agent.phase === "access_revoked" && agent.portalUserId && (
          <button
            className={s.buttonSmall}
            type="button"
            disabled={busy}
            onClick={async () => {
              if (
                !(await confirmation.request({
                  title: `Restore access for ${agent.name}?`,
                  body: "This restores agent portal access to transactions assigned or shared with this account.",
                  confirmLabel: "Restore portal access",
                }))
              )
                return;
              void operate(async () => {
                await mutate(`/api/v1/users/${agent.portalUserId}/access`, {
                  enabled: true,
                  reason:
                    "Coordinator explicitly restored agent portal access after reviewing this roster entry.",
                });
                await onRefresh();
              });
            }}
          >
            Restore portal access
          </button>
        )}
        {agent.booking && (
          <p>Call booked {rosterDate(agent.booking.startAt)}</p>
        )}
        {!action && next && !agent.source && (
          <button
            className={s.buttonSmall}
            type="button"
            onClick={() => setAction(next.kind)}
          >
            {next.label}
          </button>
        )}
        {action && action !== "agreement" && (
          <AgentSignupActions
            key={action}
            action={action}
            agent={agent}
            onSaved={onRefresh}
          />
        )}
        {!agent.source &&
          agent.email &&
          agent.business === "weatherly" &&
          !agent.hasAccount &&
          !agent.agreementOnFile &&
          (!agent.invitation || agent.personalTest) &&
          agent.files.length === 0 && (
            <PersonalTestInvitation agent={agent} onSaved={onRefresh} />
          )}
        {agent.canArchive && (
          <button
            className={styles.quiet}
            type="button"
            disabled={busy}
            onClick={async () => {
              if (!(await confirmation.request(archivePrompt(agent)))) return;
              void operate(async () => {
                const row = await materialize();
                await mutate(`${rosterEndpoint}/${row.id}/archive`, {
                  expectedRevision: row.revision,
                  confirmed: true,
                });
                await onChanged(null);
              });
            }}
          >
            Archive agent
          </button>
        )}
      </section>

      {agent.business === "weatherly" && (
        <section className={styles.detailSection}>
          <h3>Service agreement</h3>
          {action === "agreement" && (
            <AgentSignupActions
              action={action}
              agent={agent}
              onSaved={onRefresh}
            />
          )}
          {agreement?.documentId ? (
            <article className={styles.evidence}>
              <strong>Signed agreement</strong>
              <p>
                Version {agreement.version}
                {agreement.signedOn
                  ? ` · Signed ${rosterDate(agreement.signedOn)}`
                  : ""}
              </p>
              <AgreementEvidence documentId={agreement.documentId} />
              {agreement.supportingDocumentIds.length > 0 && (
                <details>
                  <summary>Supporting files</summary>
                  {agreement.supportingDocumentIds.map((id, index) => (
                    <p key={id}>
                      <a
                        href={`/api/v1/documents/${encodeURIComponent(id)}/download`}
                      >
                        Download supporting file {index + 1}
                      </a>
                    </p>
                  ))}
                </details>
              )}
            </article>
          ) : (
            <p>
              {agent.agreementSentOn
                ? `Sent ${rosterDate(agent.agreementSentOn)} · Waiting for signature`
                : "No agreement yet"}
            </p>
          )}
          {!agent.source && agent.email && action !== "agreement" && (
            <button
              className={styles.quiet}
              type="button"
              onClick={() => setAction("agreement")}
            >
              {agreement
                ? "Replace with a new version"
                : "Upload signed agreement"}
            </button>
          )}
          {agent.agreementHistory.length > 1 && (
            <details>
              <summary>Agreement history</summary>
              <ul className={styles.fileList}>
                {agent.agreementHistory
                  .filter((item) => item.id !== agreement?.id)
                  .map((item) => (
                    <li key={item.id}>
                      <span>
                        Version {item.version} · {label(item.status)}
                      </span>
                      {item.documentId && (
                        <a
                          href={`/api/v1/documents/${encodeURIComponent(item.documentId)}/download`}
                        >
                          Download
                        </a>
                      )}
                    </li>
                  ))}
              </ul>
            </details>
          )}
        </section>
      )}

      <section className={styles.detailSection}>
        <h3>Files</h3>
        {agent.files.length ? (
          <ul className={styles.fileList}>
            {agent.files.map((file) => (
              <li key={file.id}>
                <Link href={`/workspace/transactions/${file.id}`}>
                  {file.propertyAddress}
                </Link>
                <span>{label(file.stage)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>No files yet.</p>
        )}
      </section>
      {!!agent.inquiries.length && (
        <details className={styles.detailSection}>
          <summary>Inquiry history</summary>
          {agent.inquiries.map((inquiry) => (
            <article key={inquiry.id}>
              <p>
                <strong>{label(inquiry.kind)}</strong> ·{" "}
                {rosterDate(inquiry.createdAt)}
              </p>
              {Object.entries(inquiry.payload)
                .filter(([, value]) => typeof value === "string" && value)
                .map(([field, value]) => (
                  <p key={field}>
                    {label(field)} · {String(value)}
                  </p>
                ))}
            </article>
          ))}
        </details>
      )}
    </>
  );
}
