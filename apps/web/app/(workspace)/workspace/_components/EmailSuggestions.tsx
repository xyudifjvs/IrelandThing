"use client";
import { useState } from "react";
import { Sparkles, ArrowDownToLine } from "lucide-react";
import { useData, mutate, api, label, date } from "./data";
import s from "./workspace.module.css";
type Suggestion = {
  id: string;
  matterId: string;
  kind: string;
  status: string;
  createdAt?: string;
  result: {
    data?: {
      category?: string;
      summary?: string;
      confidence?: number | string;
      suggestedFollowUp?: string;
      subject?: string;
      body?: string;
      evidence?: { source: string; quote: string }[];
      warnings?: string[];
    };
  };
};
export default function EmailSuggestions({
  message,
}: {
  message: Record<string, unknown>;
}) {
  const matterId = typeof message.matterId === "string" ? message.matterId : "";
  const integrations = useData<{ provider: string; status: string }[]>(
    "/api/v1/integrations",
  );
  const ready = integrations.data?.some(
    (i) =>
      i.provider === "openrouter" &&
      ["configured", "connected"].includes(i.status),
  );
  const q = useData<Suggestion[]>(
    matterId
      ? `/api/v1/ai/email-suggestions?matterId=${encodeURIComponent(matterId)}`
      : null,
  );
  const [selected, setSelected] = useState<Suggestion | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [instruction, setInstruction] = useState("");
  async function request(purpose: "classify" | "draft") {
    setBusy(true);
    setError("");
    try {
      setSelected(
        await mutate<Suggestion>("/api/v1/ai/email-suggestions", {
          matterId,
          messageId: String(message.id),
          purpose,
          ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
        }),
      );
      await q.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const result = selected?.result?.data;
  return (
    <div
      style={{ borderTop: "1px solid #e3d6c1", paddingTop: 23, marginTop: 24 }}
    >
      <p className={s.eyebrow}>Email suggestions</p>
      <p className={s.tiny}>
        Review each suggestion against the original email. Suggestions do not
        link conversations, choose recipients, change checklists or send
        messages.
      </p>
      {!matterId ? (
        <div className={s.notice}>
          Link this conversation to a transaction before requesting suggestions.
        </div>
      ) : (
        <>
          {!ready && (
            <div className={s.notice}>
              Email suggestions are unavailable until AI is configured. Email
              content will not be sent to another provider.
            </div>
          )}
          <label className={s.field}>
            Instructions for this suggestion (optional)
            <input
              className={s.input}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="e.g. Draft a brief acknowledgment"
            />
          </label>
          <div className={s.formRow} style={{ flexWrap: "wrap" }}>
            <button
              className={s.buttonSmall}
              disabled={!ready || busy}
              onClick={() => void request("classify")}
            >
              <Sparkles size={12} />
              Suggest classification
            </button>
            <button
              className={s.buttonSmall}
              disabled={!ready || busy}
              onClick={() => void request("draft")}
            >
              <Sparkles size={12} />
              Suggest reply text
            </button>
          </div>
          <details style={{ marginTop: 17 }}>
            <summary className={s.fieldHint} style={{ cursor: "pointer" }}>
              Saved suggestions for this transaction
            </summary>
            {q.data?.map((p) => (
              <button
                className={s.message}
                style={{ padding: "12px 0" }}
                key={p.id}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    setSelected(
                      await api<Suggestion>(
                        `/api/v1/ai/email-suggestions/${p.id}`,
                      ),
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <strong>{label(p.kind)}</strong>
                <small>{date(p.createdAt)} · Check source freshness</small>
              </button>
            ))}
          </details>
        </>
      )}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      {result && (
        <div style={{ marginTop: 20 }}>
          {result.category && (
            <p className={s.pill}>{label(result.category)}</p>
          )}
          {result.summary && <p className={s.tiny}>{result.summary}</p>}
          {result.suggestedFollowUp && (
            <p className={s.notice}>
              Suggested follow-up: {result.suggestedFollowUp}
            </p>
          )}
          {result.subject && (
            <h3
              style={{ fontFamily: "Georgia", fontSize: 20, fontWeight: 400 }}
            >
              {result.subject}
            </h3>
          )}
          {result.body && (
            <p className={s.tiny} style={{ whiteSpace: "pre-wrap" }}>
              {result.body}
            </p>
          )}
          {result.evidence?.map((e, i) => (
            <blockquote
              key={i}
              style={{
                font: "13px/1.8 Georgia,serif",
                color: "#9a8362",
                borderLeft: "2px solid #d5c2a3",
                paddingLeft: 13,
                margin: "15px 0",
              }}
            >
              “{e.quote}”
              <small className={s.fieldHint}> · Email {e.source}</small>
            </blockquote>
          ))}
          {result.warnings?.map((w, i) => (
            <p className={s.notice} key={i}>
              {w}
            </p>
          ))}
          {result.subject && result.body && selected && (
            <button
              className={s.buttonSecondary}
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent("weatherly:suggested-draft", {
                    detail: {
                      matterId: selected.matterId,
                      subject: result.subject,
                      body: result.body,
                    },
                  }),
                );
                document
                  .querySelector("textarea")
                  ?.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
            >
              <ArrowDownToLine />
              Start a new draft from this text
            </button>
          )}
        </div>
      )}
    </div>
  );
}
