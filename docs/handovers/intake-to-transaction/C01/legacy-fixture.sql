-- Load only into a fresh synthetic C01 database with the previous migrations.
BEGIN;

DO $fixture$
BEGIN
  IF current_database() !~ '^weatherly_c01_[a-z0-9_]+_test$'
    OR EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Matter' AND column_name = 'business'
    ) THEN
    RAISE EXCEPTION 'This fixture requires a disposable C01 database at the legacy schema';
  END IF;
END
$fixture$;

INSERT INTO "User" ("id", "name", "email", "emailVerified", "role", "brokerage", "updatedAt")
VALUES
  ('c01-owner', 'Synthetic coordinator', 'coordinator@example.test', true, 'coordinator', NULL, now()),
  ('c01-agent', 'Synthetic agent', 'agent@example.test', true, 'agent', 'Synthetic Realty', now()),
  ('c01-client', 'Synthetic client', 'client@example.test', true, 'client', NULL, now());
INSERT INTO "Account" ("id", "accountId", "providerId", "userId", "password", "updatedAt")
VALUES ('c01-preview-credential', 'c01-agent', 'credential', 'c01-agent', 'synthetic-credential-marker', now());
INSERT INTO "Invitation" ("id", "email", "role", "tokenHash", "expiresAt", "acceptedAt", "invitedById")
VALUES ('c01-invite', 'agent@example.test', 'agent', repeat('a', 64), now() + interval '1 day', now(), 'c01-owner');

INSERT INTO "Matter" ("id", "title", "propertyAddress", "side", "packageCode", "stage", "agentId", "details", "updatedAt")
SELECT 'c01-' || stage, 'Synthetic ' || stage, '42 Example Avenue', 'buyer',
  CASE WHEN stage = 'listing' THEN 'full_listing' ELSE 'essentials' END,
  stage, 'c01-agent',
  '{"serviceSnapshot":{"priceCents":42500,"currency":"USD"},"legacyBrokerData":{"instruction":"retain"},"contacts":[{"name":"Synthetic lender","role":"lender"}]}',
  now()
FROM unnest(ARRAY['pending_review','under_contract','closing','closed','terminated','archived','listing']) AS stages(stage);
INSERT INTO "MatterParticipant" ("id", "matterId", "userId", "role")
VALUES ('c01-participant', 'c01-under_contract', 'c01-client', 'client');
INSERT INTO "Task" ("id", "matterId", "title", "status", "visibility", "kind", "dueDate", "details", "revision", "position", "updatedAt")
VALUES
  ('c01-task-1', 'c01-under_contract', 'Custom inspection', 'completed', 'agent', 'checklist', '2026-11-12',
   '{"workflowKey":"old-inspection","manualOverride":true,"appointment":"2026-11-12T15:00:00Z","note":"Synthetic step note"}', 4, 7, now()),
  ('c01-task-2', 'c01-under_contract', 'Custom closing', 'pending', 'client', 'checklist', '2026-11-20',
   '{"workflowKey":"old-closing"}', 2, 2, now());
INSERT INTO "Deadline" ("id", "matterId", "label", "date", "status", "details", "revision", "updatedAt")
VALUES ('c01-legacy-date', 'c01-under_contract', 'Closing deadline', '2026-11-20', 'confirmed',
  '{"workflowKey":"old-closing","visibility":"client"}', 5, now());
INSERT INTO "Note" ("id", "matterId", "body", "visibility", "authorId", "updatedAt")
VALUES ('c01-private-note', 'c01-under_contract', 'Synthetic private note', 'coordinator', 'c01-owner', now());

INSERT INTO "IntakeDraft" ("id", "userId", "payload", "status", "submittedMatterId", "submittedAt", "updatedAt")
VALUES
  ('c01-pending-draft', 'c01-agent', '{"side":"buyer"}', 'submitted', 'c01-pending_review', now(), now()),
  ('c01-processed-draft', 'c01-agent', '{"side":"buyer"}', 'submitted', 'c01-under_contract', now(), now());
INSERT INTO "IntakeSubmission" ("id", "draftId", "idempotencyKey", "userId", "matterId", "snapshot", "processedAt", "processedById")
VALUES
  ('c01-pending-intake', 'c01-pending-draft', 'c01-pending-key', 'c01-agent', 'c01-pending_review', '{"address":"42 Example Avenue"}', NULL, NULL),
  ('c01-processed-intake', 'c01-processed-draft', 'c01-processed-key', 'c01-agent', 'c01-under_contract', '{"address":"42 Example Avenue"}', now(), 'c01-owner');
INSERT INTO "ChecklistShare" ("id", "matterId", "tokenHash", "issuedById", "expiresAt")
VALUES ('c01-old-share', 'c01-under_contract', repeat('b', 64), 'c01-owner', now() + interval '1 day');

INSERT INTO "Document" ("id", "matterId", "name", "mimeType", "visibility", "category", "createdById", "updatedAt")
VALUES
  ('c01-document', 'c01-under_contract', 'Synthetic contract', 'application/pdf', 'client', 'contract', 'c01-agent', now()),
  ('c01-agreement-document', NULL, 'Synthetic signed agreement', 'application/pdf', 'coordinator', 'agreement', 'c01-owner', now());
INSERT INTO "DocumentVersion" ("id", "documentId", "objectKey", "checksum", "size", "version", "uploadedById", "uploadRequestId")
VALUES
  ('c01-version-1', 'c01-document', 'synthetic-c01/file-v1', repeat('c', 64), 100, 1, 'c01-agent', 'c01-upload-1'),
  ('c01-version-2', 'c01-document', 'synthetic-c01/file-v2', repeat('d', 64), 120, 2, 'c01-agent', 'c01-upload-2');
INSERT INTO "Agreement" ("id", "userId", "version", "status", "documentId", "updatedAt")
VALUES ('c01-agreement', 'c01-agent', '1', 'approved', 'c01-agreement-document', now());
INSERT INTO "BusinessContact" ("id", "ownerId", "kind", "name", "email", "identityKey", "updatedAt")
VALUES ('c01-directory', 'c01-owner', 'lender', 'Synthetic lender', 'lender@example.test', 'c01-lender-key', now());

INSERT INTO "PaymentOrder" ("id", "matterId", "createdById", "idempotencyKey", "kind", "amountCents", "status", "snapshot", "updatedAt")
VALUES
  ('c01-service-order', 'c01-closed', 'c01-owner', 'c01-service', 'service', 42500, 'paid', '{"priceCents":42500,"currency":"USD"}', now()),
  ('c01-gift-order-payment', 'c01-closed', 'c01-owner', 'c01-gift', 'gift', 5500, 'paid', '{"priceCents":5500,"currency":"USD"}', now());
INSERT INTO "GiftOrder" ("id", "matterId", "paymentOrderId", "selection", "status", "updatedAt")
VALUES ('c01-gift-order', 'c01-closed', 'c01-gift-order-payment', '{"name":"Synthetic gift"}', 'paid', now());

INSERT INTO "CommunicationTemplate" ("id", "name", "side", "phase", "subject", "body", "serviceGroup")
VALUES ('c01-template', 'Synthetic template', 'buyer', 'closing', 'Synthetic subject', 'Synthetic body', 'essentials');
INSERT INTO "EmailThread" ("id", "ownerId", "providerThreadId", "matterId", "subject", "status", "updatedAt")
VALUES ('c01-thread', 'c01-owner', 'c01-provider-thread', 'c01-closed', 'Synthetic subject', 'assigned', now());
INSERT INTO "EmailMessage" ("id", "providerMessageId", "threadId", "fromEmail", "to", "subject", "text", "sentAt", "direction")
VALUES ('c01-message', 'c01-provider-message', 'c01-thread', 'coordinator@example.test',
  '["client@example.test"]', 'Synthetic subject', 'Synthetic message', now(), 'outbound');
INSERT INTO "EmailDraft" ("id", "matterId", "createdById", "to", "subject", "body", "attachmentIds", "status", "sendKey", "providerMessageId", "sentAt", "updatedAt")
VALUES ('c01-draft-email', 'c01-closed', 'c01-owner', '["client@example.test"]', 'Synthetic subject',
  'Synthetic body', '["c01-document"]', 'sent', 'c01-email-send', 'c01-provider-message', now(), now());
INSERT INTO "AIProposal" ("id", "matterId", "kind", "result", "sourceRefs", "sourceRevision", "requestedById")
VALUES ('c01-proposal', 'c01-pending_review', 'document', '{"synthetic":true}', '["c01-version-2"]', 1, 'c01-owner');
INSERT INTO "OutboxJob" ("id", "topic", "payload", "idempotencyKey", "state", "updatedAt")
VALUES ('c01-outbox', 'intake.submitted', '{"matterId":"c01-pending_review","submissionId":"c01-pending-intake"}',
  'c01-outbox-key', 'pending', now());

COMMIT;
