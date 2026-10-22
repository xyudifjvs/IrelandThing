import type { ReactNode } from "react";
import { MarketingShell } from "./_components/Marketing";
import { organizationData } from "../_lib/seo";
export default function Layout({ children }: { children: ReactNode }) {
  const organization = organizationData();
  return (
    <MarketingShell>
      {organization && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(organization).replace(/</g, "\\u003c"),
          }}
        />
      )}
      {children}
    </MarketingShell>
  );
}
