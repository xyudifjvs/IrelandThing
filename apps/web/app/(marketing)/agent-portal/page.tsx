import Link from "next/link";
import { PageHead } from "../_components/Marketing";
import InquiryForm from "../_components/InquiryForm";
import s from "../_components/marketing.module.css";
export default function Page() {
  return (
    <>
      <PageHead eyebrow="For agents" title="A home for your transactions.">
        Submit a new intake, follow your files and keep the next step in view.
      </PageHead>
      <div className={s.twoCol}>
        <section className={s.panel}>
          <p className={s.eyebrow}>Already working together?</p>
          <h2>Welcome back.</h2>
          <p>
            Your secure portal keeps your transaction details, shared tasks,
            documents and payments together.
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
          <p className={s.eyebrow}>New here?</p>
          <h2>Let’s connect first.</h2>
          <p>
            Portal access follows onboarding and your service agreement. Request
            information below, or{" "}
            <Link href="/onboarding" className={s.textLink}>
              request a conversation
            </Link>
            .
          </p>
          <InquiryForm kind="information" />
        </section>
      </div>
    </>
  );
}
