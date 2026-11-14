import { RosterWorkspace } from "../_features/roster/RosterWorkspace";

export const dynamic = "force-dynamic";

export default async function RosterPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string | string[] }>;
}) {
  const { agent } = await searchParams;
  const id = typeof agent === "string" && agent.length <= 240 ? agent : null;
  return <RosterWorkspace key={id ?? "roster"} initialAgentId={id} />;
}
