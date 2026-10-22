"use client";
import { useData, date } from "../../../(workspace)/workspace/_components/data";
import s from "./portal.module.css";
type Message = {
  id: string;
  fromEmail: string;
  subject: string;
  text: string;
  sentAt: string;
};
export default function SharedMessages({ matterId }: { matterId: string }) {
  const q = useData<Message[]>(
    `/api/v1/communications/messages?matterId=${encodeURIComponent(matterId)}`,
  );
  return (
    <>
      <h2 className={s.sectionHead}>Shared conversations</h2>
      <section className={s.card}>
        {q.loading ? (
          <p className={s.hint}>Loading shared messages…</p>
        ) : q.error ? (
          <p className={s.error}>{q.error}</p>
        ) : q.data?.length ? (
          q.data.map((m) => (
            <details key={m.id} className={s.note}>
              <summary
                style={{
                  cursor: "pointer",
                  fontFamily: "Georgia",
                  fontSize: 18,
                }}
              >
                {m.subject || "Transaction update"}
              </summary>
              <p className={s.hint}>
                From {m.fromEmail} · {date(m.sentAt)}
              </p>
              <p style={{ whiteSpace: "pre-wrap" }}>{m.text}</p>
            </details>
          ))
        ) : (
          <p>
            Your coordinator will share reviewed transaction messages here.
            Private mailbox history is not included.
          </p>
        )}
      </section>
    </>
  );
}
