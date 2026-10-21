import type { Metadata } from "next";
import "./globals.css";
import { AssistantPanel } from "@weatherly/assistant-ui";
export const metadata: Metadata = {
  title: { default: "Weatherly Transaction Co.", template: "%s · Weatherly" },
  description:
    "Thoughtful transaction coordination, from the first detail to the final signature.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <AssistantPanel />
      </body>
    </html>
  );
}
