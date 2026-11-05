-- Ireland's approved catalog applies to future requests only. No matter,
-- submission, payment or gift snapshot is updated by this migration.
INSERT INTO "CatalogItem" ("code", "name", "priceCents", "currency", "approved", "sellerOnly", "revision", "updatedAt")
VALUES
  ('essentials', 'Contract to Close', 42500, 'USD', true, false, 1, CURRENT_TIMESTAMP),
  ('complete', 'Contract to Close + Compliance', 51500, 'USD', true, false, 1, CURRENT_TIMESTAMP),
  ('full_listing', 'Full Listing', 62500, 'USD', false, true, 1, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "priceCents" = EXCLUDED."priceCents",
  "currency" = EXCLUDED."currency",
  "approved" = EXCLUDED."approved",
  "sellerOnly" = EXCLUDED."sellerOnly",
  "revision" = "CatalogItem"."revision" + 1,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "CatalogItem"."name" IS DISTINCT FROM EXCLUDED."name"
   OR "CatalogItem"."priceCents" IS DISTINCT FROM EXCLUDED."priceCents"
   OR "CatalogItem"."currency" IS DISTINCT FROM EXCLUDED."currency"
   OR "CatalogItem"."approved" IS DISTINCT FROM EXCLUDED."approved"
   OR "CatalogItem"."sellerOnly" IS DISTINCT FROM EXCLUDED."sellerOnly";
