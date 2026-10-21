import type { Metadata } from "next";
import "./globals.css";
import { AssistantPanel } from "@weatherly/assistant-ui";
import { sitePolicy } from "./_lib/seo";
import localFont from "next/font/local";
const serif = localFont({
  src: "../public/fonts/cormorant-garamond-latin.woff2",
  weight: "400 600",
  display: "swap",
  variable: "--weatherly-serif",
});
const sans = localFont({
  src: "../public/fonts/dm-sans-latin.woff2",
  weight: "400 700",
  display: "swap",
  variable: "--weatherly-sans",
});
export const metadata: Metadata = {
  title: { default: "Weatherly Transaction Co.", template: "%s · Weatherly" },
  description:
    "Transaction coordination for real estate agents. Ireland manages documents, deadlines and closing details through Weatherly Transaction Co.",
  metadataBase: sitePolicy().origin ? new URL(sitePolicy().origin!) : undefined,
  robots: { index: false, follow: false },
  icons: { icon: "/brand/icon.jpeg", apple: "/brand/icon.jpeg" },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        {children}
        <AssistantPanel />
      </body>
    </html>
  );
}
