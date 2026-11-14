import { z } from "zod";
import { json } from "../validation/common";

export const matterInput = z
  .object({
    title: z.string().trim().min(1).max(200),
    propertyAddress: z.string().trim().min(1).max(500),
    side: z.enum(["buyer", "seller"]),
    packageCode: z.enum(["essentials", "complete", "full_listing"]),
    agentId: z.string().min(1).optional(),
    details: json.default({}),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.packageCode === "full_listing" && v.side !== "seller")
      c.addIssue({
        code: "custom",
        path: ["side"],
        message: "Full Listing is for sellers",
      });
  });

export const stages = [
  "pending_review",
  "listing",
  "under_contract",
  "closing",
  "closed",
  "terminated",
  "archived",
] as const;
