import { prisma, type Prisma } from "@weatherly/db";
import {
  matchingRosterInvitations,
  newestRosterInvitations,
  normalizeRosterEmail,
} from "@weatherly/identity/roster";
import {
  assertCoordinator,
  HttpError,
  type Principal,
} from "@weatherly/platform";
import { z } from "zod";

type LegacySource = {
  kind: "user" | "inquiry" | "booking" | "agreement" | "invitation";
  id: string;
};
type RosterPhase =
  | "inquiry"
  | "agreement_sent"
  | "agreement_signed"
  | "invited"
  | "active"
  | "team_member"
  | "access_revoked";

type Candidate = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  brokerage: string | null;
  business: "hto" | "weatherly" | null;
  userId: string | null;
  agreementSentOn: string | null;
  revision: number | null;
  createdAt: Date;
  source: LegacySource | null;
};

type StoredCandidate = Omit<Candidate, "source"> & { archivedAt: Date | null };

const byNewest = [{ createdAt: "desc" }, { id: "desc" }] as const;
const activeStages = new Set(["under_contract", "closing", "listing"]);

function civilDay(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

async function loadRoster(
  db: Prisma.TransactionClient,
  selected?: StoredCandidate,
) {
  const [
    roster,
    users,
    inquiries,
    bookings,
    agreements,
    invitations,
    files,
    revoked,
    overrides,
    personalTestInvites,
  ] = await Promise.all([
    selected
      ? [selected]
      : db.rosterAgent.findMany({
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            brokerage: true,
            business: true,
            userId: true,
            agreementSentOn: true,
            revision: true,
            archivedAt: true,
            createdAt: true,
          },
        }),
    db.user.findMany({
      where: { role: "agent" },
      select: {
        id: true,
        email: true,
        name: true,
        brokerage: true,
        createdAt: true,
      },
    }),
    db.inquiry.findMany({
      where: { status: { not: "closed" } },
      select: {
        id: true,
        rosterAgentId: true,
        name: true,
        email: true,
        kind: true,
        payload: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [...byNewest],
    }),
    db.schedulingBooking.findMany({
      where: { status: "confirmed" },
      select: {
        id: true,
        rosterAgentId: true,
        name: true,
        email: true,
        timezone: true,
        startAt: true,
        createdAt: true,
      },
      orderBy: [{ startAt: "desc" }, { id: "desc" }],
    }),
    db.agreement.findMany({
      select: {
        id: true,
        rosterAgentId: true,
        userId: true,
        version: true,
        status: true,
        documentId: true,
        supportingDocumentIds: true,
        signedOn: true,
        createdAt: true,
      },
      orderBy: [...byNewest],
    }),
    db.invitation.findMany({
      where: { role: "agent" },
      select: {
        id: true,
        rosterAgentId: true,
        email: true,
        expiresAt: true,
        acceptedAt: true,
        createdAt: true,
      },
      orderBy: newestRosterInvitations,
    }),
    selected
      ? []
      : db.matter.findMany({
          where: {
            OR: [{ agentRosterId: { not: null } }, { agentId: { not: null } }],
            stage: { notIn: ["pending_review", "archived"] },
          },
          select: {
            id: true,
            agentRosterId: true,
            agentId: true,
            propertyAddress: true,
            stage: true,
            business: true,
          },
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        }),
    db.auditEvent.findMany({
      where: {
        entityType: "User",
        action: { in: ["identity.access_revoked", "identity.access_restored"] },
      },
      distinct: ["entityId"],
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { entityId: true, action: true },
    }),
    db.auditEvent.findMany({
      where: { entityType: "User", action: "agent.access_override" },
      distinct: ["entityId"],
      select: { entityId: true },
    }),
    db.auditEvent.findMany({
      where: {
        entityType: "Invitation",
        action: "invitation.created",
        details: { path: ["personalTest"], equals: true },
      },
      select: { entityId: true },
    }),
  ]);
  const candidates: Candidate[] = roster
    .filter(({ archivedAt }) => !archivedAt)
    .map((row) => ({ ...row, source: null }));
  const represented = new Set(
    roster.flatMap(({ email }) => (email ? [normalizeRosterEmail(email)] : [])),
  );
  const usersById = new Map(users.map((user) => [user.id, user]));
  const usersByEmail = new Map(
    users.map((user) => [normalizeRosterEmail(user.email), user]),
  );
  const revokeById = new Map(
    revoked.map((event) => [event.entityId, event.action]),
  );
  const overrideIds = new Set(overrides.map((event) => event.entityId));
  const personalTestInviteIds = new Set(
    personalTestInvites.map((event) => event.entityId),
  );
  function legacyCandidate(
    record: { id: string; email: string; name: string; createdAt: Date },
    kind: LegacySource["kind"],
    profile: { phone?: string; brokerage?: string | null } = {},
  ) {
    const email = normalizeRosterEmail(record.email);
    if (represented.has(email)) return;
    represented.add(email);
    candidates.push({
      id: `legacy-${kind}-${record.id}`,
      name: record.name || email,
      email,
      phone: profile.phone || null,
      brokerage: profile.brokerage || null,
      business: "weatherly",
      userId: kind === "user" ? record.id : null,
      agreementSentOn: null,
      revision: null,
      createdAt: record.createdAt,
      source: { kind, id: record.id },
    });
  }
  if (!selected) {
    for (const user of users) legacyCandidate(user, "user", user);
    for (const inquiry of inquiries) {
      const payload = inquiry.payload;
      const fields =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? payload
          : {};
      if (!inquiry.rosterAgentId)
        legacyCandidate(inquiry, "inquiry", {
          phone: typeof fields.phone === "string" ? fields.phone : undefined,
          brokerage:
            typeof fields.brokerage === "string" ? fields.brokerage : undefined,
        });
    }
    for (const booking of bookings) {
      if (!booking.rosterAgentId) legacyCandidate(booking, "booking");
    }
    for (const agreement of agreements) {
      if (
        !agreement.rosterAgentId &&
        z.email().safeParse(agreement.userId).success
      )
        legacyCandidate(
          { ...agreement, email: agreement.userId, name: "" },
          "agreement",
        );
    }
    for (const invitation of invitations) {
      if (!invitation.rosterAgentId && !invitation.acceptedAt)
        legacyCandidate({ ...invitation, name: "" }, "invitation");
    }
  }

  return candidates
    .map((candidate) => {
      const email = candidate.email
        ? normalizeRosterEmail(candidate.email)
        : null;
      const account = candidate.userId
        ? usersById.get(candidate.userId)
        : candidate.business !== "hto" && email
          ? usersByEmail.get(email)
          : undefined;
      const matchesEmail = (other: string) =>
        email !== null && normalizeRosterEmail(other) === email;
      const matches = (record: {
        rosterAgentId: string | null;
        email: string;
      }) =>
        record.rosterAgentId === candidate.id ||
        (!record.rosterAgentId && matchesEmail(record.email));
      const attachedAgreements = agreements.filter(
        (record) =>
          record.rosterAgentId === candidate.id ||
          (!record.rosterAgentId &&
            ((account && record.userId === account.id) ||
              matchesEmail(record.userId))),
      );
      const signed = attachedAgreements.filter(
        (record) => record.status === "approved" && !!record.documentId,
      );
      const inquiryHistory = inquiries.filter(matches);
      const booking = bookings.find(matches) ?? null;
      const recipientInvitations = matchingRosterInvitations(
        invitations,
        candidate,
      );
      const pendingInvitation = recipientInvitations.find(
        (record) => !record.acceptedAt,
      );
      const invitation =
        pendingInvitation ?? recipientInvitations.at(0) ?? null;
      const sentRecord = attachedAgreements.find(
        (record) => record.status === "sent",
      );
      const sentInquiry = inquiryHistory.find(
        (record) => record.status === "agreement_sent",
      );
      const sentOn =
        candidate.agreementSentOn ??
        (sentRecord
          ? civilDay(sentRecord.createdAt)
          : sentInquiry
            ? civilDay(sentInquiry.updatedAt)
            : null);
      const matchingFiles = files.filter(
        (file) =>
          file.agentRosterId === candidate.id ||
          (!file.agentRosterId && account?.id === file.agentId),
      );
      const authorized =
        account &&
        (candidate.business === "hto" ||
          signed.some((record) => record.userId === account.id) ||
          overrideIds.has(account.id));
      let phase: RosterPhase = "inquiry";
      let phaseOn = civilDay(candidate.createdAt);
      if (account && revokeById.get(account.id) === "identity.access_revoked") {
        phase = "access_revoked";
      } else if (authorized) {
        phase = "active";
        const accepted = recipientInvitations.find(
          (record) => record.acceptedAt,
        );
        phaseOn = civilDay(accepted?.acceptedAt ?? account.createdAt);
      } else if (candidate.business === "hto") {
        phase = "team_member";
      } else if (pendingInvitation) {
        phase = "invited";
        phaseOn = civilDay(pendingInvitation.createdAt);
      } else if (signed.length) {
        phase = "agreement_signed";
        phaseOn = signed[0].signedOn ?? civilDay(signed[0].createdAt);
      } else if (sentOn) {
        phase = "agreement_sent";
        phaseOn = sentOn;
      }

      return {
        ...candidate,
        business: candidate.business ?? ("weatherly" as const),
        hasAccount: !!account,
        personalTest:
          signed.length === 0 &&
          !!invitation &&
          personalTestInviteIds.has(invitation.id),
        portalUserId: account?.id ?? null,
        canArchive: true,
        phase,
        phaseOn,
        agreementSentOn: sentOn,
        agreementOnFile: signed.length > 0,
        agreementHistory:
          candidate.business === "hto" ? [] : attachedAgreements,
        booking,
        invitation,
        inquiries: inquiryHistory,
        files: matchingFiles,
        activeFileCount: matchingFiles.filter((file) =>
          activeStages.has(file.stage),
        ).length,
        closedFileCount: matchingFiles.filter((file) => file.stage === "closed")
          .length,
      };
    })
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, "en", { sensitivity: "base" }) ||
        a.id.localeCompare(b.id),
    );
}

export async function canArchiveRosterInquiry(
  db: Prisma.TransactionClient,
  row: StoredCandidate,
) {
  const [entry] = await loadRoster(db, row);
  return (
    !!entry &&
    entry.phase === "inquiry" &&
    !entry.userId &&
    !entry.hasAccount &&
    !entry.invitation &&
    !entry.agreementHistory.some((item) =>
      ["received", "approved"].includes(item.status),
    )
  );
}

export async function listRoster(actor: Principal) {
  assertCoordinator(actor);
  const entries = await prisma.$transaction(loadRoster, {
    isolationLevel: "RepeatableRead",
  });
  return entries.map(
    ({
      files: _files,
      inquiries: _inquiries,
      agreementHistory: _agreements,
      ...row
    }) => row,
  );
}

/** Archived contact records stay private and separate from active agent choices. */
export async function listArchivedRoster(actor: Principal) {
  assertCoordinator(actor);
  return prisma.rosterAgent.findMany({
    where: { archivedAt: { not: null } },
    select: {
      id: true,
      name: true,
      email: true,
      brokerage: true,
      business: true,
      revision: true,
      archivedAt: true,
    },
    orderBy: [{ archivedAt: "desc" }, { id: "asc" }],
  });
}

export async function getRosterAgent(actor: Principal, id: string) {
  assertCoordinator(actor);
  const entries = await prisma.$transaction(loadRoster, {
    isolationLevel: "RepeatableRead",
  });
  const row = entries.find((entry) => entry.id === id);
  if (!row)
    throw new HttpError(
      404,
      "ROSTER_AGENT_NOT_FOUND",
      "Agent not found on the roster.",
    );
  return row;
}
