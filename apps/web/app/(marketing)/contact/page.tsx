import { PageHead } from "../_components/Marketing";
import InquiryForm from "../_components/InquiryForm";
import s from "../_components/marketing.module.css";
export default function Page() {
  return (
    <>
      <PageHead
        eyebrow="Let’s talk"
        title="Good things start with a conversation."
      >
        Tell me what you’re working on and how I can help.
      </PageHead>
      <div className={s.twoCol}>
        <section className={s.panel}>
          <h2>Get in touch</h2>
          <InquiryForm />
        </section>
        <section className={s.panel} style={{ alignSelf: "start" }}>
          <p className={s.eyebrow}>Weatherly Transaction Co.</p>
          <h2>Here for the details.</h2>
          <p>
            For onboarding questions, a new transaction, or finding the right
            level of support, send a note using this form.
          </p>
          <div className={s.notice}>
            Mailbox setup is pending. ireland@ireland.com is a placeholder and
            is not used to send or receive your request. Form submissions are
            securely recorded for Ireland to review.
          </div>
          <p>Service area and contact details will be confirmed by Ireland.</p>
        </section>
      </div>
    </>
  );
}
