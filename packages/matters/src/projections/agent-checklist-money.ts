import { checklistMoney } from "../checklist/display";
import { clientStepKey } from "./client-timeline-layout";

/** Share only the requested money line, never the task's private details. */
export function agentChecklistMoney(task: {
  title: string;
  stepKey?: string | null;
  details?: unknown;
}) {
  const key = clientStepKey(task);
  const emd = key === "earnest_money_due";
  if (!emd && key !== "home_warranty" && key !== "home_warranty_ordered")
    return {};
  const data =
    task.details &&
    typeof task.details === "object" &&
    !Array.isArray(task.details)
      ? (task.details as Record<string, unknown>)
      : {};
  const amount = checklistMoney(
    Object.hasOwn(data, "amountCents")
      ? data.amountCents
      : emd
        ? data.earnestMoneyCents
        : data.homeWarrantyCents,
  );
  const savedCompany = emd
    ? (data.holder ?? data.earnestMoneyHolder)
    : (data.company ?? data.homeWarrantyCompany);
  const company = typeof savedCompany === "string" ? savedCompany.trim() : "";
  const moneyLine =
    amount && company
      ? `${amount} ${emd ? "to" : "with"} ${company}`
      : amount || company;
  return moneyLine ? { moneyLine } : {};
}
