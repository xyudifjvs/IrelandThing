import { publicMetadata } from "../../_lib/seo";
export const metadata = publicMetadata("/agent-portal");
import Link from "next/link";
import { PageHead } from "../_components/Marketing";
import InquiryForm from "../_components/InquiryForm";
import s from "../_components/marketing.module.css";
export default function Page() {
  return (
    <>
      <PageHead eyebrow="For agents" title="Your transaction files.">
        Submit a transaction and check its tasks, documents and dates.
      </PageHead>
      <div className={s.twoCol}>
        <section className={s.panel}>
          <p className={s.eyebrow}>Current agents</p>
          <h2>Open your agent portal</h2>
          <p>
            Sign in to view your transaction details, shared tasks, documents
            and payment records.
          </p>
          <div className={s.actions}>
            <Link className={s.button} href="/login">
              Log in to your portal
            </Link>
            <Link className={s.secondary} href="/portal">
              Open portal
            </Link>
          </div>
        </section>
        <section className={s.panel}>
          <p className={s.eyebrow}>New agents</p>
          <h2>Request portal access</h2>
          <p>
            Ireland will review your onboarding and service agreement before
            inviting you. Request information below, or{" "}
            <Link href="/onboarding" className={s.textLink}>
              request a meeting
            </Link>
            .
          </p>
          <InquiryForm kind="information" />
        </section>
      </div>
    </>
  );
}
