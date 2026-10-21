import { PageHead } from "../_components/Marketing";
import InquiryForm from "../_components/InquiryForm";
import s from "../_components/marketing.module.css";
export default function Page() {
  return (
    <>
      <PageHead
        eyebrow="New agent onboarding"
        title="Start working with Ireland."
      >
        Tell me about your transactions and the support you need. We’ll review
        services, your brokerage’s requirements and how to submit a new file.
      </PageHead>
      <div className={s.twoCol}>
        <section className={s.panel}>
          <h2>Request a meeting</h2>
          <p>
            Suggest a date and time. Ireland will need to confirm the meeting.
          </p>
          <InquiryForm kind="meeting" />
        </section>
        <div>
          <section className={s.panel}>
            <h2>What we’ll cover</h2>
            <p>
              Your service options and pricing.
              <br />
              What happens when a contract comes in.
              <br />
              Portal access and transaction updates.
              <br />
              Service fees, payment timing and your service agreement.
            </p>
            <p>
              Ireland will review your onboarding and service agreement before
              inviting you to the portal.
            </p>
          </section>
          <section className={s.panel} style={{ marginTop: 22 }}>
            <h2>Request service information</h2>
            <p>
              Use this form if you’d like service information before requesting
              a meeting.
            </p>
            <InquiryForm kind="information" />
          </section>
        </div>
      </div>
    </>
  );
}
