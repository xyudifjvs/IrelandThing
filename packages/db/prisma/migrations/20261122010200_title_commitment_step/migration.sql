-- Give both working checklists a real, editable Title Commitment step.
-- Restore any existing seller title anchor/history without inventing a deadline.
BEGIN;
CREATE TEMP TABLE title_step_files ON COMMIT DROP AS
SELECT m."id",
  COALESCE((SELECT t."position" FROM "Task" t WHERE t."matterId"=m."id" AND t."stepKey"='clear_to_close'),
           (SELECT t."position"+1 FROM "Task" t WHERE t."matterId"=m."id" AND t."stepKey"='loan_commitment'),13) AS position,
  (SELECT node FROM jsonb_array_elements(CASE WHEN jsonb_typeof(m."details"->'checklistDateAnchors')='array' THEN m."details"->'checklistDateAnchors' ELSE '[]'::jsonb END) node
    WHERE node->>'key'='title_commitment' LIMIT 1) AS node,
  (SELECT t."id" FROM "Task" t WHERE t."matterId"=m."id" AND t."stepKey" IS NULL AND t."details"->>'originalChecklistKey'='title_commitment'
    ORDER BY t."createdAt",t."id" LIMIT 1) AS history_id,
  m."details"->'clientTitleCommitment' AS meta
FROM "Matter" m WHERE m."checklistVersion"=1 AND m."side" IN ('buyer','seller')
  AND NOT EXISTS (SELECT 1 FROM "Task" t WHERE t."matterId"=m."id" AND t."stepKey"='title_commitment');

UPDATE "Task" t SET "position"=t."position"+1,"revision"=t."revision"+1,"updatedAt"=CURRENT_TIMESTAMP
FROM title_step_files f WHERE t."matterId"=f."id" AND t."stepKey" IS NOT NULL AND t."position">=f.position;

UPDATE "Task" t SET "stepKey"='title_commitment',"dateCapable"=TRUE,"position"=f.position,
  "status"=CASE WHEN f.node IS NOT NULL THEN CASE f.node->>'status' WHEN 'completed' THEN 'completed' WHEN 'not_needed' THEN 'not_applicable' ELSE 'pending' END ELSE COALESCE(t."details"->>'originalStatus','pending') END,
  "dueDate"=CASE WHEN f.node IS NOT NULL THEN f.node->'due'->>'date' ELSE t."dueDate" END,
  "dueAt"=CASE WHEN f.node IS NOT NULL THEN (f.node->'due'->>'instant')::timestamptz ELSE t."dueAt" END,
  "actualDate"=CASE WHEN f.node IS NOT NULL THEN f.node->'actual'->>'date' ELSE t."actualDate" END,
  "actualAt"=CASE WHEN f.node IS NOT NULL THEN (f.node->'actual'->>'instant')::timestamptz ELSE t."actualAt" END,
  "dateRule"=CASE WHEN f.node IS NOT NULL THEN NULLIF(f.node->'rule','null'::jsonb) ELSE t."dateRule" END,
  "details"=t."details" || '{"scheduled":false}'::jsonb,
  "revision"=t."revision"+1,"updatedAt"=CURRENT_TIMESTAMP
FROM title_step_files f WHERE t."id"=f.history_id;

INSERT INTO "Task" ("id","matterId","title","stepKey","kind","visibility","position","dateCapable","status","dueDate","dueAt","actualDate","actualAt","dateRule","details","updatedAt")
SELECT 'title_commitment_'||f."id",f."id",'Title Commitment','title_commitment','checklist',
  COALESCE(f.meta->>'visibility','client'),f.position,TRUE,
  CASE f.node->>'status' WHEN 'completed' THEN 'completed' WHEN 'not_needed' THEN 'not_applicable' ELSE 'pending' END,
  f.node->'due'->>'date',(f.node->'due'->>'instant')::timestamptz,
  f.node->'actual'->>'date',(f.node->'actual'->>'instant')::timestamptz,NULLIF(f.node->'rule','null'::jsonb),
  jsonb_build_object('scheduled',FALSE,'showNoteToAgent',FALSE,'dateWording',COALESCE(f.meta->>'dateWording','')),CURRENT_TIMESTAMP
FROM title_step_files f WHERE f.history_id IS NULL;

UPDATE "Matter" m SET "details"=m."details" || jsonb_build_object('checklistDateAnchors',
  COALESCE((SELECT jsonb_agg(node) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(m."details"->'checklistDateAnchors')='array' THEN m."details"->'checklistDateAnchors' ELSE '[]'::jsonb END) node
    WHERE node->>'key'<>'title_commitment'),'[]'::jsonb)),
  "revision"=m."revision"+1,"updatedAt"=CURRENT_TIMESTAMP
WHERE m."id" IN (SELECT "id" FROM title_step_files);
COMMIT;
