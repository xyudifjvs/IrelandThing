import type { Metadata } from "next";
import "./globals.css";
import { AssistantPanel } from "@weatherly/assistant-ui";
export const metadata: Metadata = {
  title: { default: "Weatherly Transaction Co.", template: "%s · Weatherly" },
  description:
    "Transaction coordination for real estate agents. Ireland manages documents, deadlines and closing details through Weatherly Transaction Co.",
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
