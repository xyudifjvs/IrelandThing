import type { ReferenceVariant } from "./reference-templates";
export type ReferenceIntake = {
  version: 1;
  variant: ReferenceVariant;
  fields: Record<string, string | boolean>;
  uploads: Record<string, string[]>;
  fileNames: Record<string, string>;
};
export const fieldLabels: Record<string, string> = {
  contractLocation: "Executed contract location",
  directContact: "Client communication preference",
  service: "Service",
  side: "Representing",
  a_num: "Street #",
  a_street: "Street name",
  a_city: "City",
  a_state: "State",
  a_zip: "ZIP code",
  cash: "Cash purchase",
  occ: "Property occupancy",
  docsDotloop: "Contract documents in Dotloop",
  buyerRel: "Client relationship",
  buyerRelOther: "Other client relationship",
  coop: "Co-op contact source",
  co_brokerage: "Co-op brokerage",
  co_name: "Co-op agent name",
  co_phone: "Co-op phone",
  co_email: "Co-op email",
  addl: "Additional contacts",
  title: "Title contact source",
  t_co: "Title company",
  t_contact: "Title contact name",
  t_email: "Title email",
  t_phone: "Title phone",
  lender: "Lender contact source",
  l_co: "Lender",
  l_officer: "Loan officer",
  l_email: "Lender email",
  l_phone: "Lender phone",
  fee: "Buyer broker fee",
  listcomm: "Listing agent commission",
  emd: "Deduct earnest money from commission",
  hoa: "HOA",
  hoaDocs: "HOA document source",
  hoaSent: "HOA documents sent",
  hoaDate: "HOA delivery date",
  notes: "Additional information",
  mls: "MLS closing instructions",
  mls_sell: "MLS selling agent",
  mls_cosell: "MLS co-selling agent",
  utilNotes: "Utility information / previous title policy",
  gift: "Closing gift requested",
  tier: "Gift tier",
  giftOpt: "Gift selection",
  giftAgree: "Gift policy acknowledged",
};
export function answerLabel(key: string, side = "buyer") {
  if (key === "fee" && side === "seller") return "Seller broker fee";
  const person = /^([bc])(\d+)_(name|email|phone|rel)$/.exec(key);
  if (person)
    return `${person[1] === "c" ? "Additional contact" : side === "seller" ? "Seller" : "Buyer"} ${person[2]} · ${{ name: "Name", email: "Email", phone: "Phone", rel: "Relationship" }[person[3]]}`;
  return Object.hasOwn(fieldLabels, key) ? fieldLabels[key] : key;
}
export function answerText(key: string, value: string | boolean) {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const choices: Record<string, Record<string, string>> = {
    service: {
      ctc: "Contract to Close",
      ctcc: "Contract to Close + Compliance",
    },
    side: { buyer: "Buyer", seller: "Seller" },
    directContact: {
      copy_agent: "Contact clients directly and copy agent",
      through_agent: "Communicate through agent only",
    },
    coop: {
      contract: "Confirmed: use contract contact information",
      type: "Manual contact information",
    },
    title: {
      have: "I have the details",
      mls: "MLS / Dotloop reference",
      unsure: "Reach out to listing agent",
    },
    lender: {
      have: "I have the details",
      preapproval: "Use pre-approval contact information",
      deciding: "Buyer is deciding between lenders",
      buyersagent: "Reach out to buyer’s agent",
      cash: "N/A – cash",
    },
    hoaDocs: {
      upload: "Uploaded documents",
      mls: "MLS / Dotloop reference",
      request: "Request documents",
    },
  };
  if (["cash", "addl", "emd", "hoa", "hoaSent", "mls", "gift"].includes(key))
    return value === "yes" ? "Yes" : value === "no" ? "No" : value;
  const dictionary = Object.hasOwn(choices, key) ? choices[key] : undefined;
  return dictionary && Object.hasOwn(dictionary, value)
    ? dictionary[value]
    : value;
}
export function normalizeReference(ref: ReferenceIntake, packageCode: string) {
  const f = ref.fields,
    v = (key: string) => String(f[key] ?? "");
  const side = ref.variant.startsWith("seller") ? "seller" : "buyer";
  const relation =
    v("buyerRel") === "other" ? v("buyerRelOther") : v("buyerRel");
  const clients = [
    ...new Set(
      Object.keys(f)
        .map((k) => /^b(\d+)_/.exec(k)?.[1])
        .filter(Boolean),
    ),
  ].map((i) => ({
    name: v(`b${i}_name`),
    email: v(`b${i}_email`),
    phone: v(`b${i}_phone`),
    relationship: relation,
  }));
  const handling = (prefix: string, choice: string) =>
    choice === "have" && v(prefix === "t" ? "title" : "lender") === "have"
      ? {
          choice,
          name: [
            v(prefix + "_co"),
            v(prefix === "t" ? "t_contact" : "l_officer"),
          ]
            .filter(Boolean)
            .join(" · "),
          email: v(prefix + "_email"),
          phone: v(prefix + "_phone"),
        }
      : { choice };
  return {
    packageCode,
    side,
    propertyAddress: [
      [v("a_num"), v("a_street")].filter(Boolean).join(" "),
      v("a_city"),
      [v("a_state").toUpperCase(), v("a_zip")].filter(Boolean).join(" "),
    ]
      .filter(Boolean)
      .join(", "),
    purchaseType: v("cash") === "yes" ? "cash" : "financed",
    contractSource: "upload",
    documentIds: [...new Set(Object.values(ref.uploads).flat())],
    clients,
    relationship: relation,
    directContact:
      v("directContact") === "through_agent" ? "through_agent" : "copy_agent",
    title: handling(
      "t",
      v("title") === "mls"
        ? side === "buyer"
          ? "listing_agent"
          : "mls"
        : v("title") === "unsure" && side === "buyer"
          ? "listing_agent"
          : "have",
    ),
    ...(v("cash") === "yes"
      ? {}
      : {
          lender: handling(
            "l",
            v("lender") === "buyersagent" && side === "seller"
              ? "buyers_agent"
              : "have",
          ),
        }),
    hoa:
      v("hoa") !== "yes"
        ? "none"
        : v("hoaDocs") === "request"
          ? side === "buyer"
            ? "request_listing_agent"
            : "seller_will_email"
          : v("hoaSent") === "yes"
            ? side === "buyer"
              ? "received_sent"
              : "sent_buyers_agent"
            : "mls_dotloop_send",
    priorPolicy: "not_applicable",
    notes: v("notes"),
    gift:
      v("gift") === "yes"
        ? {
            requested: true,
            tier: (v("tier") || "Classic").toLowerCase(),
            choice: v("giftOpt"),
          }
        : { requested: false },
    referenceIntake: ref,
  };
}
