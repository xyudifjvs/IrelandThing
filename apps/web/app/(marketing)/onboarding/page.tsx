import { publicMetadata } from "../../_lib/seo";
export const metadata = publicMetadata("/onboarding");
import { PageHead } from "../_components/Marketing";
import CalendlyScheduling from "../_components/CalendlyScheduling";
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
      <CalendlyScheduling />
      <div className={s.twoCol} style={{ marginTop: 22 }}>
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
        <section className={s.panel}>
          <h2>Request service information</h2>
          <p>
            Use this form if you’d like service information before booking a
            meeting.
          </p>
          <InquiryForm kind="information" />
        </section>
      </div>
    </>
  );
}
