import { z } from "zod";
export const checkoutInput = z
  .object({
    matterId: z.string().min(1),
    kind: z.enum(["service", "gift"]),
    giftOrderId: z.string().optional(),
    idempotencyKey: z.string().min(8).max(120),
    catalogRevision: z.number().int().positive().optional(),
  })
  .strict();
export const approvedCatalog = [
  {
    code: "essentials",
    name: "Contract to Close",
    priceCents: 42500,
    approved: true,
    sellerOnly: false,
  },
  {
    code: "complete",
    name: "Contract to Close + Compliance",
    priceCents: 51500,
    sellerOnly: false,
    approved: true,
  },
  {
    code: "full_listing",
    name: "Full Listing",
    priceCents: 62500,
    approved: false,
    sellerOnly: true,
  },
] as const;
