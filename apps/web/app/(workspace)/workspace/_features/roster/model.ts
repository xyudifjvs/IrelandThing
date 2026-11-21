export const rosterEndpoint = "/api/v1/onboarding/roster";

export type AgentPhase =
  | "inquiry"
  | "agreement_sent"
  | "agreement_signed"
  | "invited"
  | "active"
  | "team_member"
  | "access_revoked";

export type RosterEntry = {
  id: string;
  userId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  brokerage: string | null;
  business: "hto" | "weatherly";
  revision: number | null;
  source: {
    kind: "user" | "inquiry" | "booking" | "agreement" | "invitation";
    id: string;
  } | null;
  hasAccount: boolean;
  portalUserId?: string | null;
  personalTest?: boolean;
  canArchive: boolean;
  phase: AgentPhase;
  phaseOn: string;
  agreementSentOn: string | null;
  agreementOnFile: boolean;
  booking: { startAt: string; timezone: string | null } | null;
  invitation: {
    acceptedAt: string | null;
    expiresAt: string;
    createdAt: string;
  } | null;
  activeFileCount: number;
  closedFileCount: number;
};

export type ArchivedRosterEntry = Pick<
  RosterEntry,
  "id" | "name" | "email" | "brokerage" | "business"
> & {
  revision: number;
  archivedAt: string;
};

export type RosterDetail = RosterEntry & {
  agreementHistory: {
    id: string;
    version: string;
    status: string;
    documentId: string | null;
    supportingDocumentIds: string[];
    signedOn: string | null;
    createdAt: string;
  }[];
  inquiries: {
    id: string;
    kind: string;
    createdAt: string;
    payload: Record<string, unknown>;
  }[];
  files: { id: string; propertyAddress: string; stage: string }[];
};

export type RosterAction = "agreement" | "sent" | "invite" | null;

export const phaseLabel: Record<AgentPhase, string> = {
  inquiry: "Inquiry",
  agreement_sent: "Agreement sent",
  agreement_signed: "Agreement signed",
  invited: "Invited",
  active: "Active",
  team_member: "Team member",
  access_revoked: "Access revoked",
};

export function rosterDate(value: string) {
  const civil = value.length === 10;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: civil ? "UTC" : "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(civil ? value + "T12:00:00Z" : value));
}

export function nextRosterAction(
  agent: RosterEntry,
): { kind: NonNullable<RosterAction>; label: string } | null {
  switch (agent.phase) {
    case "inquiry":
      return { kind: "sent", label: "Mark agreement sent" };
    case "agreement_sent":
      return { kind: "agreement", label: "Upload signed agreement" };
    case "agreement_signed":
      return { kind: "invite", label: "Send portal invite" };
    case "invited":
      return { kind: "invite", label: "Resend invite" };
    case "team_member":
      return agent.email && !agent.hasAccount
        ? { kind: "invite", label: "Send portal invite" }
        : null;
    default:
      return null;
  }
}

export function archivePrompt(agent: { name: string }) {
  return {
    title: `Archive ${agent.name}?`,
    body: "This hides the agent from your working roster, cancels unused invitations, and disables agent portal access. Transactions, documents, agreements, and history are kept. You can restore the entry later.",
    confirmLabel: "Archive agent",
  };
}
