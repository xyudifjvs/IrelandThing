-- Scheduling belongs to the buyer's Appraisal Ordered milestone. This corrects
-- existing checklists without moving dates, statuses, notes, or appointment data.
-- Seller and original unversioned checklists are intentionally unchanged.
BEGIN;
CREATE TEMP TABLE appraisal_schedule_files ON COMMIT DROP AS
SELECT m."id"
FROM "Matter" m
WHERE m."checklistVersion" = 1 AND m."side" = 'buyer'
  AND EXISTS (SELECT 1 FROM "Task" t WHERE t."matterId" = m."id" AND t."stepKey" = 'appraisal_ordered')
  AND EXISTS (SELECT 1 FROM "Task" t WHERE t."matterId" = m."id" AND t."stepKey" = 'appraisal')
  AND EXISTS (
    SELECT 1 FROM "Task" t WHERE t."matterId" = m."id"
      AND ((t."stepKey" = 'appraisal_ordered' AND t."details"->'scheduled' IS DISTINCT FROM 'true'::jsonb)
        OR (t."stepKey" = 'appraisal' AND t."details"->'scheduled' IS DISTINCT FROM 'false'::jsonb))
  );

UPDATE "Task" t
SET "details" = jsonb_set(
      CASE WHEN jsonb_typeof(t."details") = 'object' THEN t."details" ELSE '{}'::jsonb END,
      '{scheduled}', CASE WHEN t."stepKey" = 'appraisal_ordered' THEN 'true'::jsonb ELSE 'false'::jsonb END),
    "revision" = t."revision" + 1, "updatedAt" = CURRENT_TIMESTAMP
WHERE t."matterId" IN (SELECT "id" FROM appraisal_schedule_files)
  AND ((t."stepKey" = 'appraisal_ordered' AND t."details"->'scheduled' IS DISTINCT FROM 'true'::jsonb)
    OR (t."stepKey" = 'appraisal' AND t."details"->'scheduled' IS DISTINCT FROM 'false'::jsonb));

UPDATE "Matter" SET "revision" = "revision" + 1, "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" IN (SELECT "id" FROM appraisal_schedule_files);
COMMIT;
