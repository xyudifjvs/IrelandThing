import { z } from "zod";
import { prisma, type Prisma } from "@weatherly/db";
import {
  assertCoordinator,
  HttpError,
  type Principal,
} from "@weatherly/platform";
import { audit } from "@weatherly/matters";

export type CustomMergeField = {
  key: string;
  label: string;
  defaultValue: string;
  revision: number;
};

export const customMergeFieldInput = z
  .object({
    key: z
      .string()
      .regex(
        /^custom_[a-z][a-z0-9_]{0,63}$/,
        "Use custom_ followed by letters, numbers, or underscores.",
      ),
    label: z.string().trim().min(1).max(100),
    defaultValue: z.string().max(2000).default(""),
  })
  .strict();

type Db = Prisma.TransactionClient | typeof prisma;

export async function listCustomMergeFields(actor: Principal, db: Db = prisma) {
  assertCoordinator(actor);
  return db.$queryRaw<CustomMergeField[]>`
    SELECT "key", "label", "defaultValue", "revision"
    FROM "CustomMergeField" ORDER BY "label", "key"
  `;
}

export async function saveCustomMergeField(
  actor: Principal,
  raw: unknown,
  key?: string,
) {
  assertCoordinator(actor);
  const input = key
    ? customMergeFieldInput
        .omit({ key: true })
        .extend({ expectedRevision: z.number().int().positive() })
        .parse(raw)
    : customMergeFieldInput.parse(raw);
  return prisma.$transaction(async (tx) => {
    let rows: CustomMergeField[];
    if (key && "expectedRevision" in input) {
      rows = await tx.$queryRaw<CustomMergeField[]>`
        UPDATE "CustomMergeField" SET "label" = ${input.label}, "defaultValue" = ${input.defaultValue},
          "revision" = "revision" + 1, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "key" = ${key} AND "revision" = ${input.expectedRevision}
        RETURNING "key", "label", "defaultValue", "revision"
      `;
      if (!rows.length)
        throw new HttpError(
          409,
          "REVISION_CONFLICT",
          "This field changed. Refresh and try again.",
        );
    } else {
      const parsed = customMergeFieldInput.parse(raw);
      rows = await tx.$queryRaw<CustomMergeField[]>`
        INSERT INTO "CustomMergeField" ("key", "label", "defaultValue")
        VALUES (${parsed.key}, ${parsed.label}, ${parsed.defaultValue})
        ON CONFLICT ("key") DO NOTHING
        RETURNING "key", "label", "defaultValue", "revision"
      `;
      if (!rows.length)
        throw new HttpError(
          409,
          "MERGE_FIELD_EXISTS",
          "That merge field already exists. Choose another key.",
        );
    }
    await audit(
      tx,
      actor,
      "email.custom_merge_field_saved",
      "CustomMergeField",
      rows[0].key,
      null,
      { revision: rows[0].revision },
    );
    return rows[0];
  });
}

/** Manual values can only fill custom fields and existing greeting fields. */
export function applyCustomMergeValues(
  computed: Record<string, string>,
  definitions: readonly CustomMergeField[],
  values: Record<string, string>,
) {
  for (const field of definitions) {
    computed[field.key] = Object.hasOwn(values, field.key)
      ? values[field.key]
      : field.defaultValue;
  }
}
