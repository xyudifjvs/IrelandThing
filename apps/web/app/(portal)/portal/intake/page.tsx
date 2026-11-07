"use client";
import Link from "next/link";
import Intake from "../_components/Intake";
import { useData, type Session } from "../../../(workspace)/workspace/_components/data";
export default function Page() {
  const session = useData<Session>("/api/v1/session");
  if (!session.data) return <p>{session.error || "Checking your account…"}</p>;
  if (session.data.user?.role !== "agent") return <div style={{padding:40}}><h1>Intake is for agents</h1><p>Review submitted intakes or start a transaction manually from your workspace.</p><Link href="/workspace/intakes">Open submitted intakes</Link></div>;
  return <Intake/>;
}
