import type { ReactNode } from "react";
import RouteFocus from "../(workspace)/workspace/_components/RouteFocus";
export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main-content" tabIndex={-1}>
      <RouteFocus />
      {children}
    </main>
  );
}
