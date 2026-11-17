BEGIN;
ALTER TABLE "CustomMergeField" DROP CONSTRAINT "CustomMergeField_key_format";
ALTER TABLE "CustomMergeField" ADD CONSTRAINT "CustomMergeField_key_format" CHECK ("key" ~ '^[a-z][a-z0-9_]{0,79}$' AND "key" NOT IN ('constructor', 'prototype'));
CREATE TABLE "MergeFieldDefinition" (
 "key" TEXT PRIMARY KEY, "label" TEXT NOT NULL, "side" TEXT NOT NULL DEFAULT 'both', "source" JSONB NOT NULL,
 "revision" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "MergeFieldDefinition_key" CHECK ("key" ~ '^[a-z][a-z0-9_]{0,79}$' AND "key" NOT IN ('constructor','prototype')),
 CONSTRAINT "MergeFieldDefinition_side" CHECK ("side" IN ('both','buyer','seller'))
);
CREATE TABLE "MergeFieldSettings" (
 "ownerId" TEXT PRIMARY KEY, "name" TEXT NOT NULL DEFAULT '', "signature" TEXT NOT NULL DEFAULT '', "reviewLink" TEXT NOT NULL DEFAULT '',
 "revision" INTEGER NOT NULL DEFAULT 1, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "CompanyMergeProfile" (
 "kind" TEXT NOT NULL, "normalizedName" TEXT NOT NULL, "name" TEXT NOT NULL, "text" TEXT NOT NULL DEFAULT '',
 "revision" INTEGER NOT NULL DEFAULT 1, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("kind", "normalizedName"), CONSTRAINT "CompanyMergeProfile_kind" CHECK ("kind" IN ('title','brokerage'))
);
CREATE TABLE "MergeFieldTemplateBackup" (
 "templateId" TEXT PRIMARY KEY, "subject" TEXT NOT NULL, "body" TEXT NOT NULL, "revision" INTEGER NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
DO $$
DECLARE item RECORD; alias RECORD; new_subject TEXT; new_body TEXT; aliases JSONB := '{"propertyAddress":"property_address","clientName":"client_names","clientNames":"client_names","client_name":"client_names","agentName":"agent_name","agentEmail":"agent_email","coordinatorName":"tc_name","recipientName":"recipient_name","closingDate":"closing_date","earnestMoneyDate":"emd_due_date","acceptanceDate":"acceptance_date","inspectionDate":"inspection_deadline","hoaDate":"hoa_provision_deadline","titleDate":"title_commitment_deadline","appraisalDate":"appraisal_deadline","loanCommitmentDate":"loan_commitment_deadline","possessionDate":"possession_date","purchasePrice":"purchase_price","packageName":"package_name","closingAppointmentAt":"closing_scheduled","closingAppointmentPlace":"closing_appointment_place","titleName":"title_rep","titleCompany":"title_company","titleEmail":"title_rep_email","titlePhone":"title_rep_phone","title_contact":"title_rep","title_email":"title_rep_email","title_phone":"title_rep_phone","lenderName":"lender_name","lenderCompany":"lender_company","lenderEmail":"lender_email","lenderPhone":"lender_phone","loan_officer":"lender_name","coOpAgentName":"coop_agent_name","coOpAgentCompany":"coop_agent_brokerage","coOpAgentEmail":"coop_agent_email","coOpAgentPhone":"coop_agent_phone","co_op_agent":"coop_agent_name","co_op_brokerage":"coop_agent_brokerage","co_op_email":"coop_agent_email","co_op_phone":"coop_agent_phone","custom_geo_info":"geo_info","date_earnest_money_due":"emd_due_date","task_earnest_money_due":"emd_due_date","deadline_earnest_money_due":"emd_due_date","date_condo_hoa_doc_review":"hoa_review_deadline","task_condo_hoa_doc_review":"hoa_review_deadline","deadline_condo_hoa_doc_review":"hoa_review_deadline","date_closing":"closing_date","task_closing":"closing_date","deadline_closing":"closing_date","date_final_walkthrough":"walkthrough_deadline","task_final_walkthrough":"walkthrough_deadline","deadline_final_walkthrough":"walkthrough_deadline","date_loan_application":"loan_app_deadline","task_loan_application":"loan_app_deadline","deadline_loan_application":"loan_app_deadline","date_inspections":"inspection_deadline","task_inspections":"inspection_deadline","deadline_inspections":"inspection_deadline","date_remedies_negotiated":"remedy_deadline","task_remedies_negotiated":"remedy_deadline","deadline_remedies_negotiated":"remedy_deadline","date_loan_commitment":"loan_commitment_deadline","task_loan_commitment":"loan_commitment_deadline","deadline_loan_commitment":"loan_commitment_deadline","date_attorney_review":"attorney_review_deadline","task_attorney_review":"attorney_review_deadline","deadline_attorney_review":"attorney_review_deadline","date_remedies":"remedy_request_deadline","task_remedies":"remedy_request_deadline","deadline_remedies":"remedy_request_deadline","date_home_warranty":"warranty_deadline","task_home_warranty":"warranty_deadline","deadline_home_warranty":"warranty_deadline","date_appraisal_ordered":"appraisal_ordered_deadline","task_appraisal_ordered":"appraisal_ordered_deadline","deadline_appraisal_ordered":"appraisal_ordered_deadline","date_title_commitment":"title_commitment_deadline","task_title_commitment":"title_commitment_deadline","deadline_title_commitment":"title_commitment_deadline","date_condo_hoa_docs_provided":"hoa_provision_deadline","task_condo_hoa_docs_provided":"hoa_provision_deadline","deadline_condo_hoa_docs_provided":"hoa_provision_deadline","date_closing_date":"closing_date","task_closing_date":"closing_date","deadline_closing_date":"closing_date","date_earnest_money":"emd_due_date","task_earnest_money":"emd_due_date","deadline_earnest_money":"emd_due_date","date_earnest_money_emd":"emd_due_date","task_earnest_money_emd":"emd_due_date","deadline_earnest_money_emd":"emd_due_date","date_emd":"emd_due_date","task_emd":"emd_due_date","deadline_emd":"emd_due_date","date_home_inspections":"inspection_deadline","task_home_inspections":"inspection_deadline","deadline_home_inspections":"inspection_deadline","date_inspection":"inspection_deadline","task_inspection":"inspection_deadline","deadline_inspection":"inspection_deadline","date_inspection_deadline":"inspection_deadline","task_inspection_deadline":"inspection_deadline","deadline_inspection_deadline":"inspection_deadline","date_appraisal":"appraisal_deadline","task_appraisal":"appraisal_deadline","deadline_appraisal":"appraisal_deadline","date_appraisal_completed":"appraisal_deadline","task_appraisal_completed":"appraisal_deadline","deadline_appraisal_completed":"appraisal_deadline","date_financing_approved_loan_commitment":"loan_commitment_deadline","task_financing_approved_loan_commitment":"loan_commitment_deadline","deadline_financing_approved_loan_commitment":"loan_commitment_deadline","date_financing_commitment":"loan_commitment_deadline","task_financing_commitment":"loan_commitment_deadline","deadline_financing_commitment":"loan_commitment_deadline","date_condo_hoa_document_provision":"hoa_provision_deadline","task_condo_hoa_document_provision":"hoa_provision_deadline","deadline_condo_hoa_document_provision":"hoa_provision_deadline","date_condo_hoa_document_review":"hoa_review_deadline","task_condo_hoa_document_review":"hoa_review_deadline","deadline_condo_hoa_document_review":"hoa_review_deadline","date_buyers_final_walkthrough":"walkthrough_deadline","task_buyers_final_walkthrough":"walkthrough_deadline","deadline_buyers_final_walkthrough":"walkthrough_deadline","date_repairs_agreed_on":"remedy_deadline","task_repairs_agreed_on":"remedy_deadline","deadline_repairs_agreed_on":"remedy_deadline","date_possession":"possession_date","task_possession":"possession_date","deadline_possession":"possession_date","date_possession_date_and_time":"possession_date","task_possession_date_and_time":"possession_date","deadline_possession_date_and_time":"possession_date"}'::jsonb;
BEGIN
 IF EXISTS (SELECT 1 FROM "CustomMergeField" WHERE "key" = 'custom_geo_info') THEN
  IF EXISTS (SELECT 1 FROM "CustomMergeField" WHERE "key" = 'geo_info') THEN
   RAISE EXCEPTION 'Both custom_geo_info and geo_info exist; review their values before renaming. No field was deleted.';
  END IF;
  UPDATE "CustomMergeField" SET "key"='geo_info', "revision"="revision"+1, "updatedAt"=CURRENT_TIMESTAMP WHERE "key"='custom_geo_info';
 END IF;
 FOR item IN SELECT "id", "subject", "body", "revision" FROM "CommunicationTemplate" LOOP
  new_subject := item."subject"; new_body := item."body";
  FOR alias IN SELECT key, value FROM jsonb_each_text(aliases) LOOP
   new_subject := regexp_replace(new_subject, '\{\{[[:space:]]*' || alias.key || '[[:space:]]*\}\}', '{{' || alias.value || '}}', 'g');
   new_body := regexp_replace(new_body, '\{\{[[:space:]]*' || alias.key || '[[:space:]]*\}\}', '{{' || alias.value || '}}', 'g');
  END LOOP;
  -- Preserve arbitrary legacy custom checklist fields as one normalized code.
  new_subject := regexp_replace(new_subject, '\{\{[[:space:]]*(date|task|deadline)_([a-z0-9_]+)[[:space:]]*\}\}', '{{\2_date}}', 'g');
  new_body := regexp_replace(new_body, '\{\{[[:space:]]*(date|task|deadline)_([a-z0-9_]+)[[:space:]]*\}\}', '{{\2_date}}', 'g');
  IF new_subject IS DISTINCT FROM item."subject" OR new_body IS DISTINCT FROM item."body" THEN
   INSERT INTO "MergeFieldTemplateBackup" ("templateId","subject","body","revision") VALUES (item."id",item."subject",item."body",item."revision") ON CONFLICT DO NOTHING;
   UPDATE "CommunicationTemplate" SET "subject"=new_subject,"body"=new_body,"revision"="revision"+1 WHERE "id"=item."id";
  END IF;
 END LOOP;
END $$;

COMMIT;
