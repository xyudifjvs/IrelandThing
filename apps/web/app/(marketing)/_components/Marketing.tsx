import Link from "next/link";
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
export const pages = [
  ["/", "About Me"],
  ["/services", "Services"],
  ["/process", "Process"],
  ["/onboarding", "New Agent Onboarding"],
  ["/testimonials", "Testimonials"],
  ["/faq", "FAQ"],
  ["/agent-portal", "Agent Portal"],
  ["/contact", "Contact"],
];
export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className={s.site}>
      <header className={s.header}>
        <Link className={s.brand} href="/" aria-label="Weatherly home">
          <span>WEATHERLY</span>
          <small>TRANSACTION CO.</small>
        </Link>
        <nav className={s.nav} aria-label="Main navigation">
          {pages.map(([href, name]) => (
            <Link
              key={href}
              href={href}
              className={href === "/agent-portal" ? s.portal : ""}
            >
              {name}
            </Link>
          ))}
        </nav>
      </header>
      <main className={s.main}>{children}</main>
      <footer className={s.footer}>
        <div className={s.footerTop}>
          <div>
            <Link className={s.brand} style={{ margin: 0 }} href="/">
              <span style={{ fontSize: 20 }}>WEATHERLY</span>
              <small>TRANSACTION CO.</small>
            </Link>
            <p>Transaction coordination with Ireland.</p>
          </div>
          <div>
            <Link href="/onboarding">Work with Ireland</Link>
            <Link href="/agent-portal">Agent portal</Link>
            <Link href="/contact">
              Get in touch <ArrowUpRight size={10} />
            </Link>
          </div>
        </div>
        <div className={s.footerBottom}>
          <p>© {new Date().getFullYear()} Weatherly Transaction Co.</p>
          <Link href="/faq">Frequently asked questions</Link>
        </div>
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
            for buyer and seller transactions. Choose contract-to-close support
            or seller pre-listing coordination.
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
          <img
            src="/brand/portrait.jpeg"
            alt="Ireland, founder of Weatherly Transaction Co."
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
        Choose from three service levels. Essentials and Complete support buyer
        or seller transactions. Full Listing is for seller transactions.
      </PageHead>
      <div className={s.cards}>
        {[
          {
            name: "Essentials",
            tag: "Contract to Close",
            price: 375,
            list: [
              "Contract intake and timeline",
              "Deadline tracking and status updates",
              "Title, lender and closing coordination",
            ],
            code: "essentials",
          },
          {
            name: "Complete",
            tag: "Coordination and Compliance",
            price: 475,
            list: [
              "Everything in Essentials",
              "Document review and broker checklist",
              "File submission and post-closing follow-up",
            ],
            code: "complete",
          },
          {
            name: "Full Listing",
            tag: "Pre-listing through closing",
            price: 625,
            list: [
              "Everything in Complete",
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
            <p className={s.price}>${p.price}</p>
            <small>
              {p.code === "full_listing"
                ? "Seller side only"
                : "Buyer or seller side"}{" "}
              · USD per transaction
            </small>
            <ul>
              {p.list.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
            <Link className={s.secondary} href="/onboarding">
              Ask about this service <ArrowUpRight size={12} />
            </Link>
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
