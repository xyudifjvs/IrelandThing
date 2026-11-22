-- Match the working seller checklist to the buyer checklist without rewriting
-- its contract dates/rules or the existing seller client presentation.
BEGIN;
CREATE TEMP TABLE unified_seller_files ON COMMIT DROP AS
SELECT "id", "details" FROM "Matter"
WHERE "checklistVersion" = 1 AND "side" = 'seller'
  AND "details"->'coordinatorChecklistUnified' IS DISTINCT FROM 'true'::jsonb;

-- Keep client order and the original title commitment authorization/wording.
UPDATE "Task" t SET "details" =
  (CASE WHEN jsonb_typeof(t."details") = 'object' THEN t."details" ELSE '{}'::jsonb END)
  || jsonb_build_object('clientPosition', t."position")
WHERE t."matterId" IN (SELECT "id" FROM unified_seller_files) AND t."stepKey" IS NOT NULL;

UPDATE "Matter" m SET "details" = m."details" || jsonb_build_object(
  'clientTitleCommitment', COALESCE((SELECT jsonb_build_object(
    'id', t."id", 'title', t."title", 'visibility', t."visibility",
    'dateWording', COALESCE(t."details"->>'dateWording', ''), 'position', t."position")
    FROM "Task" t WHERE t."matterId" = m."id" AND t."stepKey" = 'title_commitment' LIMIT 1), '{}'::jsonb),
  'checklistDateAnchors',
    COALESCE((SELECT jsonb_agg(node) FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(m."details"->'checklistDateAnchors') = 'array' THEN m."details"->'checklistDateAnchors' ELSE '[]'::jsonb END) node
      WHERE node->>'key' <> 'title_commitment'), '[]'::jsonb)
    || jsonb_build_array(COALESCE((SELECT jsonb_build_object(
      'key', 'title_commitment', 'dateCapable', true,
      'status', CASE WHEN t."status" IN ('completed','signed') THEN 'completed' WHEN t."status" = 'not_applicable' THEN 'not_needed' ELSE 'open' END,
      'due', CASE WHEN t."dueDate" IS NULL THEN NULL ELSE jsonb_build_object('date',t."dueDate",'instant',t."dueAt") END,
      'actual', CASE WHEN t."actualDate" IS NULL THEN NULL ELSE jsonb_build_object('date',t."actualDate",'instant',t."actualAt") END,
      'rule', t."dateRule") FROM "Task" t WHERE t."matterId" = m."id" AND t."stepKey" = 'title_commitment' LIMIT 1),
      (SELECT node FROM jsonb_array_elements(CASE WHEN jsonb_typeof(m."details"->'checklistDateAnchors') = 'array' THEN m."details"->'checklistDateAnchors' ELSE '[]'::jsonb END) node WHERE node->>'key' = 'title_commitment' LIMIT 1),
      '{"key":"title_commitment","dateCapable":true,"status":"open","due":null,"actual":null,"rule":null}'::jsonb)))
WHERE m."id" IN (SELECT "id" FROM unified_seller_files);

-- Preserve the original row as history; the date graph now uses its hidden anchor.
UPDATE "Task" SET "details" = "details" || jsonb_build_object('originalChecklistKey','title_commitment','originalStatus',"status"),
  "stepKey" = NULL, "status" = 'not_applicable', "revision" = "revision" + 1, "updatedAt" = CURRENT_TIMESTAMP
WHERE "matterId" IN (SELECT "id" FROM unified_seller_files) AND "stepKey" = 'title_commitment';

INSERT INTO "Task" ("id","matterId","title","stepKey","kind","visibility","position","dateCapable","status","details","updatedAt")
SELECT 'unified_' || v.key || '_' || m."id", m."id",
  CASE WHEN v.key = 'preapproval_pof' AND m."details"->>'purchaseType' = 'cash' THEN 'Proof of Funds'
       WHEN v.key = 'preapproval_pof' AND m."details"->>'purchaseType' = 'financed' THEN 'Pre-Approval' ELSE v.title END,
  v.key, 'checklist', 'client', v.position, TRUE,
  CASE WHEN v.key = 'loan_application' AND m."details"->>'purchaseType' = 'cash' THEN 'not_applicable' ELSE 'pending' END,
  jsonb_build_object('scheduled',v.key = 'appraisal_ordered','showNoteToAgent',false,'dateWording',''), CURRENT_TIMESTAMP
FROM unified_seller_files m CROSS JOIN (VALUES
  ('preapproval_pof','Pre-Approval / Proof of Funds',0),
  ('loan_application','Loan Application',1),
  ('condo_hoa_doc_review','Condo / HOA Document Review',8),
  ('appraisal_ordered','Appraisal Ordered',9)) v(key,title,position)
WHERE NOT EXISTS (SELECT 1 FROM "Task" t WHERE t."matterId" = m."id" AND t."stepKey" = v.key);

UPDATE "Task" t SET "title" = v.new_title
FROM (VALUES
  ('earnest_money_due','Earnest Money Deposit Received','Earnest Money Due'),
  ('inspections','Buyer''s Inspections','Home Inspections'),
  ('home_warranty','Home Warranty','Home Warranty Ordered'),
  ('condo_hoa_docs_provided','Condo / HOA Documents Provided','Condo / HOA Document Provision'),
  ('loan_commitment','Buyer''s Financing Approved','Financing Approved / Loan Commitment'),
  ('final_walkthrough','Buyer''s Final Walkthrough','Final Walkthrough')) v(key,old_title,new_title)
WHERE t."matterId" IN (SELECT "id" FROM unified_seller_files) AND t."stepKey" = v.key AND t."title" = v.old_title;

WITH ordered AS (
 SELECT t."id", COALESCE(v.position, 17 + ROW_NUMBER() OVER (PARTITION BY t."matterId", v.position IS NULL ORDER BY t."position",t."id")::int) AS position
 FROM "Task" t LEFT JOIN (VALUES
 ('preapproval_pof',0),('loan_application',1),('earnest_money_due',2),('attorney_review',3),
 ('inspections',4),('remedies',5),('remedies_negotiated',6),('condo_hoa_docs_provided',7),
 ('condo_hoa_doc_review',8),('appraisal_ordered',9),('appraisal',10),('home_warranty',11),
 ('loan_commitment',12),('clear_to_close',13),('final_walkthrough',14),('closing',15),('possession',16)) v(key,position) ON v.key = t."stepKey"
 WHERE t."matterId" IN (SELECT "id" FROM unified_seller_files) AND t."stepKey" IS NOT NULL
)
UPDATE "Task" t SET "position" = o.position,
  "details" = CASE WHEN t."stepKey" IN ('appraisal_ordered','appraisal') THEN jsonb_set(t."details",'{scheduled}',CASE WHEN t."stepKey" = 'appraisal_ordered' THEN 'true'::jsonb ELSE 'false'::jsonb END) ELSE t."details" END,
  "revision" = t."revision" + 1, "updatedAt" = CURRENT_TIMESTAMP
FROM ordered o WHERE o."id" = t."id";

UPDATE "Matter" SET "details" = "details" || '{"coordinatorChecklistUnified":true}'::jsonb,
  "revision" = "revision" + 1, "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" IN (SELECT "id" FROM unified_seller_files);
COMMIT;
