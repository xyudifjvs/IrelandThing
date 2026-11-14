import type { Prisma } from "@weatherly/db";
import { contactIdentityKey } from "../../contacts/src/contact-fields";
import { email, textArray } from "./policy";

export async function recordSentDirectoryContacts(
  tx: Prisma.TransactionClient,
  ownerId: string,
  snapshot: Record<string, unknown>,
  sentAt: Date,
) {
  const recipients = new Set([
    ...textArray(snapshot.to),
    ...textArray(snapshot.cc),
  ]);
  const update = { usageCount: { increment: 1 }, lastUsedAt: sentAt };
  for (const value of new Set(textArray(snapshot.directoryRecipients))) {
    const parsed = email.safeParse(value);
    if (!parsed.success || !recipients.has(parsed.data)) continue;
    const address = parsed.data;
    const existing = await tx.businessContact.findFirst({
      where: { ownerId, email: { equals: address, mode: "insensitive" } },
      select: { id: true },
      orderBy: [{ lastUsedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
    });
    if (existing) {
      await tx.businessContact.updateMany({
        where: { id: existing.id, ownerId },
        data: update,
      });
      continue;
    }
    const contact = {
      kind: "other",
      email: address,
      name: address.slice(0, 200),
      company: "",
      phone: "",
      favorite: false,
    } as const;
    const identityKey = contactIdentityKey(contact);
    await tx.businessContact.upsert({
      where: { ownerId_identityKey: { ownerId, identityKey } },
      create: {
        ...contact,
        ownerId,
        identityKey,
        usageCount: 1,
        lastUsedAt: sentAt,
      },
      update,
    });
  }
}
