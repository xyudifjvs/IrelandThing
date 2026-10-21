"use client";
import { useEffect, useState } from "react";
import { FileSearch, RefreshCw, Check, X, ExternalLink } from "lucide-react";
import { useData, mutate, date, label } from "./data";
import s from "./workspace.module.css";
type Finding = {
  label: string;
  date: string | null;
  sourceQuote: string;
  page?: number;
  confidence?: string | number;
  uncertainty?: string;
  sourceDocumentId?: string;
};
type Proposal = {
  id: string;
  matterId: string;
  status: string;
  sourceRevision: number;
  sourceRefs: { documentId: string; versionId?: string }[];
  createdAt?: string;
  result: {
    summary?: string;
    deadlines?: Finding[];
    facts?: {
      field: string;
      value: unknown;
      sourceQuote?: string;
      page?: number;
    }[];
    warnings?: string[];
  };
};
export default function ReviewQueue({ matterId }: { matterId?: string }) {
  const q = useData<Proposal[]>("/api/v1/ai/reviews");
  const hasPending = q.data?.some((p) =>
    ["queued", "processing"].includes(p.status),
  );
  useEffect(() => {
    if (!hasPending) return;
    const timer = setInterval(() => void q.refresh(), 6000);
    return () => clearInterval(timer);
  }, [hasPending, q.refresh]);
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <div>
          <h2>Review queue</h2>
          <p>Confirm source evidence before changing a timeline.</p>
        </div>
        <button className={s.buttonSmall} onClick={() => void q.refresh()}>
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>
      <div className={s.sectionBody}>
        {q.error && <div className={s.error}>{q.error}</div>}
        {q.loading && !q.data ? (
          <div className={s.loading}>Loading document findings…</div>
        ) : q.data?.filter((p) => !matterId || p.matterId === matterId)
            .length ? (
          q.data
            .filter((p) => !matterId || p.matterId === matterId)
            .map((p) => (
              <ProposalCard
                key={`${p.id}:${p.status}:${p.sourceRevision}`}
                proposal={p}
                refresh={q.refresh}
              />
            ))
        ) : (
          <div className={s.empty}>
            <FileSearch />
            Document findings will appear here.
            <br />
            Upload a contract and request a review when the approved AI route is
            configured.
          </div>
        )}
      </div>
    </section>
  );
}
function ProposalCard({
  proposal: p,
  refresh,
}: {
  proposal: Proposal;
  refresh: () => Promise<void>;
}) {
  const [findings, setFindings] = useState(
    (p.result?.deadlines || []).map((d) => ({
      ...d,
      date: d.date?.slice(0, 10) || "",
      include: !!d.date,
      overrideManual: false,
      reason: "",
    })),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [reason, setReason] = useState("");
  const reviewing = p.status === "pending";
  async function decide(approve: boolean) {
    setBusy(true);
    setError("");
    try {
      const chosen = findings.filter((d) => d.include);
      if (approve && chosen.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d.date)))
        throw new Error(
          "Each selected deadline needs a valid date. Uncheck any date that is not supported by the contract.",
        );
      if (approve && chosen.some((d) => d.overrideManual && !d.reason.trim()))
        throw new Error(
          "Explain each intentional override of an existing manual date.",
        );
      await mutate(
        `/api/v1/ai/reviews/${p.id}/${approve ? "approve" : "reject"}`,
        approve
          ? {
              revision: p.sourceRevision,
              changes: {
                deadlines: chosen.map((d) => ({
                  label: d.label,
                  date: d.date,
                  sourceDocumentId:
                    d.sourceDocumentId || p.sourceRefs?.[0]?.documentId,
                  sourceQuote: d.sourceQuote,
                  ...(d.overrideManual
                    ? { overrideManual: true, reason: d.reason }
                    : {}),
                })),
              },
            }
          : {
              reason:
                reason.trim() || "Coordinator rejected the proposed findings.",
            },
      );
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article style={{ borderTop: "1px solid #e6dccb", padding: "23px 0" }}>
      <div className={s.split}>
        <div>
          <p className={s.eyebrow}>Document findings</p>
          <strong
            style={{ fontFamily: "Georgia", fontSize: 20, fontWeight: 400 }}
          >
            {p.result?.summary ||
              (["queued", "processing"].includes(p.status)
                ? "Your contract is being reviewed."
                : "Contract review")}
          </strong>
          <p className={s.fieldHint}>Requested {date(p.createdAt)}</p>
        </div>
        <span className={s.pill}>{label(p.status)}</span>
      </div>
      {p.sourceRefs?.map((ref, i) => (
        <a
          key={`${ref.documentId}:${i}`}
          className={s.backLink}
          style={{ marginTop: 8 }}
          href={`/api/v1/documents/${ref.documentId}/download${ref.versionId ? `?versionId=${encodeURIComponent(ref.versionId)}` : ""}`}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={12} />
          Review source document {i + 1}
        </a>
      ))}
      {p.result?.warnings?.map((w, i) => (
        <div className={s.notice} key={i}>
          {w}
        </div>
      ))}
      {p.result?.facts?.length ? (
        <div style={{ margin: "15px 0" }}>
          {p.result.facts.map((f, i) => (
            <div className={s.note} key={i}>
              <strong style={{ fontSize: 12, fontWeight: 500 }}>
                {label(f.field)}:{" "}
                {typeof f.value === "string" || typeof f.value === "number"
                  ? String(f.value)
                  : "Requires review"}
              </strong>
              {f.sourceQuote && (
                <blockquote
                  style={{
                    margin: "10px 0 0",
                    paddingLeft: 14,
                    borderLeft: "2px solid #d6c5aa",
                    fontFamily: "Georgia",
                    fontSize: 13,
                    lineHeight: 1.7,
                    color: "#9b8568",
                  }}
                >
                  “{f.sourceQuote}”
                  {f.page && (
                    <small className={s.fieldHint}> · Page {f.page}</small>
                  )}
                </blockquote>
              )}
            </div>
          ))}
        </div>
      ) : null}
      {findings.map((d, i) => (
        <div
          key={i}
          style={{ padding: "20px 0", borderBottom: "1px solid #e9dfd0" }}
        >
          <div className={s.split}>
            <label
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                fontSize: 12,
              }}
            >
              {reviewing && (
                <input
                  type="checkbox"
                  style={{ accentColor: "#8e7451" }}
                  checked={d.include}
                  onChange={(e) =>
                    setFindings((v) =>
                      v.map((x, j) =>
                        j === i ? { ...x, include: e.target.checked } : x,
                      ),
                    )
                  }
                />
              )}
              <strong style={{ fontWeight: 500 }}>{d.label}</strong>
            </label>
            <span className={s.fieldHint}>
              Confidence: {d.confidence ?? "Not supplied"}
            </span>
          </div>
          <blockquote
            style={{
              margin: "15px 0",
              paddingLeft: 15,
              borderLeft: "2px solid #d2c0a3",
              fontFamily: "Georgia",
              fontSize: 14,
              color: "#a18a68",
              lineHeight: 1.8,
            }}
          >
            “
            {d.sourceQuote ||
              "No source quote supplied. Check the source document."}
            ”{d.page && <small className={s.fieldHint}> · Page {d.page}</small>}
          </blockquote>
          {d.uncertainty && <p className={s.notice}>{d.uncertainty}</p>}
          <label className={s.field} style={{ maxWidth: 200 }}>
            Proposed contract date
            <input
              className={s.input}
              type="date"
              value={d.date}
              disabled={!reviewing}
              onChange={(e) =>
                setFindings((v) =>
                  v.map((x, j) =>
                    j === i ? { ...x, date: e.target.value } : x,
                  ),
                )
              }
            />
          </label>
          {reviewing && (
            <details style={{ marginTop: 14 }}>
              <summary className={s.fieldHint} style={{ cursor: "pointer" }}>
                Existing date needs an intentional correction?
              </summary>
              <label className={s.todo}>
                <input
                  type="checkbox"
                  checked={d.overrideManual}
                  onChange={(e) =>
                    setFindings((v) =>
                      v.map((x, j) =>
                        j === i
                          ? { ...x, overrideManual: e.target.checked }
                          : x,
                      ),
                    )
                  }
                />
                Allow this confirmed correction to replace an existing manual
                date
              </label>
              {d.overrideManual && (
                <label className={s.field}>
                  Reason for the correction
                  <input
                    className={s.input}
                    value={d.reason}
                    onChange={(e) =>
                      setFindings((v) =>
                        v.map((x, j) =>
                          j === i ? { ...x, reason: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </label>
              )}
            </details>
          )}
        </div>
      ))}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      {reviewing && (
        <>
          <p className={s.fieldHint}>
            Only selected, valid dates are applied. Existing manual dates stay
            protected unless you explicitly approve a correction with a reason.
          </p>
          <div className={s.formRow}>
            <button
              className={s.button}
              disabled={busy}
              onClick={() => void decide(true)}
            >
              <Check />
              {busy ? "Saving decision…" : "Approve selected dates"}
            </button>
            <button
              className={s.buttonSecondary}
              disabled={busy}
              onClick={() => void decide(false)}
            >
              <X />
              Reject findings
            </button>
          </div>
          <label className={s.field} style={{ marginTop: 15 }}>
            Reason for rejection (optional)
            <input
              className={s.input}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        </>
      )}
    </article>
  );
}
