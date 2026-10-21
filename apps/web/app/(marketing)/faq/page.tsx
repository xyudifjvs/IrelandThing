import { PageHead } from "../_components/Marketing";
import s from "../_components/marketing.module.css";
export default function Page() {
  return (
    <>
      <PageHead eyebrow="FAQ" title="Frequently asked questions.">
        Read about services, intake, payment and portal access. Contact Ireland
        if you have a question about your file.
      </PageHead>
      <div className={s.faq}>
        {[
          [
            "How do I get started?",
            "Request a meeting through New Agent Onboarding. Ireland will review the services you need and your service agreement before arranging portal access.",
          ],
          [
            "Which service is right for my file?",
            "Essentials covers contract-to-close coordination. Complete adds broker file and compliance support. Full Listing includes Complete and adds seller pre-listing support. Ask Ireland if you’re unsure which service your file needs.",
          ],
          [
            "Can you contact my client directly?",
            "Choose your contact instructions during intake: Ireland may contact your client and copy you, or communicate only through you. Those instructions are saved with your transaction.",
          ],
          [
            "What do I need to submit a transaction?",
            "Submit the property and client details and an executed contract. Complete and Full Listing also require brokerage information. When Dotloop is connected, those services can reference a loop; otherwise, upload the contract. Full Listing can begin before a contract is executed.",
          ],
          [
            "When is payment due?",
            "Ireland will confirm service fee timing during onboarding. Closing gift availability and pricing require confirmation, and gifts must be paid for before ordering.",
          ],
          [
            "What can clients see?",
            "Clients invited to a file can see the milestones and documents shared with them. They cannot see Ireland’s private notes or internal tasks.",
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
