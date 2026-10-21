"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Sparkles, X, ArrowUp, FileText, Clock3, Plus } from "lucide-react";
import { api } from "@weatherly/ui";
type Citation = { sourceId: string; title: string; url: string; quote: string };
type Message = {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  uncertainties?: string[];
};
type Conversation = {
  id: string;
  matterId: string | null;
  messages: Message[];
  updatedAt: string;
};
export function AssistantPanel() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string>();
  const [history, setHistory] = useState<Conversation[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [available, setAvailable] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const matterId = pathname.match(/^\/workspace\/transactions\/([^/]+)$/)?.[1];
  useEffect(() => {
    setMessages([]);
    setConversationId(undefined);
    setError("");
  }, [matterId]);
  useEffect(() => {
    if (!open) return;
    void api<{ provider: string; status: string }[]>("/api/v1/integrations")
      .then((data) =>
        setAvailable(
          data.some(
            (i) =>
              i.provider === "openrouter" &&
              ["configured", "connected"].includes(i.status),
          ),
        ),
      )
      .catch((e) => setError(e.message));
    void api<Conversation[]>("/api/v1/assistant/conversations")
      .then(setHistory)
      .catch((e) => setError(e.message));
    input.current?.focus();
  }, [open]);
  if (!pathname.startsWith("/workspace")) return null;
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <>
      <button
        ref={trigger}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="weatherly-assistant"
        className="assistant-trigger"
      >
        <Sparkles size={16} />
        Ask Weatherly
      </button>
      {open && (
        <aside
          id="weatherly-assistant"
          aria-label="Weatherly assistant"
          className="assistant-panel"
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
          }}
        >
          <header>
            <div>
              <p className="assistant-kicker">TRANSACTION RECORDS</p>
              <h2>Your Weatherly assistant</h2>
            </div>
            <button aria-label="Close assistant" onClick={close}>
              <X size={18} />
            </button>
          </header>
          <nav>
            <span>
              {matterId ? "This transaction" : "All your transactions"}
            </span>
            <button onClick={() => setShowHistory(!showHistory)}>
              <Clock3 size={13} />
              History
            </button>
            <button
              aria-label="New conversation"
              onClick={() => {
                setMessages([]);
                setConversationId(undefined);
                setShowHistory(false);
              }}
            >
              <Plus size={16} />
            </button>
          </nav>
          <div className="assistant-messages" aria-live="polite">
            {showHistory ? (
              <>
                <h3>Saved conversations</h3>
                {history
                  .filter((h) => h.matterId === (matterId || null))
                  .map((h) => (
                    <button
                      className="assistant-history"
                      key={h.id}
                      onClick={() => {
                        setMessages(h.messages);
                        setConversationId(h.id);
                        setShowHistory(false);
                      }}
                    >
                      {h.messages.find((m) => m.role === "user")?.content ||
                        "Conversation"}
                    </button>
                  ))}
                {!history.length && (
                  <p>Your conversations will be saved here.</p>
                )}
              </>
            ) : messages.length ? (
              messages.map((m, i) => (
                <article className={`assistant-message ${m.role}`} key={i}>
                  <small>{m.role === "user" ? "YOU" : "WEATHERLY"}</small>
                  <p>{m.content}</p>
                  {m.citations?.map((c, j) => (
                    <details key={j}>
                      <summary>
                        <FileText size={12} />
                        {c.title}
                      </summary>
                      <blockquote>{c.quote}</blockquote>
                      <a href={c.url} target="_blank" rel="noreferrer">
                        Open source ↗
                      </a>
                    </details>
                  ))}
                  {m.uncertainties?.length ? (
                    <p className="assistant-caveat">
                      {m.uncertainties.join(" ")}
                    </p>
                  ) : null}
                </article>
              ))
            ) : (
              <div className="assistant-welcome">
                <Sparkles size={28} />
                <h3>Ask about your transactions</h3>
                <p>
                  Ask about saved dates, documents, open tasks, messages or
                  payment status. Answers link back to the records.
                </p>
                {[
                  "What needs my attention?",
                  "Which dates still need confirmation?",
                  "What is missing from this file?",
                ].map((q) => (
                  <button
                    key={q}
                    onClick={() => {
                      setQuestion(q);
                      input.current?.focus();
                    }}
                  >
                    {q}
                    <ArrowUp size={13} />
                  </button>
                ))}
              </div>
            )}
            {busy && (
              <p className="assistant-caveat">Checking your saved records…</p>
            )}
          </div>
          {!available && (
            <p className="assistant-connection">
              AI is not connected yet. Ask your workspace administrator to
              configure it.
            </p>
          )}
          {error && (
            <p className="assistant-error" role="alert">
              {error}
            </p>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!question.trim() || busy || !available) return;
              const submitted = question;
              setBusy(true);
              setError("");
              try {
                const response = await api<{
                  conversationId: string;
                  answer: string;
                  citations: Citation[];
                  uncertainties: string[];
                }>("/api/v1/assistant/ask", {
                  method: "POST",
                  body: JSON.stringify({
                    question: submitted,
                    ...(matterId ? { matterId } : {}),
                    ...(conversationId ? { conversationId } : {}),
                  }),
                });
                setMessages((old) => [
                  ...old,
                  { role: "user", content: submitted },
                  {
                    role: "assistant",
                    content: response.answer,
                    citations: response.citations,
                    uncertainties: response.uncertainties,
                  },
                ]);
                setConversationId(response.conversationId);
                setQuestion("");
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <textarea
              ref={input}
              aria-label="Ask about your transactions"
              placeholder="Ask about your transactions…"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={3000}
            />
            <button
              aria-label="Send question"
              disabled={!available || busy || !question.trim()}
            >
              <ArrowUp size={18} />
            </button>
          </form>
          <footer>
            Answers use your access permissions. Review the linked source before
            acting.
          </footer>
        </aside>
      )}
    </>
  );
}
