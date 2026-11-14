import { z } from "zod";
import type { Principal } from "@weatherly/platform";
import { prisma } from "@weatherly/db";
import { requireMatter, audit } from "../access";
import { updateChild } from "./update-child";

const noteInput = z
  .object({
    body: z.string().trim().min(1).max(30000),
    visibility: z
      .enum(["coordinator", "agent", "client"])
      .default("coordinator"),
  })
  .strict();

export async function addNote(
  actor: Principal,
  matterId: string,
  input: unknown,
) {
  const data = noteInput.parse(input);
  return prisma.$transaction(async (tx) => {
    await requireMatter(actor, matterId, true, tx);
    const row = await tx.note.create({
      data: { ...data, matterId, authorId: actor.id },
    });
    await audit(tx, actor, "note.created", "Note", row.id, matterId);
    return row;
  });
}

export const updateNote = (
  actor: Principal,
  matterId: string,
  id: string,
  input: unknown,
) => updateChild(actor, matterId, id, "note", input);

export const deleteNote = (
  actor: Principal,
  matterId: string,
  id: string,
  input: unknown,
) => updateChild(actor, matterId, id, "note", input, true);
