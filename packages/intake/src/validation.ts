import type { Business } from "@weatherly/platform/handoff-contracts";
import { z } from "zod";
import { HttpError } from "@weatherly/platform";
import { referenceIntake, referenceDocumentIds, assertReferenceComplete } from "./reference";

const optionalEmail = z.union([z.email(), z.literal("")]).optional();
const contact = z
  .object({
    name: z.string().trim().max(200).default(""),
    email: optionalEmail,
    phone: z.string().max(60).optional(),
    relationship: z.string().max(200).optional(),
  })
  .strict();
const handling = z
  .object({
    choice: z.enum(["have", "listing_agent", "mls", "dotloop", "buyers_agent"]),
    name: z.string().max(250).optional(),
    email: optionalEmail,
    phone: z.string().max(60).optional(),
  })
  .strict();
export const intakePayload = z
  .object({
    packageCode: z.enum(["essentials", "complete", "full_listing"]),
    side: z.enum(["buyer", "seller"]),
    propertyAddress: z.string().trim().max(500).default(""),
    purchaseType: z.enum(["cash", "financed"]),
    contractSource: z.enum(["upload", "dotloop", "not_yet_executed"]),
    documentIds: z.array(z.string()).max(120).default([]),
    dotloopLoopId: z.string().max(200).optional(),
    clients: z.array(contact).max(12).default([]),
    relationship: z.string().max(200).optional(),
    directContact: z.enum(["copy_agent", "through_agent"]),
    title: handling.default({ choice: "have" }),
    lender: handling.optional(),
    hoa: z.enum([
      "none",
      "received_sent",
      "mls_dotloop_send",
      "request_listing_agent",
      "agent_will_email",
      "sent_buyers_agent",
      "seller_will_email",
    ]),
    priorPolicy: z
      .enum([
        "not_applicable",
        "dotloop_send",
        "request_sellers",
        "agent_will_email",
      ])
      .optional(),
    broker: z
      .object({
        name: z.string().max(200).optional(),
        email: optionalEmail,
        pre1978: z.boolean(),
        ownChecklist: z.boolean(),
        checklistDocumentId: z.string().optional(),
        // Keep the legacy first-document field readable for existing drafts.
        checklistDocumentIds: z.array(z.string()).max(30).optional(),
      })
      .strict()
      .optional(),
    notes: z.string().max(20000).default(""),
    gift: z
      .object({
        requested: z.boolean(),
        tier: z.enum(["classic", "signature", "luxury"]).optional(),
        choice: z.string().max(200).optional(),
        personalization: z.string().max(2000).optional(),
        deliveryAddress: z.string().max(500).optional(),
      })
      .strict(),
    linkedMatterId: z.string().optional(),
    replacesMatterId: z.string().trim().min(1).max(200).optional(),
    referenceIntake: referenceIntake.optional(),
  })
  .strict()
  .superRefine((v, c) => {
    const err = (path: (string | number)[], message: string) =>
      c.addIssue({ code: "custom", path, message });
    if (!v.referenceIntake && v.documentIds.length > 30)
      err(["documentIds"], "Attach at most 30 contract documents");
    if (
      v.referenceIntake &&
      (v.referenceIntake.variant.startsWith("seller") ? "seller" : "buyer") !==
        v.side
    )
      err(
        ["referenceIntake", "variant"],
        "Intake version must match represented side",
      );
    if (
      v.referenceIntake &&
      new Set([...v.documentIds, ...referenceDocumentIds(v.referenceIntake)])
        .size > 120
    )
      err(
        ["documentIds"],
        "Attach at most 120 intake documents across all groups",
      );
    if (v.referenceIntake && v.packageCode !== "full_listing") {
      const expectedPackage = v.referenceIntake.variant.endsWith("-compliance")
        ? "complete"
        : "essentials";
      if (v.packageCode !== expectedPackage)
        err(
          ["packageCode"],
          "Service package must match the selected intake service",
        );
    }
    const checklistIds = new Set([
      ...(v.broker?.checklistDocumentIds || []),
      ...(v.broker?.checklistDocumentId ? [v.broker.checklistDocumentId] : []),
    ]);
    if (checklistIds.size && !v.broker?.ownChecklist)
      err(
        ["broker", "checklistDocumentId"],
        "Remove checklist evidence when no brokerage checklist is selected",
      );
    if (checklistIds.size > 30)
      err(
        ["broker", "checklistDocumentIds"],
        "Attach at most 30 checklist documents",
      );
    if (v.packageCode === "full_listing" && v.side !== "seller")
      err(["side"], "Full Listing requires seller representation");
    if (v.contractSource !== "dotloop" && v.dotloopLoopId)
      err(
        ["dotloopLoopId"],
        "Remove Dotloop selection when another contract source is selected",
      );
    if (v.contractSource === "dotloop" && v.documentIds.length)
      err(["documentIds"], "Use one contract source");
    if (v.contractSource === "dotloop" && v.packageCode === "essentials")
      err(["contractSource"], "Dotloop intake requires Complete");
    if (v.purchaseType === "cash" && v.lender)
      err(["lender"], "Cash purchases must not include lender instructions");
    for (const key of ["title", "lender"] as const) {
      const h = v[key];
      if (!h) continue;
      if (h.choice !== "have" && (h.name || h.email || h.phone))
        err([key], "Remove contact details when requesting lookup");
      if (
        key === "title" &&
        !["have", "listing_agent", "mls"].includes(h.choice)
      )
        err([key, "choice"], "Select title details, listing agent, or MLS");
      if (
        key === "lender" &&
        !["have", "dotloop", "buyers_agent"].includes(h.choice)
      )
        err([key, "choice"], "Select lender details, Dotloop, or buyer agent");
      if (h.choice === "dotloop" && v.packageCode === "essentials")
        err([key, "choice"], "Dotloop requires Complete");
      if (h.choice === "listing_agent" && v.side !== "buyer")
        err([key, "choice"], "Listing-agent lookup applies to buyers");
      if (h.choice === "buyers_agent" && v.side !== "seller")
        err([key, "choice"], "Buyer-agent lookup applies to sellers");
      if (h.choice === "mls" && v.side !== "seller")
        err([key, "choice"], "MLS lookup applies to sellers");
    }
    if (
      v.side === "buyer" &&
      v.priorPolicy &&
      v.priorPolicy !== "not_applicable"
    )
      err(["priorPolicy"], "Prior title policy applies to sellers");
    const buyer = [
      "none",
      "received_sent",
      "mls_dotloop_send",
      "request_listing_agent",
      "agent_will_email",
    ];
    const seller = [
      "none",
      "sent_buyers_agent",
      "mls_dotloop_send",
      "seller_will_email",
    ];
    if (!(v.side === "buyer" ? buyer : seller).includes(v.hoa))
      err(["hoa"], "HOA handling does not match the represented side");
    if (
      !v.gift.requested &&
      (v.gift.tier ||
        v.gift.choice ||
        v.gift.personalization ||
        v.gift.deliveryAddress)
    )
      err(["gift"], "Remove gift details when no gift is requested");
  });
export type IntakePayload = z.infer<typeof intakePayload>;
/** Drafts remain partial. New reference submissions answer their active questions. */
export function assertSubmissionReady(data: IntakePayload, business: Business = "weatherly") {
  if (data.packageCode === "full_listing")
    throw new HttpError(
      409,
      "SERVICE_COMING_SOON",
      "Full Listing is coming soon and is not available for new submissions.",
    );
  const reference = data.referenceIntake;
  const hasContract = reference
    ? Boolean(reference.uploads.contractDocs?.length)
    : data.contractSource === "upload" && Boolean(data.documentIds.length);
  if (hasContract) {
    if (reference) assertReferenceComplete(reference, business);
    return;
  }
  if (data.packageCode === "essentials" && business === "weatherly")
    throw new HttpError(
      422,
      "CONTRACT_UPLOAD_REQUIRED",
      "Contract to Close requires an uploaded executed contract. You can save your draft at any time.",
    );
  const statedLocation = reference
    ? typeof reference.fields.contractLocation === "string" &&
      Boolean(reference.fields.contractLocation.trim())
    : data.contractSource === "dotloop" && Boolean(data.dotloopLoopId?.trim());
  const loopSelected =
    reference?.fields.docsDotloop === true ||
    reference?.fields.docsDotloop === "on";
  const transactionName = reference?.fields.transactionName;
  const identifiedLoop =
    loopSelected &&
    ((typeof transactionName === "string" && Boolean(transactionName.trim())) ||
      Boolean(data.propertyAddress.trim()) ||
      (typeof reference?.fields.a_num === "string" &&
        Boolean(reference.fields.a_num.trim()) &&
        typeof reference.fields.a_street === "string" &&
        Boolean(reference.fields.a_street.trim())));
  if (!statedLocation && !identifiedLoop && !reference?.variant.endsWith("-compliance"))
    throw new HttpError(
      422,
      "CONTRACT_REQUIRED",
      "Upload the executed contract or identify the transaction loop where Ireland can find it by transaction name or property address.",
    );
  if (reference) assertReferenceComplete(reference, business);
}

