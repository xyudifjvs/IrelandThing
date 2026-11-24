import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma, type Prisma } from "@weatherly/db";
import { HttpError, type Principal } from "@weatherly/platform";
import { requireMatter } from "@weatherly/matters";
import { placeholderBody, placeholderSubject } from "./placeholder-templates";
import { canonicalFieldKey, fieldCatalog } from "./field-catalog";
export const email = z.email().transform((v) => v.trim().toLowerCase());
export const recipientArray = z.array(email).max(40);
export const draftInput = z
  .object({
    matterId: z.string(),
    to: recipientArray.default([]),
    cc: recipientArray.default([]),
    enteredRecipients: z.array(email).max(80).optional(),
    subject: z
      .string()
      .trim()
      .max(998)
      .refine((v) => !/[\r\n]/.test(v), "Subject cannot contain line breaks"),
    body: z.string().max(1000000),
    bodyFormat: z.enum(["plain", "html"]).default("plain"),
    saveForLater: z.boolean().optional(),
    remindOn: z.iso.date().nullable().optional(),
    fieldPreviewFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    templatePreviewFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    attachmentIds: z.array(z.string()).max(20).default([]),
    templateId: z.string().optional(),
    templateRevision: z.number().int().positive().optional(),
    replyToMessageId: z.string().optional(),
    templateValues: z.record(z.string(), z.string().max(2000)).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.saveForLater) return;
    for (const key of ["subject", "body"] as const)
      if (!value[key].trim())
        context.addIssue({
          code: "custom",
          path: [key],
          message: "Add a subject and message before sending.",
        });
    if (!value.to.length)
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "Choose a To recipient.",
      });
  });
export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function textArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((x): x is string => typeof x === "string")
    : [];
}
const isClientRole = (role: unknown) =>
  ["client", "buyer", "seller", "buyer_client", "seller_client"].includes(
    String(role)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_"),
  );

export async function recipientPolicy(
  actor: Principal,
  matterId: string,
  to: string[],
  cc: string[],
  db: Prisma.TransactionClient | typeof prisma = prisma,
  formerRecipients: { entered?: string[]; saved?: unknown } = {},
) {
  const matter = await requireMatter(actor, matterId, false, db);
  const details = asRecord(matter.details);
  const canonical = matter.checklistVersion !== null;
  const storedContacts = await db.matterContact.findMany({
    where: { matterId },
    select: { id: true, name: true, role: true, email: true, retiredAt: true },
  });
  const legacyContacts =
    !canonical && Array.isArray(details.contacts) ? details.contacts : [];
  const clients =
    !canonical && Array.isArray(details.clients) ? details.clients : [];
  const agent = matter.agentId
    ? await db.user.findUnique({
        where: { id: matter.agentId },
        select: { id: true, email: true, name: true },
      })
    : null;
  const normalize = (a: unknown) => {
    const p = email.safeParse(a);
    return p.success ? p.data : null;
  };
  const clientEmails = new Set<string>();
  const retired = new Map<string, string[]>();
  const associations = new Map<string, string[]>();
  const addAssociation = (
    address: string,
    source: string,
    item: Record<string, unknown>,
  ) => {
    const identity = JSON.stringify([
      source,
      item.id ?? null,
      item.name ?? null,
      item.role ?? null,
    ]);
    associations.set(address, [...(associations.get(address) ?? []), identity]);
    if (source === "client" || isClientRole(item.role))
      clientEmails.add(address);
  };
  if (agent) addAssociation(agent.email.toLowerCase(), "agent", agent);
  for (const contact of storedContacts) {
    const address = normalize(contact.email);
    if (!address) continue;
    if (contact.retiredAt) {
      const retirement = JSON.stringify([
        contact.id,
        contact.retiredAt,
        contact.role,
      ]);
      retired.set(address, [...(retired.get(address) ?? []), retirement]);
      if (isClientRole(contact.role)) clientEmails.add(address);
    } else {
      addAssociation(address, "file", contact);
    }
  }
  for (const contact of [...clients, ...legacyContacts]) {
    const item = asRecord(contact);
    const address = normalize(item.email);
    if (!address) continue;
    const isClient = clients.includes(contact);
    if (isClient || isClientRole(item.role)) clientEmails.add(address);
    if (!retired.has(address))
      addAssociation(address, isClient ? "client" : "legacy", item);
  }
  const normalizedTo = [...new Set(to.map((v) => email.parse(v)))];
  const normalizedCc = [...new Set(cc.map((v) => email.parse(v)))].filter(
    (v) => !normalizedTo.includes(v),
  );
  const savedFormerEvidence = asRecord(formerRecipients.saved);
  const formerRecipientEvidence: Record<string, string> = {};
  for (const address of [...normalizedTo, ...normalizedCc]) {
    if (address === "ireland@ireland.com")
      throw new HttpError(
        422,
        "PLACEHOLDER_EMAIL",
        "The preview address cannot receive external messages",
      );
    if (details.directContact !== "copy_agent" && clientEmails.has(address))
      throw new HttpError(
        403,
        "CLIENT_CONTACT_RESTRICTED",
        "This matter permits client contact only through the agent",
      );
    const retirements = retired.get(address);
    if (retirements && !associations.has(address)) {
      const evidence = createHash("sha256")
        .update(JSON.stringify(retirements.sort()))
        .digest("hex");
      if (
        !canonical ||
        clientEmails.has(address) ||
        (savedFormerEvidence[address] !== evidence &&
          !formerRecipients.entered?.includes(address))
      )
        throw new HttpError(
          409,
          "RECIPIENT_RETIRED",
          "A file recipient was removed or replaced. Review the recipients and remove the old address.",
        );
      formerRecipientEvidence[address] = evidence;
    }
    if (!canonical && !associations.has(address))
      throw new HttpError(
        422,
        "UNAPPROVED_RECIPIENT",
        "Save the recipient as a matter contact before sending",
      );
  }
  if (
    details.directContact === "copy_agent" &&
    [...normalizedTo, ...normalizedCc].some((v) => clientEmails.has(v))
  ) {
    if (!agent)
      throw new HttpError(
        422,
        "AGENT_REQUIRED",
        "Assign an agent before contacting the client",
      );
    if (
      !normalizedTo.includes(agent.email.toLowerCase()) &&
      !normalizedCc.includes(agent.email.toLowerCase())
    )
      normalizedCc.push(agent.email.toLowerCase());
  }
  return {
    matter,
    to: normalizedTo,
    cc: normalizedCc,
    formerRecipientEvidence,
    recipientEvidence: createHash("sha256")
      .update(
        JSON.stringify(
          [...normalizedTo, ...normalizedCc].map((address) => [
            address,
            formerRecipientEvidence[address]
              ? ["entered-former", formerRecipientEvidence[address]]
              : (associations.get(address) ?? []).sort(),
          ]),
        ),
      )
      .digest("hex"),
    knownRecipients: [...normalizedTo, ...normalizedCc].filter((address) =>
      associations.has(address),
    ),
    directoryRecipients: canonical
      ? [...normalizedTo, ...normalizedCc].filter(
          (address) => !associations.has(address),
        )
      : [],
  };
}

export function requireSameRecipients(
  recipients: Awaited<ReturnType<typeof recipientPolicy>>,
  previous: { to: unknown; cc: unknown; recipientEvidence?: unknown },
) {
  if (
    JSON.stringify(recipients.to) !== JSON.stringify(previous.to) ||
    JSON.stringify(recipients.cc) !== JSON.stringify(previous.cc) ||
    recipients.recipientEvidence !== previous.recipientEvidence
  )
    throw new HttpError(
      409,
      "RECIPIENT_POLICY_CHANGED",
      "Contact details changed. Review and save the current recipients before sending.",
    );
}
export const templateKeys = new Set([
  "propertyAddress",
  "agentName",
  "agentEmail",
  "clientNames",
  "closingDate",
  "acceptanceDate",
  "closingAppointmentAt",
  "closingAppointmentPlace",
  "packageName",
  "recipientName",
  "coordinatorName",
  "possessionDate",
  "inspectionDate",
  "earnestMoneyDate",
  "hoaDate",
  "titleDate",
  "appraisalDate",
  "loanCommitmentDate",
  "client_name",
  "clientName",
  "client_names",
  "property_address",
  "purchase_price",
  "purchasePrice",
  "titleName",
  "titleCompany",
  "titleEmail",
  "titlePhone",
  "lenderName",
  "lenderCompany",
  "lenderEmail",
  "lenderPhone",
  "coOpAgentName",
  "coOpAgentCompany",
  "coOpAgentEmail",
  "coOpAgentPhone",
  "title_contact",
  "title_company",
  "title_email",
  "title_phone",
  "loan_officer",
  "lender_company",
  "lender_email",
  "lender_phone",
  "co_op_agent",
  "co_op_brokerage",
  "co_op_email",
  "co_op_phone",
]);
export function validateMerge(
  template: string,
  customKeys: ReadonlySet<string> = new Set(),
) {
  const matches = [...template.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)];
  for (const m of matches)
    if (
      !templateKeys.has(m[1]) &&
      !fieldCatalog.some((field) => field.key === canonicalFieldKey(m[1])) &&
      ![...templateKeys].some(
        (key) => canonicalFieldKey(key) === canonicalFieldKey(m[1]),
      ) &&
      !customKeys.has(canonicalFieldKey(m[1])) &&
      !/^(date|deadline|task)_[a-z0-9_]{1,80}$/.test(m[1]) &&
      !/^[a-z][a-z0-9_]{0,79}_date$/.test(m[1])
    )
      throw new HttpError(
        422,
        "UNKNOWN_MERGE_FIELD",
        `Unsupported merge field: ${m[1]}`,
      );
  if (template.replace(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g, "").includes("{{"))
    throw new HttpError(
      422,
      "INVALID_MERGE_FIELD",
      "Malformed template merge field",
    );
}
export function mergeText(template: string, values: Record<string, string>) {
  validateMerge(template);
  return template.replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (_all, key: string) => {
      if (!values[key]?.trim())
        throw new HttpError(
          422,
          "MISSING_MERGE_FIELD",
          `Provide ${key} before using this template`,
        );
      return values[key];
    },
  );
}
export function requireResolved(subject: string, body: string) {
  if (
    [placeholderSubject, placeholderBody].some(
      (marker) => subject.includes(marker) || body.includes(marker),
    )
  )
    throw new HttpError(
      422,
      "TEMPLATE_PLACEHOLDER",
      "Add the template's approved content before sending.",
    );
  if (/\{\{|\}\}/.test(subject + body))
    throw new HttpError(
      422,
      "UNRESOLVED_TEMPLATE",
      "Resolve every merge field before sending",
    );
}

export function assertNoSourceConflicts(details: unknown) {
  const conflicts = asRecord(details).sourceConflicts;
  if (Array.isArray(conflicts) && conflicts.length)
    throw new HttpError(
      409,
      "SOURCE_CONFLICT_REVIEW_REQUIRED",
      "Ireland must choose or correct conflicting source values before preparing or sending correspondence.",
    );
}

export function assertReviewedMatter(matter: {
  stage: string;
  details: unknown;
  checklistVersion?: number | null;
}) {
  if (
    matter.stage === "pending_review" ||
    (matter.checklistVersion == null &&
      asRecord(asRecord(matter.details).fileReview).status === "pending")
  )
    throw new HttpError(
      409,
      "FILE_REVIEW_REQUIRED",
      "Confirm and create this file after reviewing its sources before preparing or sending transaction correspondence.",
    );
  if (matter.checklistVersion == null) assertNoSourceConflicts(matter.details);
}
