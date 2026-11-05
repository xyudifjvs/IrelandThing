"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import s from "./reference-marketing.module.css";

export const pages = [
  ["/", "ABOUT ME"],
  ["/services", "SERVICES"],
  ["/process", "PROCESS"],
  ["/onboarding", "NEW AGENT ONBOARDING"],
  ["/agent-portal", "AGENT PORTAL"],
  ["/contact", "FAQ & CONTACT"],
];

export default function MarketingHeader() {
  const pathname = usePathname();
  return (
    <header className={s.header}>
      <Link className={s.brand} href="/">
        WEATHERLY TRANSACTION CO.
      </Link>
      <nav className={s.nav} aria-label="Main navigation">
        {pages.map(([href, label]) => (
          <Link
            key={href}
            href={href}
            aria-current={
              pathname === href || (href === "/contact" && pathname === "/faq")
                ? "page"
                : undefined
            }
          >
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
