import { z } from "zod";
import { prisma, type Prisma } from "@weatherly/db";
import {
  assertCoordinator,
  HttpError,
  type Principal,
} from "@weatherly/platform";
import { audit, requireMatter, fileReviewPending } from "@weatherly/matters";
import { matterChanged } from "../../matters/src/change-hook";
import { checklistTemplate } from "../../matters/src/checklist/templates";
import {
  canonicalFieldKey,
  fieldAliases,
  fieldCatalog,
  historicalFields,
  fieldKeyPattern,
  reservedFieldKeys,
  type FieldDefinition,
} from "./field-catalog";
import { asRecord } from "./policy";

export type FieldDb = Prisma.TransactionClient | typeof prisma;
const key = z
  .string()
  .regex(fieldKeyPattern)
  .refine(
    (value) =>
      !reservedFieldKeys.has(value) && canonicalFieldKey(value) === value,
    "Choose a new field key, not an older alias.",
  );
const answerKey = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]{0,79}$/)
  .refine((value) => !reservedFieldKeys.has(value));
export const fieldSourceInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("details"), key }).strict(),
  z
    .object({
      kind: z.literal("checklist"),
      stepKey: z
        .string()
        .regex(/^(?:[a-z][a-z0-9_]{0,199}|title:[a-z0-9_]{1,180})$/),
      property: z.enum([
        "date",
        "wording",
        "status",
        "amount",
        "holder",
        "company",
        "schedule",
      ]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("person"),
      role: z.string().trim().min(1).max(80),
      property: z.enum([
        "name",
        "first_name",
        "email",
        "phone",
        "company",
        "contact_info",
      ]),
    })
    .strict(),
  z.object({ kind: z.literal("intake"), key: answerKey }).strict(),
  z
    .object({
      kind: z.literal("agent"),
      property: z.enum([
        "name",
        "first_name",
        "email",
        "phone",
        "brokerage",
        "contact_info",
      ]),
    })
    .strict(),
]);
const definitionInput = z
  .object({
    key,
    label: z.string().trim().min(1).max(200),
    side: z.enum(["both", "buyer", "seller"]).default("both"),
    source: fieldSourceInput,
  })
  .strict();

export async function listFieldDefinitions(
  actor: Principal,
  db: FieldDb = prisma,
): Promise<FieldDefinition[]> {
  assertCoordinator(actor);
  const saved = await db.mergeFieldDefinition.findMany({
    orderBy: [{ label: "asc" }, { key: "asc" }],
  });
  return [
    ...[...fieldCatalog, ...historicalFields].filter(
      (field) => !saved.some((row) => row.key === field.key),
    ),
    ...saved.map((row) => ({
      key: row.key,
      label: row.label,
      comesFrom:
        row.source && asRecord(row.source).kind === "details"
          ? "Details (you type it)"
          : "Saved source binding",
      side: row.side as FieldDefinition["side"],
      source: fieldSourceInput.parse(row.source),
    })),
  ];
}

export async function saveFieldDefinition(actor: Principal, raw: unknown) {
  assertCoordinator(actor);
  const input = definitionInput.parse(raw);
  if (input.source.kind === "details" && input.source.key !== input.key)
    throw new HttpError(
      422,
      "DETAIL_KEY_MISMATCH",
      "A Details field uses its own code as its saved key.",
    );
  return prisma.$transaction(async (tx) => {
    // Serialize registration across the built-in and fixed-text namespaces.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('weatherly-merge-field-registration'))::text`;
    const existing = await listFieldDefinitions(actor, tx);
    if (
      existing.some(
        (field) =>
          field.key === input.key && field.source.kind !== "unsupported",
      ) ||
      (await tx.customMergeField.findUnique({ where: { key: input.key } }))
    )
      throw new HttpError(
        409,
        "MERGE_FIELD_EXISTS",
        "That code already exists. Choose a different key.",
      );
    const duplicate = existing.find(
      (field) =>
        JSON.stringify(field.source) === JSON.stringify(input.source) &&
        (field.side === input.side ||
          field.side === "both" ||
          input.side === "both"),
    );
    if (duplicate)
      throw new HttpError(
        409,
        "MERGE_SOURCE_EXISTS",
        `That source already has a field: {{${duplicate.key}}}.`,
      );
    const row = await tx.mergeFieldDefinition.create({
      data: { ...input, source: input.source },
    });
    await audit(
      tx,
      actor,
      "email.merge_source_created",
      "MergeFieldDefinition",
      row.key,
      null,
      { kind: input.source.kind },
    );
    return row;
  });
}

export async function mergeFieldConfiguration(actor: Principal) {
  assertCoordinator(actor);
  const [definitions, settings, companies, customSteps] = await Promise.all([
    listFieldDefinitions(actor),
    prisma.mergeFieldSettings.findUnique({ where: { ownerId: actor.id } }),
    prisma.companyMergeProfile.findMany({
      orderBy: [{ kind: "asc" }, { name: "asc" }],
    }),
    prisma.task.findMany({
      where: { stepKey: { startsWith: "custom_" } },
      select: { title: true },
      distinct: ["title"],
      orderBy: { title: "asc" },
      take: 200,
    }),
  ]);
  return {
    definitions,
    settings: settings ?? {
      name: actor.name,
      signature: "",
      reviewLink: "",
      revision: null,
    },
    companies,
    checklistSteps: [
      ...new Map([
        ...["buyer", "seller"]
          .flatMap((side) =>
            checklistTemplate(side as "buyer" | "seller", null),
          )
          .map(
            (step) => [step.key, { key: step.key, label: step.title }] as const,
          ),
        ["remedies", { key: "remedies", label: "Remedies request" }],
        ...customSteps.flatMap(({ title }) => {
          const normalized = title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_|_$/g, "")
            .slice(0, 180);
          const key = `title:${normalized}`;
          return normalized
            ? [[key, { key, label: `Custom step: ${title}` }] as const]
            : [];
        }),
      ]).values(),
    ],
    intakeAnswers: [
      "fee",
      "listcomm",
      "mls",
      "mls_sell",
      "mls_cosell",
      "utilNotes",
      "hoa",
      "hoaDate",
      "cash",
      "notes",
    ],
  };
}

export async function saveMergeSettings(actor: Principal, raw: unknown) {
  assertCoordinator(actor);
  const input = z
    .object({
      name: z.string().trim().min(1).max(150),
      signature: z.string().max(8000),
      reviewLink: z.union([
        z.literal(""),
        z.url().refine((value) => /^https?:\/\//.test(value)),
      ]),
      expectedRevision: z.number().int().positive().nullable(),
    })
    .strict()
    .parse(raw);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`merge-settings:${actor.id}`}))::text`;
    const old = await tx.mergeFieldSettings.findUnique({
      where: { ownerId: actor.id },
    });
    if ((old?.revision ?? null) !== input.expectedRevision)
      throw new HttpError(
        409,
        "REVISION_CONFLICT",
        "Settings changed. Refresh and try again.",
      );
    const { expectedRevision: _, ...data } = input;
    const row = old
      ? await tx.mergeFieldSettings.update({
          where: { ownerId: actor.id, revision: old.revision },
          data: { ...data, revision: { increment: 1 } },
        })
      : await tx.mergeFieldSettings.create({
          data: { ownerId: actor.id, ...data },
        });
    await audit(
      tx,
      actor,
      "email.merge_settings_saved",
      "User",
      actor.id,
      null,
      { revision: row.revision },
    );
    return row;
  });
}

export const normalizeCompanyName = (name: string) =>
  name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
export async function saveCompanyMergeProfile(actor: Principal, raw: unknown) {
  assertCoordinator(actor);
  const input = z
    .object({
      kind: z.enum(["title", "brokerage"]),
      name: z.string().trim().min(1).max(250),
      text: z.string().max(8000),
      expectedRevision: z.number().int().positive().nullable(),
    })
    .strict()
    .parse(raw);
  const normalizedName = normalizeCompanyName(input.name);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`merge-company:${input.kind}:${normalizedName}`}))::text`;
    const where = { kind_normalizedName: { kind: input.kind, normalizedName } };
    const old = await tx.companyMergeProfile.findUnique({ where });
    if ((old?.revision ?? null) !== input.expectedRevision)
      throw new HttpError(
        409,
        "REVISION_CONFLICT",
        "These company instructions changed. Refresh and try again.",
      );
    const row = old
      ? await tx.companyMergeProfile.update({
          where,
          data: {
            name: input.name,
            text: input.text,
            revision: { increment: 1 },
          },
        })
      : await tx.companyMergeProfile.create({
          data: {
            kind: input.kind,
            normalizedName,
            name: input.name,
            text: input.text,
          },
        });
    await audit(
      tx,
      actor,
      "email.company_merge_profile_saved",
      "CompanyMergeProfile",
      `${input.kind}:${normalizedName}`,
      null,
      { revision: row.revision },
    );
    return row;
  });
}

export async function transactionDetailFields(
  actor: Principal,
  matterId: string,
) {
  assertCoordinator(actor);
  const matter = await requireMatter(actor, matterId);
  const definitions = (await listFieldDefinitions(actor)).filter(
    (field) =>
      field.source.kind === "details" &&
      ["both", matter.side].includes(field.side),
  );
  const saved = asRecord(asRecord(matter.details).mergeFieldValues);
  return definitions.map((field) => ({
    key: field.key,
    label: field.label,
    value:
      typeof saved[field.key] === "string" ? (saved[field.key] as string) : "",
  }));
}

export async function saveTransactionDetail(
  actor: Principal,
  matterId: string,
  raw: unknown,
) {
  assertCoordinator(actor);
  const input = z
    .object({
      key,
      value: z.string().max(8000),
      expectedValue: z.string().max(8000),
    })
    .strict()
    .parse(raw);
  return prisma.$transaction(async (tx) => {
    const matter = await requireMatter(actor, matterId, true, tx);
    if (
      fileReviewPending(matter) ||
      !["under_contract", "closing", "listing"].includes(matter.stage)
    )
      throw new HttpError(
        409,
        "TRANSACTION_READ_ONLY",
        "Choose an active, reviewed transaction to edit its details.",
      );
    const definition = (await listFieldDefinitions(actor, tx)).find(
      (field) =>
        field.key === input.key &&
        field.source.kind === "details" &&
        ["both", matter.side].includes(field.side),
    );
    if (!definition)
      throw new HttpError(
        422,
        "DETAIL_FIELD_UNKNOWN",
        "That field is not an editable detail on this transaction.",
      );
    const details = asRecord(matter.details),
      values = asRecord(details.mergeFieldValues);
    const old = typeof values[input.key] === "string" ? values[input.key] : "";
    if (old !== input.expectedValue)
      throw new HttpError(
        409,
        "REVISION_CONFLICT",
        "This detail changed elsewhere. Reload its saved value before replacing it.",
      );
    await tx.matter.update({
      where: { id: matter.id },
      data: {
        details: {
          ...details,
          mergeFieldValues: { ...values, [input.key]: input.value },
        } as Prisma.InputJsonObject,
        revision: { increment: 1 },
      },
    });
    await audit(
      tx,
      actor,
      "matter.email_detail_saved",
      "Matter",
      matter.id,
      matter.id,
      { key: input.key },
    );
    await matterChanged(tx, actor, matter.id);
    return { key: input.key, value: input.value };
  });
}

export function builtInKeyReserved(key: string) {
  return (
    reservedFieldKeys.has(key) ||
    canonicalFieldKey(key) !== key ||
    !!fieldAliases[key] ||
    [...fieldCatalog, ...historicalFields].some(
      (field) => field.key === key && field.source.kind !== "unsupported",
    )
  );
}
