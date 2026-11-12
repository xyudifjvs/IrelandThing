import { prepareIntakeReview } from "@weatherly/ai";
import { transactionContactSources } from "../../contacts/src/transaction-sources";
import { prisma, type Prisma } from "@weatherly/db";
import {
  assertCoordinator,
  HttpError,
  type Principal,
} from "@weatherly/platform";
import { audit, requireMatter } from "@weatherly/matters";

export async function createTransactionFromIntake(
  actor: Principal,
  id: string,
) {
  assertCoordinator(actor);
  return prisma.$transaction(async (tx) => {
    const receipt = await tx.intakeSubmission.findUnique({ where: { id } });
    if (!receipt)
      throw new HttpError(404, "INTAKE_NOT_FOUND", "Intake not found.");
    await tx.$queryRaw`SELECT id FROM "Matter" WHERE id = ${receipt.matterId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "IntakeSubmission" WHERE id = ${id} FOR UPDATE`;
    const submission = await tx.intakeSubmission.findUnique({ where: { id } });
    if (!submission)
      throw new HttpError(404, "INTAKE_NOT_FOUND", "Intake not found.");
    const matter = await requireMatter(actor, submission.matterId, true, tx);
    if (
      await tx.creationReview.findUnique({
        where: { intakeId: id },
        select: { id: true },
      })
    )
      throw new HttpError(
        409,
        "CREATION_REVIEW_REQUIRED",
        "Continue this intake in its creation review.",
      );
    if (submission.processedAt)
      return { submission, matter, alreadyCreated: true };
    const previous = matter.details as Record<string, Prisma.InputJsonValue>;
    const contacts = Array.isArray(previous.contacts)
      ? [...previous.contacts]
      : [];
    const reference = previous.referenceIntake as
      { fields?: Record<string, unknown> } | undefined;
    const fields = reference?.fields || {};
    for (const role of ["title_rep", "lender", "co_op_agent"]) {
      if (
        reference &&
        ((role === "title_rep" && fields.title !== "have") ||
          (role === "lender" &&
            (fields.lender !== "have" || fields.cash === "yes")) ||
          (role === "co_op_agent" && fields.coop !== "type"))
      )
        continue;
      const source =
        transactionContactSources(previous, role).find(
          (s) => s.source === "Saved intake",
        ) ||
        transactionContactSources(previous, role).find(
          (s) => s.source === "Saved transaction details",
        );
      if (
        source &&
        !contacts.some(
          (c) =>
            c && typeof c === "object" && !Array.isArray(c) && c.role === role,
        )
      )
        contacts.push({
          id: `intake-${role}`,
          role,
          name: source.name,
          company: source.company,
          email: source.email,
          phone: source.phone,
          source: "intake",
        });
    }
    if (fields.addl === "yes") {
      for (const key of Object.keys(fields).filter((key) =>
        /^c\d+_name$/.test(key),
      )) {
        const prefix = key.slice(0, -5);
        const value = (suffix: string) =>
          typeof fields[prefix + suffix] === "string"
            ? String(fields[prefix + suffix])
            : "";
        if (value("_name").trim())
          contacts.push({
            id: `intake-${prefix}`,
            role: "other",
            name: value("_name"),
            email: value("_email"),
            phone: value("_phone"),
            notes: value("_rel"),
            source: "intake",
          });
      }
    }
    const agent = await tx.user.findUnique({
      where: { id: submission.userId },
    });
    if (
      agent &&
      !contacts.some(
        (c) =>
          c &&
          typeof c === "object" &&
          !Array.isArray(c) &&
          c.role === "my_agent",
      )
    )
      contacts.push({
        id: `agent-${agent.id}`,
        role: "my_agent",
        name: agent.name,
        email: agent.email,
        phone: "",
        source: "intake",
      });
    await tx.matter.update({
      where: { id: matter.id },
      data: { details: { ...previous, contacts }, revision: { increment: 1 } },
    });
    const processed = await tx.intakeSubmission.update({
      where: { id },
      data: { processedAt: new Date(), processedById: actor.id },
    });
    await tx.outboxJob.upsert({
      where: { idempotencyKey: `intake-submitted:${id}` },
      create: {
        topic: "intake.submitted",
        idempotencyKey: `intake-submitted:${id}`,
        payload: { matterId: matter.id, submissionId: id },
      },
      update: {},
    });
    await prepareIntakeReview(matter.id, id, tx, actor.id);
    await audit(
      tx,
      actor,
      "intake.transaction_created",
      "IntakeSubmission",
      id,
      matter.id,
      {},
    );
    return {
      submission: processed,
      matter: await tx.matter.findUniqueOrThrow({ where: { id: matter.id } }),
      alreadyCreated: false,
    };
  });
}
