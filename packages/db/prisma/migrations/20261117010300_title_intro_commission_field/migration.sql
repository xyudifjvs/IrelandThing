BEGIN;
-- Ireland identified the single 3% value in Title introductions as the buyer-agent
-- commission. Replace that template placeholder only; do not assign a rate to files
-- or alter any saved/sent draft. Original template text remains recoverable.
DO $$
DECLARE item RECORD; changed INTEGER := 0; next_body TEXT;
BEGIN
  FOR item IN SELECT "id", "subject", "body", "revision" FROM "CommunicationTemplate"
    WHERE (
      "name" ~* '(title.*(intro|initial|opening)|(intro|initial|opening).*title)'
      OR ((COALESCE("recipientGroup", '') ILIKE '%title%' OR "recipientRoles"::text ILIKE '%title%')
        AND "name" ~* '(intro|initial|opening)')
    )
    AND "body" !~ '\{\{[[:space:]]*buyer_agent_commission[[:space:]]*\}\}'
    AND regexp_count("body", '(^|[^0-9.])3[[:space:]]*%') = 1
  LOOP
    next_body := regexp_replace(item."body", '(^|[^0-9.])3[[:space:]]*%', '\1{{buyer_agent_commission}}');
    INSERT INTO "MergeFieldTemplateBackup" ("templateId", "subject", "body", "revision")
      VALUES (item."id", item."subject", item."body", item."revision") ON CONFLICT DO NOTHING;
    UPDATE "CommunicationTemplate" SET "body" = next_body, "revision" = "revision" + 1 WHERE "id" = item."id";
    changed := changed + 1;
  END LOOP;
  RAISE NOTICE 'Title introduction commission field: % template(s) updated; drafts and transaction rates retained.', changed;
END $$;
COMMIT;
