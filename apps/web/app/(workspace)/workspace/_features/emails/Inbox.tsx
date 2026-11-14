"use client";
import { useState } from "react";
import Link from "next/link";
import { Mail, ArrowUpRight } from "lucide-react";
import { useData, date } from "../../_components/data";
import s from "../../_components/workspace.module.css";
import { Heading } from "../../_components/WorkspaceHeading";
import { Composer, MessageReview } from "../../_components/CommunicationTools";
import EmailSuggestions from "../../_components/EmailSuggestions";
import type { Integration } from "../../_components/integration-summary";

export function Inbox() {
  const integrations = useData<Integration[]>("/api/v1/integrations");
  const connected = integrations.data?.some(
    (i) => i.provider === "gmail" && i.status === "connected",
  );
  const q = useData<Record<string, unknown>[]>(
    connected ? "/api/v1/communications/messages" : null,
  );
  const [selected, setSelected] = useState<Record<string, unknown> | null>(
    null,
  );
  return (
    <>
      <Heading
        eyebrow="Transaction email"
        title="Your inbox"
        subtitle="Read messages, prepare drafts and review recipients before sending."
      />
      <div className={s.twoCol}>
        <section className={s.section}>
          <div className={s.sectionHead}>
            <div>
              <h2>Transaction conversations</h2>
              <p>
                Gmail sync respects your file access and contact permissions.
              </p>
            </div>
            <Mail size={18} strokeWidth={1.3} />
          </div>
          {integrations.loading ? (
            <div className={s.loading}>Checking your mailbox connection…</div>
          ) : !connected ? (
            <div className={s.sectionBody}>
              <div className={s.notice}>
                Gmail is not connected. The placeholder mailbox
                ireland@ireland.com is not an authorized sending account. No
                messages have been synced or sent.
              </div>
              <Link className={s.buttonSecondary} href="/workspace/settings">
                Review integration setup <ArrowUpRight size={12} />
              </Link>
            </div>
          ) : q.error ? (
            <div className={s.error}>{q.error}</div>
          ) : q.loading ? (
            <div className={s.loading}>Syncing conversations…</div>
          ) : q.data?.length ? (
            q.data.map((m, i) => (
              <button
                className={s.message}
                key={String(m.id || i)}
                onClick={() => setSelected(m)}
              >
                <div className={s.split}>
                  <strong>
                    {String(m.fromName || m.fromEmail || m.from || "Sender")}
                  </strong>
                  <small>
                    {date(
                      String(m.sentAt || m.receivedAt || m.createdAt || ""),
                    )}
                  </small>
                </div>
                <p>{String(m.subject || "(No subject)")}</p>
                <small>{String(m.snippet || "Open conversation")}</small>
              </button>
            ))
          ) : (
            <div className={s.empty}>
              <Mail />
              No synced conversations yet.
              <br />
              Synced transaction conversations will appear here.
            </div>
          )}
        </section>
        <section className={s.section}>
          <div className={s.sectionHead}>
            <h2>{selected ? "Your conversation" : "Select a conversation"}</h2>
          </div>
          <div className={s.sectionBody}>
            {selected ? (
              <>
                <h3 style={{ fontFamily: "Georgia", fontWeight: 400 }}>
                  {String(selected.subject)}
                </h3>
                <p className={s.fieldHint}>
                  From {String(selected.fromEmail || selected.from)}
                </p>
                <p
                  style={{
                    whiteSpace: "pre-wrap",
                    fontSize: 12,
                    lineHeight: 1.9,
                  }}
                >
                  {String(
                    selected.text ||
                      selected.bodyText ||
                      selected.snippet ||
                      "Message body unavailable.",
                  )}
                </p>
                <EmailSuggestions
                  key={"ai-" + String(selected.id)}
                  message={selected}
                />
                <MessageReview
                  key={String(selected.id)}
                  message={selected}
                  onChanged={() => {
                    void q.refresh();
                    setSelected(null);
                  }}
                />
              </>
            ) : (
              <p className={`${s.muted} ${s.tiny}`}>
                Select a conversation to read it here. Review all suggested
                changes before updating a transaction or contacting a client.
              </p>
            )}
          </div>
        </section>
      </div>
      <Composer />
    </>
  );
}
