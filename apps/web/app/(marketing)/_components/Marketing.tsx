import type { ReactNode } from "react";
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
