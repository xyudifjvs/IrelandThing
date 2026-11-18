-- Remedies is now a first-class checkbox. Keep the existing graph key so
-- signed rules, exact instants, and downstream dependencies remain intact.
BEGIN;
CREATE TEMP TABLE remedies_step_backfill ON COMMIT DROP AS
SELECT m."id" AS matter_id,
       COALESCE(i."position" + 1, (SELECT COALESCE(MAX(t."position"), -1) + 1 FROM "Task" t WHERE t."matterId" = m."id")) AS position,
       COALESCE(i."visibility", 'client') AS visibility,
       anchor.node
FROM "Matter" m
LEFT JOIN "Task" i ON i."matterId" = m."id" AND i."stepKey" = 'inspections'
LEFT JOIN LATERAL (
  SELECT node FROM jsonb_array_elements(CASE WHEN jsonb_typeof(m."details"->'checklistDateAnchors') = 'array' THEN m."details"->'checklistDateAnchors' ELSE '[]'::jsonb END) node
  WHERE node->>'key' = 'remedies' LIMIT 1
) anchor ON TRUE
WHERE m."checklistVersion" = 1
  AND NOT EXISTS (SELECT 1 FROM "Task" t WHERE t."matterId" = m."id" AND t."stepKey" = 'remedies');

UPDATE "Task" t SET "position" = t."position" + 1, "revision" = t."revision" + 1, "updatedAt" = CURRENT_TIMESTAMP
FROM remedies_step_backfill b WHERE t."matterId" = b.matter_id AND t."position" >= b.position;

INSERT INTO "Task" ("id", "matterId", "title", "status", "visibility", "kind", "position", "stepKey", "dateCapable", "dueDate", "dueAt", "actualDate", "actualAt", "dateRule", "details", "updatedAt")
SELECT 'remedies_' || b.matter_id, b.matter_id, 'Remedies',
       CASE b.node->>'status' WHEN 'completed' THEN 'completed' WHEN 'not_needed' THEN 'not_applicable' ELSE 'pending' END,
       b.visibility, 'checklist', b.position, 'remedies', TRUE,
       b.node->'due'->>'date', NULLIF(b.node->'due'->>'instant', '')::timestamptz,
       b.node->'actual'->>'date', NULLIF(b.node->'actual'->>'instant', '')::timestamptz,
       NULLIF(b.node->'rule', 'null'::jsonb), '{"scheduled":false,"showNoteToAgent":false,"dateWording":""}'::jsonb, CURRENT_TIMESTAMP
FROM remedies_step_backfill b;

-- Remove the promoted node from hidden anchors to avoid a duplicate graph key.
UPDATE "Matter" m SET "details" = jsonb_set(m."details", '{checklistDateAnchors}',
  COALESCE((SELECT jsonb_agg(node) FROM jsonb_array_elements(m."details"->'checklistDateAnchors') node WHERE node->>'key' IS DISTINCT FROM 'remedies'), '[]'::jsonb)),
  "revision" = m."revision" + 1, "updatedAt" = CURRENT_TIMESTAMP
WHERE m."checklistVersion" = 1 AND jsonb_typeof(m."details"->'checklistDateAnchors') = 'array';
UPDATE "Matter" m SET "revision" = m."revision" + 1, "updatedAt" = CURRENT_TIMESTAMP
WHERE m."id" IN (SELECT matter_id FROM remedies_step_backfill)
  AND jsonb_typeof(m."details"->'checklistDateAnchors') IS DISTINCT FROM 'array';

-- Only rename the standard label; preserve coordinator-customized titles.
UPDATE "Task" t SET "title" = 'Remedies Negotiated', "revision" = t."revision" + 1, "updatedAt" = CURRENT_TIMESTAMP
FROM "Matter" m WHERE m."id" = t."matterId" AND m."checklistVersion" = 1
  AND t."stepKey" = 'remedies_negotiated' AND t."title" IN ('Repairs Agreed On', 'Remedies Agreed On', 'Remedies agreed on');
COMMIT;
