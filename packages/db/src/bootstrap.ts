import "dotenv/config";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { prisma } from "./index";
import { approvedCatalog } from "../../billing/src/contracts";

// One-time operator command. No demo identities, defaults or outbound messages.
const email = z.email().parse(process.env.BOOTSTRAP_OWNER_EMAIL).toLowerCase();
const password = z
  .string()
  .min(16)
  .max(128)
  .parse(process.env.BOOTSTRAP_OWNER_PASSWORD);
if (email === "ireland@ireland.com" || /@example\.(test|com|org)$/.test(email))
  throw new Error("Use Ireland’s actual approved email address.");
if (process.env.BOOTSTRAP_OWNER_CONFIRMED !== "ireland")
  throw new Error(
    "Confirm that the owner account belongs to Ireland before bootstrapping.",
  );
const hashed = await hashPassword(password);
await prisma.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('weatherly-bootstrap'))`;
  if (await tx.user.count({ where: { role: "coordinator" } }))
    throw new Error(
      "A coordinator already exists. Bootstrap refuses to change existing accounts.",
    );
  const id = randomUUID();
  await tx.user.create({
    data: {
      id,
      name: "Ireland",
      email,
      role: "coordinator",
      emailVerified: true,
    },
  });
  await tx.account.create({
    data: {
      id: randomUUID(),
      userId: id,
      accountId: id,
      providerId: "credential",
      password: hashed,
    },
  });
  for (const item of approvedCatalog)
    await tx.catalogItem.create({ data: { ...item, approved: true } });
  await tx.auditEvent.create({
    data: {
      actorId: id,
      action: "identity.owner_bootstrapped",
      entityType: "User",
      entityId: id,
      details: { source: "operator-command", mfaRequired: true },
    },
  });
});
console.log(
  "Ireland’s owner account and approved service catalog were created. Enroll MFA at first sign-in. Remove the bootstrap password from the environment now.",
);
await prisma.$disconnect();
