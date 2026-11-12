import { jsonObject } from "../snapshot";
import type { Prisma } from "@weatherly/db";
import {
  creationPersonSchema,
  transactionBusinessSchema,
} from "@weatherly/platform/handoff-contracts";
import { transactionContactSources } from "../../../contacts/src/transaction-sources";
import type { ReviewPayload } from "./inputs";

export function defaultReviewPayload(
  intake: {
    snapshot: Prisma.JsonValue;
    business: string | null;
    userId: string;
  },
  matter: {
    title: string;
    propertyAddress: string;
    side: string;
    agentId: string | null;
    agentRosterId: string | null;
  },
  agent: { name: string; email: string } | null,
): ReviewPayload {
  const snapshot = jsonObject(intake.snapshot);
  const facts: ReviewPayload["facts"] = {
    ...(matter.title.trim()
      ? { title: matter.title.trim().slice(0, 200) }
      : {}),
    ...(matter.propertyAddress.trim()
      ? { propertyAddress: matter.propertyAddress.trim().slice(0, 500) }
      : {}),
    ...(matter.side === "buyer" || matter.side === "seller"
      ? { side: matter.side }
      : {}),
    agentId: matter.agentId,
    agentRosterId: matter.agentRosterId,
    purchaseType:
      snapshot.purchaseType === "cash" || snapshot.purchaseType === "financed"
        ? snapshot.purchaseType
        : null,
    purchasePriceCents: null,
    acceptance: null,
  };
  const people: ReviewPayload["people"] = [];
  function add(role: string, raw: Prisma.JsonObject) {
    const entry = creationPersonSchema.safeParse({
      role,
      name: raw.name || raw.company,
      email: raw.email || "",
      phone: raw.phone || "",
      company: raw.company || undefined,
    });
    if (entry.success) people.push(entry.data);
  }
  if (agent && matter.agentId === intake.userId) add("my_agent", agent);
  if (Array.isArray(snapshot.clients))
    for (const client of snapshot.clients) add("client", jsonObject(client));
  const fields = jsonObject(jsonObject(snapshot.referenceIntake).fields);
  for (const role of ["title_rep", "lender", "co_op_agent"]) {
    const sources = transactionContactSources(snapshot, role);
    const source = sources[0];
    if (
      source &&
      (role !== "lender" || facts.purchaseType !== "cash") &&
      (!Object.keys(fields).length ||
        (role === "title_rep" && fields.title === "have") ||
        (role === "lender" && fields.lender === "have") ||
        (role === "co_op_agent" && fields.coop === "type"))
    )
      add(role, source);
  }
  if (fields.addl === "yes")
    for (const key of Object.keys(fields).filter((key) =>
      /^c\d+_name$/.test(key),
    )) {
      const prefix = key.slice(0, -5);
      add("other", {
        name: fields[key],
        email: fields[prefix + "_email"],
        phone: fields[prefix + "_phone"],
      });
    }
  const business = transactionBusinessSchema.safeParse({
    business: intake.business ?? "weatherly",
    packageCode:
      intake.business === "hto" ? "hto_included" : snapshot.packageCode,
  });
  return {
    facts,
    people,
    dates: [],
    ...(business.success ? { business: business.data } : {}),
  };
}
