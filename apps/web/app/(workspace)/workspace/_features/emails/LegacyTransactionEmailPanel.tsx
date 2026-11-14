import Link from "next/link";
import s from "../../_components/workspace.module.css";

export function LegacyTransactionEmailPanel({ id }: { id: string }) {
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <div>
          <h2>Transaction email</h2>
          <p>Connected email and drafts for the people on this deal.</p>
        </div>
      </div>
      <div className={s.sectionBody}>
        <div className={s.notice}>
          Gmail connection is required before messages can be synced or sent.
          Your coordinator’s contact permissions still apply.
        </div>
        <Link
          className={s.buttonSecondary}
          href={`/workspace/inbox?matterId=${id}`}
        >
          Open transaction inbox
        </Link>
      </div>
    </section>
  );
}
