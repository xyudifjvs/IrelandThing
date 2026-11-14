import { processCreationExtraction } from "@weatherly/ai";
import { recordIntakeGift } from "@weatherly/billing";
import {
  documentCleanupTopic,
  removeDeletedDocumentBlob,
  type ObjectStore,
} from "@weatherly/documents";
import { z } from "zod";
import type {
  JobHandler,
  JobRegistry,
} from "../../../packages/platform/src/jobs";

const giftInput = z.object({ matterId: z.string(), submissionId: z.string() });

export function createHandoffJobHandlers(
  store: ObjectStore,
  sendSystemEmail: JobHandler,
): JobRegistry {
  return {
    // Acknowledge historical notifications. The private digest covers these receipts.
    "intake.received": async () => ({ handledBy: "private_digest" }),
    "system.email": async (payload) => {
      if (
        payload &&
        typeof payload === "object" &&
        "purpose" in payload &&
        payload.purpose === "intake_received"
      )
        return { handledBy: "private_digest" };
      return sendSystemEmail(payload);
    },
    "creation.extract": processCreationExtraction,
    [documentCleanupTopic]: (payload) =>
      removeDeletedDocumentBlob(store, payload),
    "intake.gift": async (payload) => {
      const { matterId, submissionId } = giftInput.parse(payload);
      await recordIntakeGift(matterId, submissionId);
    },
  };
}
