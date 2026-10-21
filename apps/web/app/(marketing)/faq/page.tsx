import { PageHead } from "../_components/Marketing";
import s from "../_components/marketing.module.css";
export default function Page() {
  return (
    <>
      <PageHead eyebrow="A little clarity" title="Questions, answered.">
        Start here, or reach out to Ireland to talk through the details of your
        transaction.
      </PageHead>
      <div className={s.faq}>
        {[
          [
            "How do I get started?",
            "Request a conversation through New Agent Onboarding. Ireland can discuss your needs, confirm the service agreement and arrange portal access.",
          ],
          [
            "Which service is right for my file?",
            "Essentials is contract-to-close coordination. Complete adds compliance and paperwork support. Full Listing adds seller pre-listing support. Ireland can help you choose the right fit.",
          ],
          [
            "Can you contact my client directly?",
            "You choose the contact instruction in your intake: direct contact with you copied, or communication only through you. That preference stays with the file.",
          ],
          [
            "What do I need to submit a transaction?",
            "Your property and client details, brokerage information, and executed contract. Complete can reference an approved Dotloop loop. Full Listing can begin before a contract is executed.",
          ],
          [
            "When is payment due?",
            "Ireland will confirm service fee timing during onboarding. Closing gift availability and pricing require confirmation, and gifts must be paid for before ordering.",
          ],
          [
            "What can clients see?",
            "Authorized client access shows shared milestones and permitted documents. Coordinator private notes and internal tasks remain private.",
          ],
        ].map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
    </>
  );
}
