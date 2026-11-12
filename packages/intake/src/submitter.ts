import type { Prisma } from "@weatherly/db";
import { z } from "zod";
import { jsonObject } from "./snapshot";

const submitterSchema = z.object({
  name: z.string(),
  email: z.string(),
  brokerage: z.string().nullable(),
  phone: z.string().nullable(),
});

export async function currentSubmitter(
  db: Prisma.TransactionClient,
  userId: string,
) {
  const agent = await db.user.findUnique({
    where: { id: userId },
    select: {
      name: true,
      email: true,
      brokerage: true,
      rosterAgent: { select: { phone: true } },
    },
  });
  return agent
    ? {
        name: agent.name,
        email: agent.email,
        brokerage: agent.brokerage,
        phone: agent.rosterAgent?.phone ?? null,
      }
    : null;
}

export async function projectSubmitter(
  db: Prisma.TransactionClient,
  intake: { snapshot: Prisma.JsonValue; userId: string },
) {
  const submitted = submitterSchema.safeParse(
    jsonObject(intake.snapshot).submitter,
  );
  if (submitted.success)
    return { agent: submitted.data, agentSource: "submitted" as const };
  const agent = await currentSubmitter(db, intake.userId);
  return { agent, agentSource: agent ? ("current_profile" as const) : null };
}
