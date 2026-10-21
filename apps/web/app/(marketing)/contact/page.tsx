import { PageHead } from "../_components/Marketing";
import InquiryForm from "../_components/InquiryForm";
import s from "../_components/marketing.module.css";
export default function Page() {
  return (
    <>
      <PageHead eyebrow="Contact" title="Contact Ireland.">
        Ask about services, onboarding or a transaction you’d like help with.
      </PageHead>
      <div className={s.twoCol}>
        <section className={s.panel}>
          <h2>Send an inquiry</h2>
          <InquiryForm />
        </section>
        <section className={s.panel} style={{ alignSelf: "start" }}>
          <p className={s.eyebrow}>Weatherly Transaction Co.</p>
          <h2>Questions about working together?</h2>
          <p>
            Tell Ireland what you need help with and include any questions about
            your file or service options.
          </p>
          <div className={s.notice}>
            Direct email contact is not available yet. Use the form to save your
            request for Ireland to review. Submitting it does not send an email
            or confirm a meeting.
          </div>
          <p>
            Ask Ireland to confirm availability for your transaction and service
            area.
          </p>
        </section>
      </div>
    </>
  );
}
