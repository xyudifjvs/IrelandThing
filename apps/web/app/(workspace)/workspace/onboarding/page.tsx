"use client";
import { useState } from "react";
import { useData, mutate, label, date } from "../_components/data";
import MatterPicker from "../_components/MatterPicker";
import CalendlyBookings from "../_components/CalendlyBookings";
import SignedAgreementBatch from "../_components/SignedAgreementBatch";
import { Heading } from "../_components/Operations";
import s from "../_components/workspace.module.css";
type Inquiry = {
  id: string;
  name: string;
  email: string;
  kind: string;
  status: string;
  revision: number;
  createdAt: string;
  payload: {
    phone?: string;
    brokerage?: string;
    message?: string;
    meetingTime?: string;
    timezone?: string;
  };
};
type Agreement = {
  id: string;
  userId: string;
  version: string;
  status: string;
  revision: number;
  documentId?: string;
  supportingDocumentIds?: string[];
};
export default function Page() {
  const [invitationMatter, setInvitationMatter] = useState("");
  const q = useData<Inquiry[]>("/api/v1/onboarding/inquiries");
  const agreements = useData<Agreement[]>("/api/v1/onboarding/agreements");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [invite, setInvite] = useState<{
    url: string;
    email: string;
    expiresAt: string;
  } | null>(null);
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
      await q.refresh();
      await agreements.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading
        eyebrow="Agent requests & access"
        title="Agent onboarding"
        subtitle="Review inquiries, save signed agreements and invite agents or clients."
      />
      {error && (
        <div className={s.error} role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className={s.notice} role="status">
          {message}
        </div>
      )}
      <CalendlyBookings />
      <section className={s.section}>
        <div className={s.sectionHead}>
          <div>
            <h2>New inquiries</h2>
            <p>
              Public forms and earlier meeting requests are preserved here.
              Verified Calendly bookings appear separately above.
            </p>
          </div>
        </div>
        {q.loading ? (
          <div className={s.loading}>Loading inquiries…</div>
        ) : q.error ? (
          <div className={s.error}>{q.error}</div>
        ) : q.data?.length ? (
          q.data.map((i) => (
            <div
              className={s.sectionBody}
              key={i.id}
              style={{ borderTop: "1px solid #e7dccb", paddingTop: 20 }}
            >
              <div className={s.split}>
                <div>
                  <strong
                    style={{
                      fontFamily: "Georgia",
                      fontSize: 21,
                      fontWeight: 400,
                    }}
                  >
                    {i.name}
                  </strong>
                  <p className={s.fieldHint}>
                    {i.email} · {i.payload.brokerage || label(i.kind)}
                  </p>
                </div>
                <select
                  aria-label={`Status for ${i.name}`}
                  className={s.select}
                  style={{ maxWidth: 170 }}
                  value={i.status}
                  disabled={busy}
                  onChange={(e) =>
                    void action(() =>
                      mutate(
                        `/api/v1/onboarding/inquiries/${i.id}`,
                        {
                          expectedRevision: i.revision,
                          status: e.target.value,
                        },
                        "PATCH",
                      ),
                    )
                  }
                >
                  {[
                    "new",
                    "contacted",
                    "meeting_requested",
                    "meeting_confirmed",
                    "agreement_sent",
                    "approved",
                    "closed",
                  ].map((v) => (
                    <option key={v} value={v}>
                      {label(v)}
                    </option>
                  ))}
                </select>
              </div>
              {i.payload.message && (
                <p className={s.tiny} style={{ whiteSpace: "pre-wrap" }}>
                  {i.payload.message}
                </p>
              )}
              {i.payload.meetingTime && (
                <p className={s.fieldHint}>
                  Requested: {new Date(i.payload.meetingTime).toLocaleString()}{" "}
                  · {i.payload.timezone}
                </p>
              )}
            </div>
          ))
        ) : (
          <div className={s.empty}>New inquiries will appear here.</div>
        )}
      </section>
      <div className={s.columns}>
        <section className={s.section}>
          <div className={s.sectionHead}>
            <div>
              <h2>Signed agreement evidence</h2>
              <p>Record signed evidence before arranging agent access. Sending an agreement link does not record a signature.</p>
            </div>
          </div>
          <div className={s.sectionBody}>
            {agreements.data?.map((a) => (
              <div key={a.id} className={s.taskLine}>
                <div style={{ flex: 1 }}>
                  {a.userId}
                  <p className={s.fieldHint}>
                    Version {a.version} ·{" "}
                    {a.documentId ? (
                      <a
                        href={`/api/v1/documents/${a.documentId}/download`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Download signed evidence
                      </a>
                    ) : (
                      "No evidence attached"
                    )}
                  </p>
                  {!!a.supportingDocumentIds?.length && (
                    <ul aria-label={`Supporting evidence for agreement version ${a.version}`}>
                      {a.supportingDocumentIds.map((id, index) => (
                        <li key={id}>
                          <a href={`/api/v1/documents/${id}/download`} target="_blank" rel="noreferrer">
                            Download supporting evidence {index + 1}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <span className={s.pill}>{label(a.status)}</span>
              </div>
            ))}
            <SignedAgreementBatch onSaved={agreements.refresh} />
          </div>
        </section>
        <section className={s.section}>
          <div className={s.sectionHead}>
            <div>
              <h2>Invite an agent or client</h2>
              <p>Each invitation is for one recipient and expires if unused.</p>
            </div>
          </div>
          <div className={s.sectionBody}>
            <form
              style={{ display: "grid", gap: 13 }}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void action(async () => {
                  const result = await mutate<{
                    acceptanceToken: string;
                    email: string;
                    expiresAt: string;
                  }>("/api/v1/invitations", {
                    email: String(f.get("email")),
                    role: String(f.get("role")),
                    ...(invitationMatter ? { matterId: invitationMatter } : {}),
                  });
                  setInvite({
                    email: result.email,
                    expiresAt: result.expiresAt,
                    url: `${window.location.origin}/invite?token=${encodeURIComponent(result.acceptanceToken)}`,
                  });
                });
              }}
            >
              <label className={s.field}>
                Email
                <input className={s.input} name="email" type="email" required />
              </label>
              <label className={s.field}>
                Portal role
                <select className={s.select} name="role">
                  <option value="agent">Agent</option>
                  <option value="client">Client</option>
                </select>
              </label>
              <MatterPicker
                label="Transaction to share (optional)"
                value={invitationMatter}
                onChange={setInvitationMatter}
                disabled={busy}
                emptyLabel="No transaction access with this invitation"
              />
              <p className={s.fieldHint}>
                Agent invitations require an approved signed agreement matching
                the recipient’s email. Invitations are prepared for manual
                delivery; this does not send an email.
              </p>
              <button className={s.button} disabled={busy}>
                Prepare invitation
              </button>
            </form>
            {invite && (
              <div className={s.notice} role="status">
                <strong>Invitation prepared for {invite.email}</strong>
                <p>Expires {new Date(invite.expiresAt).toLocaleString()}.</p>
                <label className={s.field}>
                  Private invitation link
                  <input
                    className={s.input}
                    readOnly
                    value={invite.url}
                    onFocus={(e) => e.target.select()}
                  />
                </label>
                <p className={s.fieldHint}>
                  Share only with this recipient through an approved channel.
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
