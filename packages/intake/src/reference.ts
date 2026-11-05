import { z } from "zod";
import { dateOnly } from "@weatherly/matters";
import { HttpError } from "@weatherly/platform";

const safeKey = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]{0,79}$/)
  .refine((key) => !["constructor", "prototype", "__proto__"].includes(key));
const documentId = z.string().min(1).max(200);
const documentGroup = z.array(documentId).max(30);

/**
 * The supplied forms use distinct named controls. Keep their original answers,
 * including temporarily hidden answers, alongside the existing intake projection.
 * These are saved facts and requests, never permission to send/invite/pay.
 */
export const referenceIntake = z
  .object({
    version: z.literal(1),
    variant: z.enum([
      "buyer",
      "seller",
      "buyer-compliance",
      "seller-compliance",
    ]),
    fields: z.record(safeKey, z.union([z.string().max(20000), z.boolean()])),
    uploads: z
      .object({
        contractDocs: documentGroup.optional(),
        hoaFiles: documentGroup.optional(),
        utilFiles: documentGroup.optional(),
        policyFiles: documentGroup.optional(),
      })
      .strict(),
    fileNames: z.record(documentId, z.string().max(500)),
  })
  .strict()
  .superRefine((value, context) => {
    const issue = (path: (string | number)[], message: string) =>
      context.addIssue({ code: "custom", path, message });
    if (Object.keys(value.fields).length > 200)
      issue(["fields"], "Save at most 200 intake fields");
    if (JSON.stringify(value.fields).length > 150000)
      issue(["fields"], "Intake answers exceed the saved-field limit");
    for (const [name, answer] of Object.entries(value.fields)) {
      if (typeof answer === "boolean") {
        if (!["docsDotloop", "giftAgree"].includes(name))
          issue(["fields", name], "Save text for this intake answer");
        continue;
      }
      if (!answer) continue;
      if (
        referenceFieldActive(name, value) &&
        name.endsWith("_email") &&
        !z.email().safeParse(answer).success
      )
        issue(["fields", name], "Enter a valid email address");
      if (
        name === "hoaDate" &&
        referenceFieldActive(name, value) &&
        !dateOnly.safeParse(answer).success
      )
        issue(["fields", name], "Enter a real HOA delivery date (YYYY-MM-DD)");
      if (!["notes", "utilNotes"].includes(name) && answer.length > 2000)
        issue(["fields", name], "Use at most 2,000 characters for this answer");
    }
    const expectedSide = value.variant.startsWith("seller")
      ? "seller"
      : "buyer";
    const expectedService = value.variant.endsWith("-compliance")
      ? "ctcc"
      : "ctc";
    if (value.fields.side && value.fields.side !== expectedSide)
      issue(
        ["fields", "side"],
        "Representation must match this intake version",
      );
    if (value.fields.service && value.fields.service !== expectedService)
      issue(["fields", "service"], "Service must match this intake version");
    const ids = new Set(Object.values(value.uploads).flat());
    if (Object.keys(value.fileNames).length > 120)
      issue(["fileNames"], "Save names for at most 120 uploaded documents");
    for (const id of Object.keys(value.fileNames)) {
      if (!ids.has(id))
        issue(["fileNames", id], "File names must refer to an intake upload");
    }
  });

export type ReferenceIntake = z.infer<typeof referenceIntake>;

function referenceFieldActive(name: string, value: ReferenceIntake) {
  const f = value.fields;
  if (/^c\d+_/.test(name)) return f.addl === "yes";
  if (name.startsWith("co_")) return f.coop === "type";
  if (name.startsWith("t_")) return f.title === "have";
  if (name.startsWith("l_")) return f.cash === "no" && f.lender === "have";
  if (name === "hoaDate")
    return (
      f.hoa === "yes" &&
      ["upload", "mls"].includes(String(f.hoaDocs)) &&
      f.hoaSent === "yes"
    );
  return true;
}

/** Only final submission calls this; draft storage keeps every partial answer. */
export function referenceCompletionIssues(reference: ReferenceIntake) {
  const f = reference.fields;
  const text = (name: string) =>
    typeof f[name] === "string" ? f[name].trim() : "";
  const seller = reference.variant.startsWith("seller");
  const issues: { field: string; message: string }[] = [];
  const required = (name: string, label: string) => {
    if (!text(name)) issues.push({ field: name, message: label });
  };
  const choice = (name: string, values: readonly string[], label: string) => {
    if (!values.includes(text(name)))
      issues.push({ field: name, message: label });
  };
  const people = (prefix: string) => [
    ...new Set(
      Object.keys(f).flatMap((name) => {
        const match = new RegExp(
          `^${prefix}(\\d+)_(?:name|email|phone|rel)$`,
        ).exec(name);
        return match ? [match[1]] : [];
      }),
    ),
  ];
  choice(
    "service",
    [reference.variant.endsWith("-compliance") ? "ctcc" : "ctc"],
    "Service selection",
  );
  choice(
    "side",
    [seller ? "seller" : "buyer"],
    "Buyer or seller representation",
  );
  for (const [name, label] of [
    ["a_num", "Property street number"],
    ["a_street", "Property street name"],
    ["a_city", "Property city"],
    ["a_state", "Property state"],
    ["a_zip", "Property ZIP code"],
  ])
    required(name, label);
  choice("cash", ["yes", "no"], "Cash purchase: yes or no");
  if (seller)
    choice("occ", ["Vacant", "Occupied"], "Vacant or occupied property");
  const clients = people("b");
  if (clients.length > 12)
    issues.push({
      field: "b1_name",
      message: "At most 12 buyer or seller contacts",
    });
  if (!clients.length)
    issues.push({
      field: "b1_name",
      message: "At least one buyer or seller contact",
    });
  for (const i of clients)
    for (const [field, label] of [
      ["name", "name"],
      ["email", "email"],
      ["phone", "phone"],
    ])
      required(
        `b${i}_${field}`,
        `${seller ? "Seller" : "Buyer"} ${i} ${label}`,
      );
  if (clients.length > 1) {
    choice(
      "buyerRel",
      [
        "Married",
        "Engaged / partners",
        "Siblings",
        "Parent / child",
        "Friends",
        "Business partners",
        "other",
      ],
      "Relationship between clients",
    );
    if (f.buyerRel === "other")
      required("buyerRelOther", "Other client relationship");
  }
  choice(
    "coop",
    ["contract", "type"],
    "Co-op contact confirmation or manual details",
  );
  if (f.coop === "type")
    for (const [name, label] of [
      ["co_brokerage", "Co-op brokerage"],
      ["co_name", "Co-op agent name"],
      ["co_phone", "Co-op phone"],
      ["co_email", "Co-op email"],
    ])
      required(name, label);
  choice("addl", ["yes", "no"], "Additional contacts: yes or no");
  if (f.addl === "yes") {
    const contacts = people("c");
    if (contacts.length > 12)
      issues.push({
        field: "c1_name",
        message: "At most 12 additional contacts",
      });
    if (!contacts.length)
      issues.push({
        field: "c1_name",
        message: "At least one additional contact",
      });
    for (const i of contacts) {
      required(`c${i}_name`, `Additional contact ${i} name`);
      if (!text(`c${i}_email`) && !text(`c${i}_phone`))
        issues.push({
          field: `c${i}_email`,
          message: `Additional contact ${i} email or phone`,
        });
    }
  }
  choice(
    "title",
    seller ? ["have", "mls"] : ["have", "mls", "unsure"],
    "Title company details or supplied lookup choice",
  );
  const manual = (prefix: string, person: string, label: string) => {
    if (!text(`${prefix}_co`) && !text(person))
      issues.push({
        field: `${prefix}_co`,
        message: `${label} company or contact name`,
      });
    if (!text(`${prefix}_email`) && !text(`${prefix}_phone`))
      issues.push({
        field: `${prefix}_email`,
        message: `${label} email or phone`,
      });
  };
  if (f.title === "have") manual("t", "t_contact", "Title");
  choice(
    "lender",
    f.cash === "yes"
      ? ["cash"]
      : seller
        ? ["have", "preapproval", "buyersagent"]
        : ["have", "preapproval", "deciding"],
    f.cash === "yes"
      ? "Lender: N/A – cash"
      : "Lender details or supplied help choice",
  );
  if (f.cash === "no" && f.lender === "have")
    manual("l", "l_officer", "Lender");
  required(
    "fee",
    seller ? "Seller broker fee amount" : "Buyer broker fee amount",
  );
  if (seller) required("listcomm", "Listing commission");
  else
    choice(
      "emd",
      ["yes", "no"],
      "Deduct earnest money from commission: yes or no",
    );
  choice("hoa", ["yes", "no"], "HOA: yes or no");
  if (f.hoa === "yes") {
    choice(
      "hoaDocs",
      ["upload", "mls", "request"],
      "HOA document source or request help",
    );
    if (f.hoaDocs === "upload" && !reference.uploads.hoaFiles?.length)
      issues.push({
        field: "hoaFiles",
        message: "Upload HOA documents or select a different source",
      });
    if (["upload", "mls"].includes(String(f.hoaDocs))) {
      choice("hoaSent", ["yes", "no"], "HOA documents sent: yes or no");
      if (f.hoaSent === "yes")
        required("hoaDate", "HOA document delivery date");
    }
  }
  if (!seller) {
    choice("mls", ["yes", "no"], "MLS closing instructions: yes or no");
    if (f.mls === "yes") required("mls_sell", "MLS selling agent name");
  }
  choice("gift", ["yes", "no"], "Closing gift: yes or no");
  if (f.gift === "yes") {
    choice("tier", ["Classic", "Signature", "Luxury"], "Gift tier request");
    choice(
      "giftOpt",
      ["Gift Option 1", "Gift Option 2"],
      "Gift option request",
    );
    if (f.giftAgree !== true && f.giftAgree !== "on")
      issues.push({
        field: "giftAgree",
        message: "Gift policy acknowledgment",
      });
  }
  return issues;
}
export function assertReferenceComplete(reference: ReferenceIntake) {
  const issues = referenceCompletionIssues(reference);
  if (issues.length)
    throw new HttpError(
      422,
      "INTAKE_INCOMPLETE",
      `Complete the active intake answers: ${issues
        .slice(0, 10)
        .map((issue) => issue.message)
        .join(
          "; ",
        )}${issues.length > 10 ? `; and ${issues.length - 10} more.` : "."}`,
    );
}

export function referenceDocumentIds(reference?: ReferenceIntake) {
  return [...new Set(Object.values(reference?.uploads || {}).flat())];
}

export function referenceFollowups(reference: ReferenceIntake) {
  const fields = reference.fields;
  const seller = reference.variant.startsWith("seller");
  const tasks: { title: string; field: string; kind: string }[] = [];
  const add = (title: string, field: string, kind = "intake") =>
    tasks.push({ title, field, kind });
  if (!fields.fee) add("Obtain broker fee instructions", "fee");
  else add("Review broker fee instructions", "fee");
  if (seller) {
    add(
      fields.listcomm
        ? "Review listing commission instructions"
        : "Obtain listing commission instructions",
      "listcomm",
    );
    if (!fields.occ) add("Confirm seller property occupancy", "occ");
    add("Review seller utilities and previous title policy", "utilNotes");
  } else if (fields.emd) {
    add("Review earnest-money commission deduction instructions", "emd");
  }
  if (fields.coop === "contract")
    add("Verify confirmed co-op contact information in the contract", "coop");
  else if (fields.coop === "type")
    add("Review manually supplied co-op contact information", "co_name");
  else add("Obtain co-op contact confirmation or details", "coop");
  if (fields.addl === "yes")
    add("Review additional communication and portal contact requests", "addl");
  if (fields.title === "mls")
    add("Review title company contact confirmation from MLS", "title");
  if (fields.lender === "preapproval")
    add(
      "Review lender contact confirmation from uploaded pre-approval",
      "lender",
    );
  if (fields.lender === "deciding")
    add("Follow up on buyer lender selection", "lender");
  if (fields.hoa === "yes") {
    add("Review HOA document source and delivery instructions", "hoaDocs");
    if (fields.hoaSent === "yes")
      add(
        fields.hoaDate
          ? "Verify reported HOA document delivery date"
          : "Obtain HOA document delivery date",
        "hoaDate",
      );
  } else if (!fields.hoa) add("Confirm HOA applicability", "hoa");
  if (!seller && fields.mls === "yes")
    add("Review MLS closing agent instructions", "mls_sell");
  if (
    reference.variant.endsWith("-compliance") &&
    (fields.docsDotloop === true ||
      fields.docsDotloop === "on" ||
      (typeof fields.contractLocation === "string" &&
        fields.contractLocation.trim()))
  )
    add(
      "Locate executed contract in identified transaction loop; verify account access",
      "docsDotloop",
      "compliance",
    );
  return tasks;
}
