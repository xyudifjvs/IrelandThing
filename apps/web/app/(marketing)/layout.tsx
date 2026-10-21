import type { ReactNode } from "react";
import { MarketingShell } from "./_components/Marketing";
export default function Layout({ children }: { children: ReactNode }) {
  return <MarketingShell>{children}</MarketingShell>;
}
