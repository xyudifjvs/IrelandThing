import { prisma, type Prisma } from "@weatherly/db";
import { HttpError, type Principal } from "@weatherly/platform";
import { requireMatter, audit } from "@weatherly/matters";

export async function assignDocumentToMatter(
  actor: Principal,
  documentId: string,
  matterId: string,
  transaction?: Prisma.TransactionClient,
) {
  if (actor.role !== "coordinator")
    throw new HttpError(
      403,
      "FORBIDDEN",
      "Only the coordinator can associate imported evidence",
    );
  const apply = async (tx: Prisma.TransactionClient) => {
    await requireMatter(actor, matterId, true, tx);
    const doc = await tx.document.findUnique({ where: { id: documentId } });
    if (!doc)
      throw new HttpError(404, "DOCUMENT_NOT_FOUND", "Document not found");
    if (doc.category === "service_agreement")
      throw new HttpError(
        409,
        "AGREEMENT_PRIVATE",
        "Service agreements stay in the agent roster.",
      );
    if (doc.creationReviewId)
      throw new HttpError(
        409,
        "REVIEW_DOCUMENT_PRIVATE",
        "Attach this document through its creation review.",
      );
    if (doc.matterId && doc.matterId !== matterId)
      throw new HttpError(
        409,
        "DOCUMENT_ALREADY_ASSIGNED",
        "Evidence is associated with another matter",
      );
    if (!doc.matterId) {
      const changed = await tx.document.updateMany({
        where: { id: documentId, matterId: null, revision: doc.revision },
        data: { matterId, revision: { increment: 1 } },
      });
      if (!changed.count)
        throw new HttpError(
          409,
          "REVISION_CONFLICT",
          "Evidence changed while associating",
        );
      await audit(
        tx,
        actor,
        "document.associated",
        "Document",
        documentId,
        matterId,
      );
    }
    return tx.document.findUniqueOrThrow({ where: { id: documentId } });
  };
  return transaction ? apply(transaction) : prisma.$transaction(apply);
}
