"use client";
import { useState } from "react";
import { useData, mutate, api, label, date } from "../_components/data";
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
};
export default function Page() {
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
        eyebrow="Good partnerships start here"
        title="Agent onboarding"
        subtitle="Review requests, record service agreement evidence and arrange thoughtful access."
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
      <section className={s.section}>
        <div className={s.sectionHead}>
          <div>
            <h2>Conversations to begin</h2>
            <p>
              Public forms save requests here. A request is not an email sent or
              a meeting confirmed.
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
              <h2>Signed service agreements</h2>
              <p>Record approved evidence before arranging agent access.</p>
            </div>
          </div>
          <div className={s.sectionBody}>
            {agreements.data?.map((a) => (
              <div key={a.id} className={s.taskLine}>
                <div style={{ flex: 1 }}>
                  {a.userId}
                  <p className={s.fieldHint}>
                    Version {a.version} ·{" "}
                    {a.documentId
                      ? "Evidence attached"
                      : "No evidence attached"}
                  </p>
                </div>
                <span className={s.pill}>{label(a.status)}</span>
              </div>
            ))}
            <form
              style={{ display: "grid", gap: 13, marginTop: 20 }}
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const f = new FormData(form);
                void action(async () => {
                  let documentId = String(f.get("documentId") || "");
                  const file = f.get("file");
                  if (file instanceof File && file.size) {
                    const upload = new FormData();
                    upload.set("file", file);
                    upload.set("visibility", "coordinator");
                    upload.set("category", "service_agreement");
                    const doc = await api<{ id: string }>("/api/v1/documents", {
                      method: "POST",
                      body: upload,
                    });
                    documentId = doc.id;
                  }
                  await mutate("/api/v1/onboarding/agreements", {
                    userId: String(f.get("userId")),
                    version: String(f.get("version")),
                    status: documentId ? "approved" : "draft",
                    ...(documentId ? { documentId } : {}),
                  });
                  form.reset();
                  setMessage(
                    documentId
                      ? "Signed agreement evidence recorded and approved."
                      : "Agreement draft recorded. Signed evidence is needed before approval.",
                  );
                });
              }}
            >
              <label className={s.field}>
                Agent account ID or email
                <input className={s.input} name="userId" required />
              </label>
              <label className={s.field}>
                Agreement version
                <input
                  className={s.input}
                  name="version"
                  required
                  placeholder="e.g. 2026-01"
                />
              </label>
              <label className={s.field}>
                Signed evidence (PDF or DOCX)
                <input
                  className={s.input}
                  name="file"
                  type="file"
                  accept=".pdf,.docx"
                />
              </label>
              <button className={s.button} disabled={busy}>
                Record agreement evidence
              </button>
            </form>
          </div>
        </section>
        <section className={s.section}>
          <div className={s.sectionHead}>
            <div>
              <h2>Invite an agent or client</h2>
              <p>Access is personal, scoped and expires if unused.</p>
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
                    ...(f.get("matterId")
                      ? { matterId: String(f.get("matterId")) }
                      : {}),
                    ...(f.get("agreementId")
                      ? { agreementId: String(f.get("agreementId")) }
                      : {}),
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
              <label className={s.field}>
                Matter ID (for shared file access)
                <input className={s.input} name="matterId" />
              </label>
              <label className={s.field}>
                Approved agreement ID (agents)
                <input className={s.input} name="agreementId" />
              </label>
              <p className={s.fieldHint}>
                Agent invitations require an approved signed agreement.
                Invitations are prepared for manual delivery; this does not send
                an email.
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
