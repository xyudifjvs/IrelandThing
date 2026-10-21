import { z } from "zod";
export const checkoutInput = z
  .object({
    matterId: z.string().min(1),
    kind: z.literal("service"),
    idempotencyKey: z.string().min(8).max(120),
    catalogRevision: z.number().int().positive().optional(),
  })
  .strict();
export const approvedCatalog = [
  {
    code: "essentials",
    name: "Essentials",
    priceCents: 37500,
    sellerOnly: false,
  },
  { code: "complete", name: "Complete", priceCents: 47500, sellerOnly: false },
  {
    code: "full_listing",
    name: "Full Listing",
    priceCents: 62500,
    sellerOnly: true,
  },
] as const;
