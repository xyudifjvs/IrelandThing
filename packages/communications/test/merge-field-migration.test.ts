import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { expect, it } from "vitest";

it("renames template tokens and geo_info without losing originals or touching drafts", async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const schema = `merge_migration_${randomUUID().replaceAll("-", "")}`;
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(
      await readFile(
        "packages/db/prisma/migrations/20261114010000_custom_email_merge_fields/migration.sql",
        "utf8",
      ),
    );
    await client.query(`CREATE TABLE "CommunicationTemplate" ("id" TEXT PRIMARY KEY, "subject" TEXT, "body" TEXT, "revision" INT, "active" BOOLEAN, "name" TEXT DEFAULT 'Existing', "recipientGroup" TEXT, "recipientRoles" JSONB);
      CREATE TABLE "EmailDraft" ("subject" TEXT, "body" TEXT);`);
    await client.query(`INSERT INTO "CustomMergeField" ("key","label","defaultValue") VALUES ('custom_geo_info','Area','Line one\nLine two');
      INSERT INTO "CommunicationTemplate" ("id", "subject", "body", "revision", "active") VALUES ('active','{{propertyAddress}}','{{ task_earnest_money_due }} {{custom_geo_info}} {{deadline_home_warranty}}',4,TRUE), ('inactive','{{closingDate}}','{{date_custom_review}}',2,FALSE);
      INSERT INTO "EmailDraft" VALUES ('Historical subject','Do not replace this text.');`);
    await client.query(
      await readFile(
        "packages/db/prisma/migrations/20261117010000_merge_field_sources_and_codes/migration.sql",
        "utf8",
      ),
    );
    expect(
      (
        await client.query(
          'SELECT "key", "defaultValue" FROM "CustomMergeField"',
        )
      ).rows,
    ).toEqual([{ key: "geo_info", defaultValue: "Line one\nLine two" }]);
    expect(
      (
        await client.query(
          'SELECT * FROM "CommunicationTemplate" WHERE "id" = \'active\'',
        )
      ).rows[0],
    ).toMatchObject({
      subject: "{{property_address}}",
      body: "{{emd_due_date}} {{geo_info}} {{warranty_deadline}}",
      revision: 5,
      active: true,
    });
    expect(
      (
        await client.query(
          'SELECT * FROM "CommunicationTemplate" WHERE "id" = \'inactive\'',
        )
      ).rows[0],
    ).toMatchObject({
      body: "{{custom_review_date}}",
      revision: 3,
      active: false,
    });
    expect(
      (
        await client.query(
          'SELECT count(*)::int AS count FROM "MergeFieldTemplateBackup"',
        )
      ).rows[0].count,
    ).toBe(2);
    expect(
      (
        await client.query(
          'SELECT "body" FROM "MergeFieldTemplateBackup" WHERE "templateId" = \'active\'',
        )
      ).rows[0].body,
    ).toContain("{{custom_geo_info}}");
    expect((await client.query('SELECT * FROM "EmailDraft"')).rows).toEqual([
      { subject: "Historical subject", body: "Do not replace this text." },
    ]);
    await client.query(`INSERT INTO "CommunicationTemplate" ("id", "subject", "body", "revision", "active", "name") VALUES
      ('title', 'Introduction', 'Buyer-agent commission is 3%.', 1, TRUE, 'Title Intro'),
      ('other', 'Other', 'Loan rate is 3%.', 1, TRUE, 'Lender Intro'),
      ('ambiguous', 'Intro', 'Commission 3% and another rate 3%.', 1, TRUE, 'Title Intro');`);
    await client.query(
      await readFile(
        "packages/db/prisma/migrations/20261117010300_title_intro_commission_field/migration.sql",
        "utf8",
      ),
    );
    expect(
      (
        await client.query(
          'SELECT "body" FROM "CommunicationTemplate" WHERE "id" = $1',
          ["title"],
        )
      ).rows[0].body,
    ).toBe("Buyer-agent commission is {{buyer_agent_commission}}.");
    expect(
      (
        await client.query(
          'SELECT "body" FROM "MergeFieldTemplateBackup" WHERE "templateId" = $1',
          ["title"],
        )
      ).rows[0].body,
    ).toBe("Buyer-agent commission is 3%.");
    expect(
      (
        await client.query(
          'SELECT "body" FROM "CommunicationTemplate" WHERE "id" = $1',
          ["other"],
        )
      ).rows[0].body,
    ).toBe("Loan rate is 3%.");
    expect(
      (
        await client.query(
          'SELECT "body" FROM "CommunicationTemplate" WHERE "id" = $1',
          ["ambiguous"],
        )
      ).rows[0].body,
    ).toBe("Commission 3% and another rate 3%.");
  } finally {
    await client.query("ROLLBACK");
    await client.query("SET search_path TO public");
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
});
