import type { CreationProposal } from "../../../../../../../packages/ai/src/creation-extraction/proposal";
import {
  checklistTemplate,
  checklistWorkflowDefault,
  remediesAnchorKey,
} from "../../../../../../../packages/matters/src/checklist/templates";
import { buildChecklistSeed } from "../../../../../../../packages/matters/src/checklist/seed";
import type {
  ChecklistDateInput,
  CreationConfirm,
  CreationPerson,
  SourceVersion,
  TransactionBusiness,
} from "@weatherly/platform/handoff-contracts";

export type ReviewFacts = Partial<CreationConfirm["facts"]>;

export type Review = {
  id: string;
  revision: number;
  state: "open" | "confirmed";
  intake: {
    id: string;
    snapshot: Record<string, unknown>;
    createdAt: string;
    documents?: { id: string; name: string }[];
    agentSource?: "submitted" | "current_profile" | null;
    agent: {
      name: string;
      email: string;
      brokerage: string | null;
      phone: string | null;
    } | null;
  } | null;
  facts: ReviewFacts;
  people: CreationPerson[];
  peopleEdited?: boolean;
  dates: ChecklistDateInput[];
  business?: TransactionBusiness;
  sources: SourceVersion[];
  documents: {
    id: string;
    name: string;
    mimeType: string;
    category: string;
    latestVersion: {
      id: string;
      version: number;
      processingStatus: string;
    } | null;
    pinnedVersionId: string | null;
  }[];
  extraction: {
    generation: number;
    status:
      "idle" | "queued" | "running" | "proposed" | "unavailable" | "skipped";
    proposal: CreationProposal | null;
  };
  confirmedMatterId: string | null;
};

export const reviewEndpoint = (id: string) =>
  `/api/v1/creation-reviews/${encodeURIComponent(id)}`;

export function isExtracting(review: Review) {
  return (
    review.extraction.status === "queued" ||
    review.extraction.status === "running"
  );
}

export function reviewDates(facts: ReviewFacts) {
  const steps = checklistTemplate(
    facts.side ?? "buyer",
    facts.purchaseType ?? null,
  ).filter((step) => step.dateCapable);
  const inspection = steps.findIndex(({ key }) => key === "inspections");
  steps.splice(inspection + 1, 0, {
    key: remediesAnchorKey,
    title: "Remedies",
    notNeeded: false,
    dateCapable: true,
    scheduled: false,
  });
  return steps;
}

export function suggestFacts(
  facts: ReviewFacts,
  proposal: CreationProposal | null,
): ReviewFacts {
  return {
    ...(proposal?.propertyAddress
      ? { propertyAddress: proposal.propertyAddress.value }
      : {}),
    ...(proposal?.purchasePriceCents
      ? { purchasePriceCents: proposal.purchasePriceCents.value }
      : {}),
    ...(proposal?.acceptance ? { acceptance: proposal.acceptance.value } : {}),
    ...facts,
  };
}

export function suggestPeople(
  people: CreationPerson[],
  side: ReviewFacts["side"],
  proposal: CreationProposal | null,
) {
  if (!proposal) return people;
  const next = [...people];
  const clientRoles = new Set([
    "client",
    side === "seller" ? "seller" : "buyer",
  ]);
  const clients = next.flatMap((person, index) =>
    clientRoles.has(person.role) ? [{ person, index }] : [],
  );
  const names = side === "seller" ? proposal.sellers : proposal.buyers;
  const normalized = (name: string) =>
    name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  const proposed = new Map(
    names.map(({ value }) => [normalized(value), value]),
  );
  const existingNames = clients
    .map(({ person }) => normalized(person.name))
    .filter(Boolean);
  if (!next.some(({ role }) => ["client", "buyer", "seller"].includes(role))) {
    for (const name of proposed.values())
      next.push({ role: "client", name, email: "", phone: "" });
  } else {
    const unnamed = clients.filter(({ person }) => !normalized(person.name));
    const unmatched = [...proposed].filter(
      ([key]) => !existingNames.includes(key),
    );
    // A single remaining same-side name can fill a single unnamed row once
    // every named intake client also matches the contract.
    if (
      unnamed.length === 1 &&
      unmatched.length === 1 &&
      existingNames.every((name) => proposed.has(name))
    ) {
      const { person, index } = unnamed[0];
      next[index] = { ...person, name: unmatched[0][1] };
    }
  }
  const company = proposal.titleCompany?.value;
  if (company) {
    const titleIndex = next.findIndex(({ role }) =>
      ["title_rep", "title_company", "title"].includes(role),
    );
    if (titleIndex === -1)
      next.push({
        role: "title_rep",
        name: company,
        company,
        email: "",
        phone: "",
      });
    else if (!next[titleIndex].company)
      next[titleIndex] = { ...next[titleIndex], company };
  }
  return next;
}

export function assembleDates(
  facts: ReviewFacts,
  dates: ChecklistDateInput[],
  proposal: CreationProposal | null,
) {
  return reviewDates(facts).flatMap(({ key }) => {
    const saved = dates.find((item) => item.key === key);
    if (saved) return [saved];
    const suggested = proposal?.dates.find((item) => item.key === key);
    if (suggested)
      return [{ key, value: suggested.date, rule: suggested.rule }];
    const fallback = checklistWorkflowDefault(facts.side ?? "buyer", key);
    return fallback ? [{ key, value: null, rule: fallback.rule }] : [];
  });
}

export function previewDates(facts: ReviewFacts, dates: ChecklistDateInput[]) {
  try {
    const result = buildChecklistSeed({
      side: facts.side ?? "buyer",
      purchaseType: facts.purchaseType ?? null,
      acceptance: facts.acceptance ?? null,
      timeZone: facts.deadlineTimeZone ?? null,
      dates,
    });
    return new Map(
      [...result.steps, ...result.hiddenAnchors].map((item) => [
        item.key,
        item.due,
      ]),
    );
  } catch {
    return new Map<string, never>();
  }
}

export function requestKey(scope: string) {
  const key = `weatherly.creation.${scope}`;
  const stored = window.sessionStorage.getItem(key);
  if (stored) return stored;
  const requestId = crypto.randomUUID();
  window.sessionStorage.setItem(key, requestId);
  return requestId;
}

export function forgetRequestKey(scope: string) {
  window.sessionStorage.removeItem(`weatherly.creation.${scope}`);
}
