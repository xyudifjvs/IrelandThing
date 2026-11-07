import { prisma, Prisma } from "@weatherly/db";
import { HttpError } from "@weatherly/platform";
import { aiConfigured } from "./gateway";
/** Durable source preparation only. The outbox worker owns approved inference;
 * this helper never calls a model, fetches Dotloop, or invents extracted values. */
export async function prepareIntakeReview(
  matterId: string,
  submissionId: string,
  transaction?: Prisma.TransactionClient,
  requestedById?: string,
) {
  const prepare = async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT "id" FROM "Matter" WHERE "id" = ${matterId} FOR UPDATE`;
    const matter = await tx.matter.findUniqueOrThrow({
      where: { id: matterId },
    });
    const submission = await tx.intakeSubmission.findFirst({
      where: { id: submissionId, matterId },
    });
    if (!submission)
      throw new HttpError(
        404,
        "SUBMISSION_NOT_FOUND",
        "Source preparation requires the saved intake receipt.",
      );
    const details = matter.details as Record<string, Prisma.JsonValue>;
    const reference = details.referenceIntake as
      | {
          fields?: Record<string, unknown>;
          uploads?: { contractDocs?: string[] };
        }
      | undefined;
    const ids = reference
      ? [...(reference.uploads?.contractDocs || [])]
      : Array.isArray(details.documentIds)
        ? details.documentIds.filter(
            (id): id is string => typeof id === "string",
          )
        : [];
    const documents = await tx.document.findMany({
      where: { matterId, id: { in: ids } },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });
    const candidates = await tx.user.findMany({
      where: {
        role: "coordinator",
        ...((requestedById || process.env.AI_REVIEW_OWNER_ID)
          ? { id: requestedById || process.env.AI_REVIEW_OWNER_ID }
          : {}),
      },
    });
    const approved = [];
    for (const owner of candidates) {
      const access = await tx.auditEvent.findFirst({
        where: {
          entityType: "User",
          entityId: owner.id,
          action: {
            in: ["identity.access_revoked", "identity.access_restored"],
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      if (access?.action !== "identity.access_revoked") approved.push(owner);
    }
    const owner = approved.length === 1 ? approved[0] : null;
    const sources = documents.length
      ? documents.map((document) => ({
          key: document.id + ":" + (document.versions[0]?.id || "missing"),
          document,
          version: document.versions[0],
        }))
      : [
          {
            key: "contract_not_available",
            document: undefined,
            version: undefined,
          },
        ];
    const result = [];
    for (const source of sources) {
      const existing = await tx.aIProposal.findFirst({
        where: {
          matterId,
          kind: "contract",
          AND: [
            { result: { path: ["intakeSubmissionId"], equals: submissionId } },
            { result: { path: ["intakeSourceKey"], equals: source.key } },
          ],
        },
      });
      if (existing) {
        result.push({ id: existing.id, status: existing.status });
        continue;
      }
      const dotloop =
        reference?.fields?.docsDotloop === true ||
        details.contractSource === "dotloop";
      const readable = !!source.version?.extractedText?.trim();
      const reason = !source.document
        ? dotloop
          ? "CONTRACT_RETRIEVAL_REQUIRED"
          : "CONTRACT_NOT_UPLOADED"
        : !readable
          ? "READABLE_SOURCE_REQUIRED"
          : !owner
            ? "REVIEW_OWNER_UNAVAILABLE"
            : !aiConfigured()
              ? "APPROVED_AI_ROUTE_UNAVAILABLE"
              : null;
      const queued = !reason;
      const sourceRefs =
        source.document && source.version
          ? [
              {
                documentId: source.document.id,
                versionId: source.version.id,
                checksum: source.version.checksum,
              },
            ]
          : [];
      const proposal = await tx.aIProposal.create({
        data: {
          matterId,
          kind: "contract",
          status: queued ? "queued" : "unavailable",
          requestedById: owner?.id || submission.userId,
          sourceRevision: matter.revision,
          sourceRefs,
          result: {
            intakeSubmissionId: submissionId,
            intakeSourceKey: source.key,
            summary: queued
              ? "Source saved; approved extraction is queued for Ireland’s review."
              : !source.document
                ? dotloop
                  ? "Retrieve the contract from Dotloop or upload it for Ireland’s manual review. No file has been fetched."
                  : "No contract was uploaded. Ireland must obtain and review the source."
                : !readable
                  ? "The stored source has no readable text. Ireland must review or transcribe it through the approved route."
                  : "Source saved. Automated extraction is unavailable; Ireland can review the document manually.",
            availability: reason,
            requiresManualReview: !queued,
          },
        },
      });
      if (queued)
        await tx.outboxJob.upsert({
          where: { idempotencyKey: "extract:" + proposal.id },
          create: {
            topic: "ai.extract",
            idempotencyKey: "extract:" + proposal.id,
            payload: { proposalId: proposal.id },
          },
          update: {},
        });
      else {
        const intakeReviewKey = submissionId + ":" + source.key;
        const task = await tx.task.findFirst({
          where: {
            matterId,
            kind: "manual_review",
            details: { path: ["intakeReviewKey"], equals: intakeReviewKey },
          },
        });
        if (!task)
          await tx.task.create({
            data: {
              matterId,
              kind: "manual_review",
              visibility: "coordinator",
              title:
                !source.document && dotloop
                  ? "Retrieve contract from Dotloop for Ireland’s review"
                  : !source.document
                    ? "Obtain contract for Ireland’s review"
                    : !readable
                      ? "Review unreadable contract source manually"
                      : "Review contract source manually; approved extraction unavailable",
              details: {
                intakeReviewKey,
                intakeSubmissionId: submissionId,
                proposalId: proposal.id,
                reason,
                ...(source.document ? { documentId: source.document.id } : {}),
              },
            },
          });
      }
      result.push({ id: proposal.id, status: proposal.status });
    }
    return { matterId, submissionId, proposals: result };
  };
  return transaction ? prepare(transaction) : prisma.$transaction(prepare);
}
