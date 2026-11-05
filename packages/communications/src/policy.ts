import { z } from "zod";
import { prisma, type Prisma } from "@weatherly/db";
import { HttpError, type Principal } from "@weatherly/platform";
import { requireMatter } from "@weatherly/matters";
export const email = z.email().transform((v) => v.trim().toLowerCase());
export const recipientArray = z.array(email).max(40);
export const draftInput = z
  .object({
    matterId: z.string(),
    to: recipientArray.min(1),
    cc: recipientArray.default([]),
    subject: z
      .string()
      .trim()
      .min(1)
      .max(998)
      .refine((v) => !/[\r\n]/.test(v), "Subject cannot contain line breaks"),
    body: z.string().min(1).max(100000),
    attachmentIds: z.array(z.string()).max(20).default([]),
    templateId: z.string().optional(),
    templateRevision: z.number().int().positive().optional(),
    replyToMessageId: z.string().optional(),
    templateValues: z.record(z.string(), z.string().max(2000)).optional(),
  })
  .strict();
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
export async function recipientPolicy(
  actor: Principal,
  matterId: string,
  to: string[],
  cc: string[],
  db: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const matter = await requireMatter(actor, matterId, false, db);
  const details = asRecord(matter.details);
  const contacts = Array.isArray(details.contacts) ? details.contacts : [];
  const clients = Array.isArray(details.clients) ? details.clients : [];
  const agent = matter.agentId
    ? await db.user.findUnique({
        where: { id: matter.agentId },
        select: { email: true },
      })
    : null;
  const normalize = (a: unknown) => {
    const p = email.safeParse(a);
    return p.success ? p.data : null;
  };
  const clientEmails = new Set<string>();
  const allowed = new Set<string>(agent ? [agent.email.toLowerCase()] : []);
  for (const contact of [...clients, ...contacts]) {
    const item = asRecord(contact),
      address = normalize(item.email);
    if (address) {
      allowed.add(address);
      if (
        clients.includes(contact) ||
        ["client", "buyer", "seller"].includes(String(item.role))
      )
        clientEmails.add(address);
    }
  }
  const normalizedTo = [...new Set(to.map((v) => email.parse(v)))];
  const normalizedCc = [...new Set(cc.map((v) => email.parse(v)))].filter(
    (v) => !normalizedTo.includes(v),
  );
  for (const address of [...normalizedTo, ...normalizedCc]) {
    if (address === "ireland@ireland.com")
      throw new HttpError(
        422,
        "PLACEHOLDER_EMAIL",
        "The preview address cannot receive external messages",
      );
    if (!allowed.has(address))
      throw new HttpError(
        422,
        "UNAPPROVED_RECIPIENT",
        "Save the recipient as a matter contact before sending",
      );
    if (details.directContact !== "copy_agent" && clientEmails.has(address))
      throw new HttpError(
        403,
        "CLIENT_CONTACT_RESTRICTED",
        "This matter permits client contact only through the agent",
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
  return { matter, to: normalizedTo, cc: normalizedCc };
}
export const templateKeys = new Set([
  "propertyAddress",
  "agentName",
  "agentEmail",
  "clientNames",
  "closingDate",
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
export function validateMerge(template: string) {
  const matches = [...template.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)];
  for (const m of matches)
    if (
      !templateKeys.has(m[1]) &&
      !/^(date|deadline|task)_[a-z0-9_]{1,80}$/.test(m[1])
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
}) {
  if (
    matter.stage === "pending_review" ||
    asRecord(asRecord(matter.details).fileReview).status === "pending"
  )
    throw new HttpError(
      409,
      "FILE_REVIEW_REQUIRED",
      "Confirm and create this file after reviewing its sources before preparing or sending transaction correspondence.",
    );
  assertNoSourceConflicts(matter.details);
}
