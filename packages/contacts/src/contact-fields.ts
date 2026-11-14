import { createHash } from "node:crypto";
import { z } from "zod";

export const contactKinds = [
  "agent",
  "co_op_agent",
  "title_company",
  "title_rep",
  "lender",
  "loan_officer",
  "other",
] as const;
export const contactInput = z
  .object({
    kind: z.enum(contactKinds),
    name: z.string().trim().min(1).max(200),
    company: z.string().trim().max(250).default(""),
    email: z.union([z.email(), z.literal("")]).default(""),
    phone: z.string().trim().max(60).default(""),
    favorite: z.boolean().default(false),
  })
  .strict();
export type ContactInput = z.infer<typeof contactInput>;
const normalize = (value: string) =>
  value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
export function contactIdentityKey(contact: ContactInput) {
  // Exact normalized identity only: equal company or similar names never imply one person.
  return createHash("sha256")
    .update(
      JSON.stringify([
        contact.kind,
        normalize(contact.name),
        normalize(contact.company),
        contact.email.toLowerCase().trim(),
        contact.phone.replace(/[^0-9a-z]/gi, "").toLowerCase(),
      ]),
    )
    .digest("hex");
}
