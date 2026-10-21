import { PageHead, CTA } from "../_components/Marketing";
import s from "../_components/marketing.module.css";
export const metadata = {
  title: "Testimonials",
  robots: { index: false, follow: false },
};
export default function Page() {
  return (
    <>
      <PageHead eyebrow="Agent feedback" title="Testimonials.">
        Testimonials will be published here only with approval.
      </PageHead>
      <div className={s.quote}>
        No testimonials are published yet.
        <p style={{ font: "12px/1.9 Arial,sans-serif" }}>
          To ask about working with Ireland, use the onboarding or contact form.
        </p>
      </div>
      <CTA />
    </>
  );
}
