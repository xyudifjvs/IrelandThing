import { z } from "zod";
import { prisma, Prisma } from "@weatherly/db";
import { requireMatter, matterScope, audit } from "@weatherly/matters";
import { assertCoordinator, type Principal } from "@weatherly/platform";
import { listMatters, getMatter, getChecklistShare } from "@weatherly/matters";
import { listDocuments } from "@weatherly/documents";
import { listPayments, listGifts } from "@weatherly/billing";
import {
  listMessages,
  listThreads,
  listDrafts,
} from "@weatherly/communications";
export const recordKinds = [
  "matters",
  "checklist_shares",
  "documents",
  "payments",
  "gifts",
  "dotloop_links",
  "messages",
  "threads",
  "email_drafts",
  "intake_drafts",
  "intake_submissions",
  "inquiries",
  "agreements",
  "catalog",
  "communication_templates",
  "workflow_templates",
  "ai_reviews",
  "activity",
  "integration_status",
  "job_status",
  "conversations",
] as const;
export const recordsInput = z
  .object({
    kind: z.enum(recordKinds),
    matterId: z.string().optional(),
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
/** Read-only projection registry for durable administrative records. Credential/token fields and job payloads are never projected. */
export async function queryStoredRecords(actor: Principal, raw: unknown) {
  const input = recordsInput.parse(raw);
  if (input.matterId) await requireMatter(actor, input.matterId);
  const pagination = {
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  };
  let items: unknown[];
  switch (input.kind) {
    case "checklist_shares": {
      if (actor.role !== "coordinator" && actor.role !== "agent")
        assertCoordinator(actor);
      const shares = await prisma.checklistShare.findMany({
        where: {
          matter: matterScope(actor),
          ...(input.matterId ? { matterId: input.matterId } : {}),
        },
        select: { id: true, matterId: true, revokedAt: true },
        ...pagination,
        orderBy: { id: "asc" },
      });
      items = await Promise.all(
        shares.map(async (row) => ({
          ...row,
          ...(await getChecklistShare(actor, row.matterId)),
        })),
      );
      break;
    }
    case "messages":
      items = await listMessages(actor, input.matterId, {
        cursor: input.cursor,
        limit: input.limit + 1,
      });
      break;
    case "threads":
      items = await listThreads(actor, input.matterId, {
        cursor: input.cursor,
        limit: input.limit + 1,
      });
      break;
    case "email_drafts":
      items = await listDrafts(actor, input.matterId, {
        cursor: input.cursor,
        limit: input.limit + 1,
      });
      break;
    case "matters":
      items = input.matterId
        ? input.cursor
          ? []
          : [await getMatter(actor, input.matterId)]
        : await listMatters(actor, {
            cursor: input.cursor,
            limit: input.limit + 1,
          });
      break;
    case "documents":
      items = await listDocuments(actor, input.matterId, {
        cursor: input.cursor,
        limit: input.limit + 1,
      });
      break;
    case "payments":
      items = await listPayments(actor, input.matterId, {
        cursor: input.cursor,
        limit: input.limit + 1,
      });
      break;
    case "gifts":
      items = await listGifts(actor, input.matterId, {
        cursor: input.cursor,
        limit: input.limit + 1,
      });
      break;
    case "dotloop_links":
      assertCoordinator(actor);
      items = await prisma.dotloopLink.findMany({
        where: {
          ownerId: actor.id,
          ...(input.matterId ? { matterId: input.matterId } : {}),
        },
        ...pagination,
        orderBy: { id: "asc" },
      });
      break;
    case "intake_drafts":
      if (actor.role !== "coordinator") assertCoordinator(actor); // Intake drafts may contain contacts not shared through client portals.
      items = await prisma.intakeDraft.findMany({
        where: input.matterId ? { submittedMatterId: input.matterId } : {},
        ...pagination,
        orderBy: { id: "asc" },
      });
      break;
    case "intake_submissions":
      assertCoordinator(actor);
      items = await prisma.intakeSubmission.findMany({
        where: input.matterId ? { matterId: input.matterId } : {},
        ...pagination,
        orderBy: { id: "asc" },
      });
      break;
    case "inquiries":
      assertCoordinator(actor);
      items = await prisma.inquiry.findMany({
        ...pagination,
        orderBy: { id: "asc" },
      });
      break;
    case "agreements":
      assertCoordinator(actor);
      items = await prisma.agreement.findMany({
        ...pagination,
        orderBy: { id: "asc" },
      });
      break;
    case "catalog":
      assertCoordinator(actor);
      items = await prisma.catalogItem.findMany({
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { code: input.cursor }, skip: 1 } : {}),
        orderBy: { code: "asc" },
      });
      break;
    case "communication_templates":
      assertCoordinator(actor);
      items = await prisma.communicationTemplate.findMany({
        ...pagination,
        orderBy: { id: "asc" },
      });
      break;
    case "workflow_templates":
      assertCoordinator(actor);
      items = await prisma.workflowTemplate.findMany({
        ...pagination,
        orderBy: { id: "asc" },
      });
      break;
    case "ai_reviews":
      assertCoordinator(actor);
      items = await prisma.aIProposal.findMany({
        where: input.matterId ? { matterId: input.matterId } : {},
        ...pagination,
        orderBy: { id: "asc" },
      });
      break;
    case "activity":
      assertCoordinator(actor);
      items = await prisma.auditEvent.findMany({
        where: input.matterId ? { matterId: input.matterId } : {},
        ...pagination,
        orderBy: { id: "asc" },
      });
      break;
    case "integration_status":
      assertCoordinator(actor);
      items = await prisma.integrationConnection.findMany({
        where: { ownerId: actor.id },
        select: {
          id: true,
          provider: true,
          status: true,
          displayEmail: true,
          lastSyncedAt: true,
          expiresAt: true,
          createdAt: true,
          updatedAt: true,
        },
        ...pagination,
        orderBy: { id: "asc" },
      });
      break;
    case "job_status":
      assertCoordinator(actor);
      items = await prisma.outboxJob.findMany({
        select: {
          id: true,
          topic: true,
          state: true,
          attempts: true,
          availableAt: true,
          leaseUntil: true,
          createdAt: true,
          updatedAt: true,
        },
        ...pagination,
        orderBy: { id: "asc" },
      });
      break;
    case "conversations":
      assertCoordinator(actor);
      items = await prisma.assistantConversation.findMany({
        where: {
          userId: actor.id,
          ...(input.matterId ? { matterId: input.matterId } : {}),
        },
        ...pagination,
        orderBy: { id: "asc" },
      });
      break;
  }
  const hasMore = items.length > input.limit;
  items = items.slice(0, input.limit);
  const last = items.at(-1) as { id?: string; code?: string } | undefined;
  await audit(
    prisma,
    actor,
    "assistant.records_read",
    "Records",
    input.kind,
    input.matterId || null,
    { count: items.length },
  );
  return {
    kind: input.kind,
    items,
    nextCursor: hasMore ? last?.id || last?.code : null,
    hasMore,
  };
}
