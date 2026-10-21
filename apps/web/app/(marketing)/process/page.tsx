import { PageHead, CTA } from "../_components/Marketing";
import s from "../_components/marketing.module.css";
export default function Page() {
  return (
    <>
      <PageHead eyebrow="How it works" title="From intake to closing.">
        Submit your file, review the transaction details with Ireland and follow
        progress in your portal.
      </PageHead>
      <div className={s.cards}>
        {[
          [
            "01",
            "Submit your transaction",
            "Choose a service level and submit the property details, client information and contract through your portal. Full Listing can begin with seller paperwork before a contract is signed.",
          ],
          [
            "02",
            "Review the file with Ireland",
            "Ireland reviews the contract dates, organizes the documents and sets up the transaction checklist. Broker file support is included with Complete and Full Listing.",
          ],
          [
            "03",
            "Follow your transaction",
            "Check tasks, documents and confirmed dates in your agent portal. Ireland follows the client contact instructions you choose during intake.",
          ],
        ].map(([n, title, text]) => (
          <section className={s.card} key={n}>
            <div className={s.number}>{n}</div>
            <h2>{title}</h2>
            <p>{text}</p>
          </section>
        ))}
      </div>
      <CTA />
    </>
  );
}
