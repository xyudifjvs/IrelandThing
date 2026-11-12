import { z } from "zod";
import { prisma, type Prisma } from "@weatherly/db";
import { HttpError, type Principal } from "@weatherly/platform";
import { requireMatter } from "@weatherly/matters";
import { documentAudienceWhere } from "../../matters/src/projections/document-audience";
import { originalIntakeDocumentIds } from "./snapshot";
import { projectSubmitter } from "./submitter";

export async function getIntakeSubmission(actor: Principal, id: string) {
  if (actor.role === "client")
    throw new HttpError(
      403,
      "FORBIDDEN",
      "Intakes are available to agents and coordinators.",
    );
  const submission = await prisma.intakeSubmission.findFirst({
    where: {
      id,
      deletedAt: null,
      ...(actor.role === "agent" ? { userId: actor.id } : {}),
    },
  });
  if (!submission)
    throw new HttpError(404, "INTAKE_NOT_FOUND", "Intake not found.");
  await requireMatter(actor, submission.matterId);
  const agentReceiptDocuments: Prisma.DocumentWhereInput = {
    creationReviewId: null,
    AND: [
      {
        OR: [
          {
            intakeSubmissionId: submission.id,
            OR: [{ matterId: null }, { matterId: submission.matterId }],
          },
          {
            intakeSubmissionId: null,
            matterId: submission.matterId,
            id: { in: originalIntakeDocumentIds(submission.snapshot) },
          },
        ],
      },
      documentAudienceWhere("agent"),
    ],
  };
  const documents = await prisma.document.findMany({
    where:
      actor.role === "agent"
        ? agentReceiptDocuments
        : { matterId: submission.matterId },
    select: {
      id: true,
      name: true,
      category: true,
      mimeType: true,
      versions: {
        ...(actor.role === "agent"
          ? { where: { createdAt: { lte: submission.createdAt } } }
          : {}),
        orderBy: { version: "desc" },
        select: {
          id: true,
          version: true,
          processingStatus: true,
          error: true,
        },
      },
    },
  });
  const { agent, agentSource } = await projectSubmitter(prisma, submission);
  return { ...submission, agent: agent ? { id: submission.userId, ...agent } : null, agentSource, documents };
}

export async function listIntakeSubmissions(actor: Principal, raw: unknown = {}) {
  if (actor.role === "client") throw new HttpError(403, "FORBIDDEN", "Intakes are available to agents and coordinators.");
  const input = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(30) }).parse(raw);
  const scope = { deletedAt: null, ...(actor.role === "agent" ? { userId: actor.id } : {}) };
  return prisma.$transaction(async tx => {
    const items = await tx.intakeSubmission.findMany({ where: scope, orderBy: [{ processedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }, { id: "desc" }], skip: (input.page - 1) * input.limit, take: input.limit });
    const total = await tx.intakeSubmission.count({where:scope});
    const newCount = await tx.intakeSubmission.count({where:{...scope,processedAt:null}});
    const agents = await tx.user.findMany({ where: { id: { in: items.map(x => x.userId) } }, select: { id: true, name: true, email: true } });
    return { items: items.map(item => ({ ...item, agent: agents.find(a => a.id === item.userId) || null })), total, newCount, page: input.page };
  });
}
