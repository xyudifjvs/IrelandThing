import { z } from "zod";
import { dateOnly } from "@weatherly/matters";

const safeKey = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]{0,79}$/)
  .refine((key) => !["constructor", "prototype", "__proto__"].includes(key));
const documentId = z.string().min(1).max(200);
const documentGroup = z.array(documentId).max(30);

/**
 * The supplied forms use distinct named controls. Keep their original answers,
 * including temporarily hidden answers, alongside the existing intake projection.
 * These are saved facts and requests, never permission to send/invite/pay.
 */
export const referenceIntake = z
  .object({
    version: z.literal(1),
    variant: z.enum([
      "buyer",
      "seller",
      "buyer-compliance",
      "seller-compliance",
    ]),
    fields: z.record(safeKey, z.union([z.string().max(20000), z.boolean()])),
    uploads: z
      .object({
        contractDocs: documentGroup.optional(),
        hoaFiles: documentGroup.optional(),
        utilFiles: documentGroup.optional(),
        policyFiles: documentGroup.optional(),
      })
      .strict(),
    fileNames: z.record(documentId, z.string().max(500)),
  })
  .strict()
  .superRefine((value, context) => {
    const issue = (path: (string | number)[], message: string) =>
      context.addIssue({ code: "custom", path, message });
    if (Object.keys(value.fields).length > 200)
      issue(["fields"], "Save at most 200 intake fields");
    if (JSON.stringify(value.fields).length > 150000)
      issue(["fields"], "Intake answers exceed the saved-field limit");
    for (const [name, answer] of Object.entries(value.fields)) {
      if (typeof answer === "boolean") {
        if (!["docsDotloop", "giftAgree"].includes(name))
          issue(["fields", name], "Save text for this intake answer");
        continue;
      }
      if (!answer) continue;
      if (name.endsWith("_email") && !z.email().safeParse(answer).success)
        issue(["fields", name], "Enter a valid email address");
      if (name === "hoaDate" && !dateOnly.safeParse(answer).success)
        issue(["fields", name], "Enter a real HOA delivery date (YYYY-MM-DD)");
      if (!["notes", "utilNotes"].includes(name) && answer.length > 2000)
        issue(["fields", name], "Use at most 2,000 characters for this answer");
    }
    const expectedSide = value.variant.startsWith("seller")
      ? "seller"
      : "buyer";
    const expectedService = value.variant.endsWith("-compliance")
      ? "ctcc"
      : "ctc";
    if (value.fields.side && value.fields.side !== expectedSide)
      issue(
        ["fields", "side"],
        "Representation must match this intake version",
      );
    if (value.fields.service && value.fields.service !== expectedService)
      issue(["fields", "service"], "Service must match this intake version");
    const ids = new Set(Object.values(value.uploads).flat());
    if (Object.keys(value.fileNames).length > 120)
      issue(["fileNames"], "Save names for at most 120 uploaded documents");
    for (const id of Object.keys(value.fileNames)) {
      if (!ids.has(id))
        issue(["fileNames", id], "File names must refer to an intake upload");
    }
  });

export type ReferenceIntake = z.infer<typeof referenceIntake>;

export function referenceDocumentIds(reference?: ReferenceIntake) {
  return [...new Set(Object.values(reference?.uploads || {}).flat())];
}

export function referenceFollowups(reference: ReferenceIntake) {
  const fields = reference.fields;
  const seller = reference.variant.startsWith("seller");
  const tasks: { title: string; field: string; kind: string }[] = [];
  const add = (title: string, field: string, kind = "intake") =>
    tasks.push({ title, field, kind });
  if (!fields.fee) add("Obtain broker fee instructions", "fee");
  else add("Review broker fee instructions", "fee");
  if (seller) {
    add(
      fields.listcomm
        ? "Review listing commission instructions"
        : "Obtain listing commission instructions",
      "listcomm",
    );
    if (!fields.occ) add("Confirm seller property occupancy", "occ");
    add("Review seller utilities and previous title policy", "utilNotes");
  } else if (fields.emd) {
    add("Review earnest-money commission deduction instructions", "emd");
  }
  if (fields.coop === "contract")
    add("Verify confirmed co-op contact information in the contract", "coop");
  else if (fields.coop === "type")
    add("Review manually supplied co-op contact information", "co_name");
  else add("Obtain co-op contact confirmation or details", "coop");
  if (fields.addl === "yes")
    add("Review additional communication and portal contact requests", "addl");
  if (fields.title === "mls")
    add("Review title company contact confirmation from MLS", "title");
  if (fields.lender === "preapproval")
    add(
      "Review lender contact confirmation from uploaded pre-approval",
      "lender",
    );
  if (fields.lender === "deciding")
    add("Follow up on buyer lender selection", "lender");
  if (fields.hoa === "yes") {
    add("Review HOA document source and delivery instructions", "hoaDocs");
    if (fields.hoaSent === "yes")
      add(
        fields.hoaDate
          ? "Verify reported HOA document delivery date"
          : "Obtain HOA document delivery date",
        "hoaDate",
      );
  } else if (!fields.hoa) add("Confirm HOA applicability", "hoa");
  if (!seller && fields.mls === "yes")
    add("Review MLS closing agent instructions", "mls_sell");
  if (fields.docsDotloop === true || fields.docsDotloop === "on")
    add(
      "Review requested contract documents in Dotloop; verify account access",
      "docsDotloop",
      "compliance",
    );
  return tasks;
}
