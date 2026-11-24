import { RichEmailPreview } from "./RichEmailEditor";
import { date } from "../../_components/data";
import s from "../../_components/workspace.module.css";
import styles from "./file-email.module.css";
import type { Draft, FileEmailMessage, FileEmailThread } from "./email-model";

function MessageRecipients({ to, cc }: { to: string[]; cc: string[] }) {
  return (
    <>
      <p>To {to.join(", ")}</p>
      {cc.length > 0 && <p>CC {cc.join(", ")}</p>}
    </>
  );
}

export function FileEmailHistory({
  sent,
  threads,
  reply,
}: {
  sent: Draft[];
  threads: FileEmailThread[];
  reply?: (message: FileEmailMessage) => void;
}) {
  const draftById = new Map(sent.map((draft) => [draft.id, draft]));
  const draftByMessage = new Map(
    sent
      .filter((draft) => draft.providerMessageId)
      .map((draft) => [draft.providerMessageId, draft]),
  );
  const matchDraft = (message: FileEmailMessage) =>
    message.direction === "outbound"
      ? (draftById.get(message.details?.approvedDraftId || "") ??
        draftByMessage.get(message.providerMessageId))
      : undefined;
  const linkedDrafts = new Set(
    threads.flatMap((thread) =>
      thread.messages.map((message) => matchDraft(message)?.id),
    ),
  );
  return (
    <div className={styles.group}>
      <h3>Email history</h3>
      {!sent.length && !threads.length && (
        <p className={s.muted}>No emails on this file.</p>
      )}
      {threads.map((thread) => {
        const messages = [...thread.messages].sort((a, b) =>
          a.sentAt.localeCompare(b.sentAt),
        );
        const byInternetId = new Map(
          messages.map((message) => [
            message.details?.internetMessageId,
            message,
          ]),
        );
        return (
          <details key={thread.id} className={styles.history}>
            <summary>
              {thread.subject || messages[0]?.subject || "Email conversation"}
            </summary>
            {messages.map((message) => {
              const draft = matchDraft(message);
              const parent = message.details?.inReplyTo
                ? byInternetId.get(message.details.inReplyTo)
                : undefined;
              const inbound = message.direction === "inbound";
              return (
                <article
                  key={message.id}
                  className={
                    inbound ? styles.threadReply : styles.threadMessage
                  }
                >
                  <strong>{draft?.subject ?? message.subject}</strong>
                  <p>
                    {inbound ? `From ${message.fromEmail}` : "Sent"} ·{" "}
                    {date(draft?.sentAt ?? message.sentAt)}
                  </p>
                  {parent && (
                    <p className={s.fieldHint}>In reply to {parent.subject}</p>
                  )}
                  <MessageRecipients
                    to={draft?.to ?? message.to}
                    cc={draft?.cc ?? message.cc}
                  />
                  {draft?.bodyFormat === "html" ? (
                    <RichEmailPreview html={draft.body} />
                  ) : (
                    <p className={styles.message}>
                      {draft?.body ?? message.text}
                    </p>
                  )}
                  {inbound && reply && message.fromEmail && (
                    <button
                      type="button"
                      className={s.buttonSmall}
                      onClick={() => reply(message)}
                    >
                      Reply to {message.fromEmail}
                    </button>
                  )}
                </article>
              );
            })}
          </details>
        );
      })}
      {sent
        .filter((draft) => !linkedDrafts.has(draft.id))
        .map((draft) => (
          <details key={draft.id} className={styles.history}>
            <summary>{draft.subject}</summary>
            <MessageRecipients to={draft.to} cc={draft.cc} />
            {draft.bodyFormat === "html" ? (
              <RichEmailPreview html={draft.body} />
            ) : (
              <p className={styles.message}>{draft.body}</p>
            )}
          </details>
        ))}
    </div>
  );
}
