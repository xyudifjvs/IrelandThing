import type { Metadata } from "next";
import ClientChecklist from "./ClientChecklist";
import { connection } from "next/server";
export const metadata: Metadata = {
  title: "Client checklist",
  robots: { index: false, follow: false, noarchive: true },
  referrer: "no-referrer",
};
export default async function Page() {
  await connection();
  return <ClientChecklist />;
}
