-- Preserve existing user templates without assigning an inferred service group.
ALTER TABLE "CommunicationTemplate" ADD COLUMN "serviceGroup" TEXT;
