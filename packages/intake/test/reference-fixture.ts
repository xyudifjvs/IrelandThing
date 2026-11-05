import type { ReferenceIntake } from "../src/reference";
/** Fully answered synthetic reference form, using the supplied help paths. */
export function completedReference(
  variant: ReferenceIntake["variant"],
): ReferenceIntake {
  const seller = variant.startsWith("seller");
  return {
    version: 1,
    variant,
    fields: {
      service: variant.endsWith("-compliance") ? "ctcc" : "ctc",
      side: seller ? "seller" : "buyer",
      a_num: "1420",
      a_street: "Synthetic Lane",
      a_city: "Columbus",
      a_state: "OH",
      a_zip: "43215",
      cash: "yes",
      occ: "Vacant",
      lender: "cash",
      b1_name: "Synthetic Client",
      b1_email: "synthetic-client@example.test",
      b1_phone: "555-0100",
      coop: "contract",
      addl: "no",
      title: seller ? "mls" : "unsure",
      fee: "$500",
      listcomm: "3%",
      emd: "no",
      hoa: "no",
      hoaSent: "no",
      mls: "no",
      gift: "no",
      directContact: "copy_agent",
      docsDotloop: variant.endsWith("-compliance"),
    },
    uploads: {},
    fileNames: {},
  };
}
