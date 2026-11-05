import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Leaf,
  CalendarCheck,
  Handshake,
  Gift,
} from "lucide-react";
import s from "./marketing.module.css";
export { pages } from "./MarketingHeader";
import MarketingHeader from "./MarketingHeader";
import chrome from "./reference-marketing.module.css";
export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className={chrome.site}>
      <MarketingHeader />
      <main
        id="main-content"
        tabIndex={-1}
        className={`${s.main} ${chrome.main}`}
      >
        {children}
      </main>
      <footer className={chrome.footer}>
        <p className={chrome.footerBrand}>WEATHERLY TRANSACTION CO.</p>
        <div className={chrome.contact}>
          <a href="mailto:ireland@weatherlytc.com">ireland@weatherlytc.com</a>
          <a href="tel:+14193665265">419-366-5265</a>
        </div>
        <p className={chrome.copyright}>© 2026 Weatherly Transaction Co.</p>
      </footer>
    </div>
  );
}
export function PageHead({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className={s.pageHead}>
      <p className={s.eyebrow}>{eyebrow}</p>
      <h1>{title}</h1>
      {children && <p>{children}</p>}
    </div>
  );
}
export function CTA() {
  return (
    <section className={s.cta}>
      <p className={s.eyebrow}>Work with Ireland</p>
      <h2>Discuss your next transaction.</h2>
      <p>
        Tell Ireland about your transaction, the support you need and your
        brokerage’s requirements.
      </p>
      <div className={s.actions}>
        <Link className={s.button} href="/onboarding">
          Request a meeting <ArrowUpRight size={13} />
        </Link>
      </div>
    </section>
  );
}
export function About() {
  return (
    <>
      <section className={s.hero}>
        <div>
          <p className={s.eyebrow}>Support for real estate agents</p>
          <h1>
            Transaction coordination <em>with Ireland.</em>
          </h1>
          <p className={s.lead}>
            Ireland coordinates contracts, deadlines, documents and follow-up
            for buyer and seller transactions. Choose Contract to Close or
            Contract to Close + Compliance.
          </p>
          <div className={s.actions}>
            <Link className={s.button} href="/onboarding">
              Work with Ireland <ArrowUpRight size={13} />
            </Link>
            <Link className={s.secondary} href="/services">
              View services and pricing <ArrowRight size={13} />
            </Link>
          </div>
        </div>
        <div className={s.portrait}>
          <Image
            src="/brand/portrait.jpeg"
            alt="Ireland, founder of Weatherly Transaction Co."
            width={1023}
            height={1537}
            sizes="(max-width: 700px) 90vw, 410px"
            preload
          />
          <div className={s.portraitCaption}>
            Ireland<small>Your transaction coordinator</small>
          </div>
        </div>
      </section>
      <div className={s.ribbon}>
        <span>
          <Leaf />
          Transaction intake
        </span>
        <span>
          <CalendarCheck />
          Deadline tracking
        </span>
        <span>
          <Handshake />
          Transaction updates
        </span>
      </div>
      <section className={s.section}>
        <div className={s.bioGrid}>
          <div>
            <p className={s.eyebrow}>Meet your coordinator</p>
            <h2 className={s.sectionTitle}>Hello, I’m Ireland.</h2>
            <p className={s.body}>
              I work with real estate agents to organize transaction files,
              track deadlines and coordinate with title companies and lenders.
            </p>
            <p className={s.body}>
              Before we start, we’ll review your service level, brokerage
              requirements and how you want me to communicate with your clients.
            </p>
            <Link className={s.textLink} href="/onboarding">
              Ask about working together <ArrowUpRight size={12} />
            </Link>
          </div>
          <div className={s.bioAccent}>
            I keep track of the paperwork and follow up on what’s missing.
          </div>
        </div>
      </section>
      <CTA />
    </>
  );
}
export function Services() {
  return (
    <>
      <PageHead
        eyebrow="Services and pricing"
        title="Transaction coordination services."
      >
        Contract to Close and Contract to Close + Compliance support buyer or
        seller transactions. Full Listing is coming soon.
      </PageHead>
      <div className={s.cards}>
        {[
          {
            name: "Contract to Close",
            tag: "Contract to Close",
            price: 425,
            list: [
              "Contract intake and timeline",
              "Deadline tracking and status updates",
              "Title, lender and closing coordination",
            ],
            code: "essentials",
          },
          {
            name: "Contract to Close + Compliance",
            tag: "Coordination and Compliance",
            price: 515,
            list: [
              "Everything in Contract to Close",
              "Document review and broker checklist",
              "File submission and post-closing follow-up",
            ],
            code: "complete",
          },
          {
            name: "Full Listing",
            tag: "Pre-listing through closing",
            price: null,
            list: [
              "Everything in Contract to Close + Compliance",
              "Pre-listing paperwork and disclosures",
              "Listing support through closing",
            ],
            code: "full_listing",
          },
        ].map((p, i) => (
          <article
            className={`${s.card} ${i === 1 ? s.recommended : ""}`}
            key={p.name}
          >
            {i === 1 && (
              <div className={s.cardTag}>Includes broker file support</div>
            )}
            <p className={s.eyebrow}>{p.tag}</p>
            <h2>{p.name}</h2>
            <p className={s.price}>
              {p.price === null ? "Coming soon" : `$${p.price}`}
            </p>
            <small>
              {p.code === "full_listing"
                ? "Not available for new transactions"
                : "Buyer or seller side · USD per transaction"}
            </small>
            <ul>
              {p.list.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
            {p.code === "full_listing" ? (
              <button className={s.secondary} disabled>
                Coming soon
              </button>
            ) : (
              <Link className={s.secondary} href="/onboarding">
                Ask about this service <ArrowUpRight size={12} />
              </Link>
            )}
          </article>
        ))}
      </div>
      <section className={s.gift}>
        <div>
          <p className={s.eyebrow}>Closing gifts</p>
          <h2>Add a closing gift.</h2>
          <p>
            Ask Ireland about gift options and personalization. The gift, total
            price and terms must be confirmed before payment.
            <br />
            Gifts must be paid for before ordering. Ireland will confirm when
            your service fee is due during onboarding.
          </p>
        </div>
        <Gift size={37} strokeWidth={0.8} color="#aa9068" />
      </section>
      <CTA />
    </>
  );
}
