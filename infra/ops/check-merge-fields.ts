import { prisma } from "@weatherly/db";
import { fieldCatalog } from "../../packages/communications/src/field-catalog";

// Release verification only. Never print contract text, recipient data or secrets.
try {
  const [definitions, settings, companies, backups, geo, templates] =
    await Promise.all([
      prisma.mergeFieldDefinition.count(),
      prisma.mergeFieldSettings.count(),
      prisma.companyMergeProfile.count(),
      prisma.mergeFieldTemplateBackup.count(),
      prisma.customMergeField.findMany({
        where: { key: { in: ["geo_info", "custom_geo_info"] } },
        select: { key: true },
      }),
      prisma.communicationTemplate.findMany({
        select: {
          name: true,
          body: true,
          active: true,
          recipientGroup: true,
          recipientRoles: true,
        },
      }),
    ]);
  const titleIntroductions = templates.filter(
    (row) =>
      /title.*(intro|initial|opening)|(intro|initial|opening).*title/i.test(
        row.name,
      ) ||
      (/title/i.test(
        `${row.recipientGroup || ""} ${JSON.stringify(row.recipientRoles)}`,
      ) &&
        /intro|initial|opening/i.test(row.name)),
  );
  const work = await prisma.emailWork.findFirst({
    select: { checkedOverride: true },
  });
  console.log(
    JSON.stringify({
      check: "merge-field-release",
      commit: process.env.RAILWAY_GIT_COMMIT_SHA || null,
      builtinFields: fieldCatalog.length,
      registeredFields: definitions,
      senderSettings: settings,
      companyProfiles: companies,
      backedUpTemplates: backups,
      geoInfoPresent: geo.some((field) => field.key === "geo_info"),
      oldGeoInfoPresent: geo.some((field) => field.key === "custom_geo_info"),
      completionOverrideSchemaReady: work !== undefined,
      titleIntroductionTemplates: titleIntroductions.length,
      titleIntroductionCommissionFields: titleIntroductions.filter((row) =>
        /\{\{\s*buyer_agent_commission\s*\}\}/.test(row.body),
      ).length,
      titleIntroductionLiteralRatesRemaining: titleIntroductions.filter((row) =>
        /(^|[^0-9.])3\s*%/.test(row.body),
      ).length,
    }),
  );
} finally {
  await prisma.$disconnect();
}
