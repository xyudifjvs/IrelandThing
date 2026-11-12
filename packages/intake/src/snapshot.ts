import type { Prisma } from "@weatherly/db";

export function jsonObject(value: Prisma.JsonValue | undefined) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function documentIds(value: Prisma.JsonValue | undefined) {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string")
    : [];
}

export function intakeContractIds(snapshot: Prisma.JsonValue) {
  const data = jsonObject(snapshot);
  const reference = jsonObject(data.referenceIntake);
  const ids = data.referenceIntake
    ? jsonObject(reference.uploads).contractDocs
    : data.documentIds;
  return new Set(documentIds(ids));
}

export function originalIntakeDocumentIds(snapshot: Prisma.JsonValue) {
  const data = jsonObject(snapshot);
  const uploads = jsonObject(jsonObject(data.referenceIntake).uploads);
  const broker = jsonObject(data.broker);
  return [
    ...new Set(
      [
        data.documentIds,
        ...Object.values(uploads),
        broker.checklistDocumentIds,
        typeof broker.checklistDocumentId === "string"
          ? [broker.checklistDocumentId]
          : [],
      ].flatMap(documentIds),
    ),
  ];
}
