import { PageHead } from "../_components/Marketing";
import InquiryForm from "../_components/InquiryForm";
import s from "../_components/marketing.module.css";
export default function Page() {
  return (
    <>
      <PageHead eyebrow="New agent onboarding" title="Let’s get acquainted.">
        A quick conversation is a good place to start. Tell me a little about
        your business and the support you’re looking for.
      </PageHead>
      <div className={s.twoCol}>
        <section className={s.panel}>
          <h2>Request a conversation</h2>
          <p>
            Choose a preferred time. This is a request; availability will be
            confirmed separately.
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
              Payment arrangements through Ireland’s own Stripe account and your
              service agreement.
            </p>
            <p>
              Portal access follows Ireland’s review of your onboarding and
              service agreement.
            </p>
          </section>
          <section className={s.panel} style={{ marginTop: 22 }}>
            <h2>Prefer the details first?</h2>
            <p>Request information to review on your own time.</p>
            <InquiryForm kind="information" />
          </section>
        </div>
      </div>
    </>
  );
}
