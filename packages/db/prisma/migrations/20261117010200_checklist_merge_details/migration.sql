-- Make the workbook's appraisal and warranty date/schedule fields editable.
-- Existing dates, text, completion state, and contract rules are retained.
UPDATE "Task" SET "dateCapable" = TRUE, "revision" = "revision" + 1
WHERE "stepKey" IN ('appraisal_ordered', 'appraisal', 'home_warranty_ordered')
  AND "dateCapable" = FALSE;
UPDATE "Task" SET "details" = CASE WHEN jsonb_typeof("details") = 'object' THEN "details" ELSE '{}'::jsonb END || '{"scheduled":true}'::jsonb,
  "revision" = "revision" + 1
WHERE "stepKey" IN ('appraisal', 'inspections')
  AND ("details" IS NULL OR jsonb_typeof("details") IN ('object', 'null'))
  AND COALESCE("details"->>'scheduled', 'false') <> 'true';
