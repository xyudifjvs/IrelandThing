"use client";
import { useState } from "react";
import Link from "next/link";
import { Sparkles, FileText } from "lucide-react";
import { useData, mutate, type Matter } from "./data";
import s from "./workspace.module.css";
import { Heading } from "./WorkspaceHeading";
import MatterPicker from "./MatterPicker";
import ReviewQueue from "./ReviewQueue";
import type { Integration } from "./integration-summary";

export function Review() {
  const integrations = useData<Integration[]>("/api/v1/integrations");
  const [selected, setSelected] = useState("");
  const detail = useData<Matter>(
    selected ? `/api/v1/matters/${selected}` : null,
  );
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = integrations.data?.some(
    (i) =>
      i.provider === "openrouter" &&
      ["configured", "connected"].includes(i.status),
  );
  return (
    <>
      <Heading
        eyebrow="Contract documents"
        title="Document review"
        subtitle="Check AI suggestions against the contract before saving dates or other changes."
      />
      <div className={s.twoCol}>
        <section className={s.section}>
          <div className={s.sectionHead}>
            <div>
              <h2>Review a contract</h2>
              <p>
                Extract key fields and proposed dates from your transaction
                documents.
              </p>
            </div>
            <Sparkles size={19} strokeWidth={1.2} />
          </div>
          <div className={s.sectionBody}>
            <MatterPicker
              label="Transaction for document review"
              value={selected}
              onChange={(value) => {
                setSelected(value);
                setResult(null);
              }}
            />
            {!ready && (
              <div className={s.notice} style={{ marginTop: 20 }}>
                Document AI is unavailable until an approved OpenRouter ZDR
                route is configured. Your files will not be sent to an alternate
                provider.
                <p>
                  <Link href="/workspace/settings">
                    Review connection requirements
                  </Link>
                </p>
              </div>
            )}
            {error && <div className={s.error}>{error}</div>}
            {selected && detail.loading ? (
              <div className={s.loading}>Loading documents…</div>
            ) : detail.data?.documents?.length ? (
              detail.data.documents.map((d) => (
                <div className={s.taskLine} key={d.id}>
                  <FileText size={17} />
                  <span style={{ flex: 1 }}>{d.name || d.filename}</span>
                  <button
                    className={s.buttonSmall}
                    disabled={!ready || busy}
                    onClick={async () => {
                      setBusy(true);
                      setError("");
                      try {
                        setResult(
                          await mutate<Record<string, unknown>>(
                            "/api/v1/ai/reviews",
                            { documentId: d.id, matterId: selected },
                          ),
                        );
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {busy ? "Queuing…" : "Request review"}
                  </button>
                </div>
              ))
            ) : selected ? (
              <div className={s.empty}>
                Upload a contract on this transaction before requesting review.
              </div>
            ) : null}
            {result && (
              <div className={s.notice} role="status">
                Review request recorded. Reference:{" "}
                {String(
                  result.id || result.jobId || "Pending worker processing",
                )}
                .
              </div>
            )}
          </div>
        </section>
        <section className={s.section}>
          <div className={s.sectionHead}>
            <h2>Your review checklist</h2>
          </div>
          <div className={s.sectionBody}>
            <p className={`${s.muted} ${s.tiny}`}>
              Confirm the source and amendment order.
              <br />
              <br />
              Check dates, parties and financial terms against the executed
              contract.
              <br />
              <br />
              Resolve uncertainty before saving proposed deadlines.
              <br />
              <br />
              Keep brokerage requirements and approved contract language in
              view.
            </p>
          </div>
        </section>
      </div>
      <ReviewQueue matterId={selected || undefined} />
    </>
  );
}
