"use client";

import type {
  ChecklistDateInput,
  TransactionBusiness,
} from "@weatherly/platform/handoff-contracts";
import { ReviewAgentPicker } from "./ReviewAgentPicker";
import { previewDates, reviewDates, type ReviewFacts } from "./review-model";
import s from "./creation.module.css";
import { checklistDateLabel } from "../../../../../../../packages/matters/src/checklist/display";

export function ReviewFields({
  facts,
  business,
  price,
  dates,
  onFacts,
  onBusiness,
  onPrice,
  onDate,
}: {
  facts: ReviewFacts;
  business?: TransactionBusiness;
  price: string;
  dates: ChecklistDateInput[];
  onFacts: (edit: ReviewFacts) => void;
  onBusiness: (choice: TransactionBusiness | undefined) => void;
  onPrice: (price: string) => void;
  onDate: (item: ChecklistDateInput) => void;
}) {
  const displayDates = previewDates(facts, dates);
  return (
    <>
      <section className={s.section} aria-labelledby="creation-details">
        <h2 id="creation-details">Transaction details</h2>
        <div className={s.grid}>
          <label>
            Business
            <select
              required
              value={business?.business ?? ""}
              onChange={(event) =>
                onBusiness(
                  event.target.value === "hto"
                    ? { business: "hto", packageCode: "hto_included" }
                    : event.target.value === "weatherly"
                      ? { business: "weatherly", packageCode: "essentials" }
                      : undefined,
                )
              }
            >
              <option value="">Select a business</option>
              <option value="hto">Home Team Ohio</option>
              <option value="weatherly">Weatherly Transaction Co.</option>
            </select>
          </label>
          {business?.business === "weatherly" && (
            <label>
              Service
              <select
                value={business.packageCode}
                onChange={(event) =>
                  onBusiness({
                    business: "weatherly",
                    packageCode:
                      event.target.value === "complete"
                        ? "complete"
                        : "essentials",
                  })
                }
              >
                <option value="essentials">Contract to Close</option>
                <option value="complete">Contract to Close + Compliance</option>
              </select>
            </label>
          )}
          <label className={s.fullWidth}>
            Property address
            <input
              required
              value={facts.propertyAddress ?? ""}
              maxLength={500}
              onChange={(event) =>
                onFacts({ propertyAddress: event.target.value })
              }
            />
          </label>
          <label>
            Representing
            <select
              value={facts.side ?? "buyer"}
              onChange={(event) =>
                onFacts({
                  side: event.target.value === "seller" ? "seller" : "buyer",
                })
              }
            >
              <option value="buyer">Buyer</option>
              <option value="seller">Seller</option>
            </select>
          </label>
          <label>
            Purchase type
            <select
              value={facts.purchaseType ?? ""}
              onChange={(event) =>
                onFacts({
                  purchaseType:
                    event.target.value === "cash"
                      ? "cash"
                      : event.target.value === "financed"
                        ? "financed"
                        : null,
                })
              }
            >
              <option value="">Select a purchase type</option>
              <option value="cash">Cash</option>
              <option value="financed">Financed</option>
            </select>
          </label>
          <label>
            Purchase price ($)
            <input
              inputMode="decimal"
              value={price}
              onChange={(event) => onPrice(event.target.value)}
            />
          </label>
          <ReviewAgentPicker
            agentId={facts.agentId}
            agentRosterId={facts.agentRosterId}
            onChange={onFacts}
          />
          <label>
            Earnest money amount ($)
            <input
              type="number"
              min="0"
              max="100000000"
              step="0.01"
              value={
                facts.earnestMoneyCents == null
                  ? ""
                  : facts.earnestMoneyCents / 100
              }
              onChange={(event) =>
                onFacts({
                  earnestMoneyCents:
                    event.target.value === ""
                      ? null
                      : Math.round(Number(event.target.value) * 100),
                })
              }
            />
          </label>
          <label>
            Earnest money held by
            <input
              maxLength={300}
              value={facts.earnestMoneyHolder ?? ""}
              onChange={(event) =>
                onFacts({ earnestMoneyHolder: event.target.value })
              }
            />
          </label>
          <label>
            Home warranty amount ($)
            <input
              type="number"
              min="0"
              max="100000000"
              step="0.01"
              value={
                facts.homeWarrantyCents == null
                  ? ""
                  : facts.homeWarrantyCents / 100
              }
              onChange={(event) =>
                onFacts({
                  homeWarrantyCents:
                    event.target.value === ""
                      ? null
                      : Math.round(Number(event.target.value) * 100),
                })
              }
            />
          </label>
          <label>
            Home warranty company
            <input
              maxLength={300}
              value={facts.homeWarrantyCompany ?? ""}
              onChange={(event) =>
                onFacts({ homeWarrantyCompany: event.target.value })
              }
            />
          </label>
        </div>
      </section>
      <section className={s.section} aria-labelledby="creation-dates">
        <h2 id="creation-dates">Checklist dates</h2>
        <p>
          Choose a date, enter display text, or use both. Agents and clients see
          the display text exactly as entered; the selected date powers
          reminders.
        </p>
        <div className={s.grid}>
          <label>
            Acceptance date
            <input
              type="date"
              value={facts.acceptance?.date ?? ""}
              onChange={(event) =>
                onFacts({
                  acceptance: event.target.value
                    ? { date: event.target.value, instant: null }
                    : null,
                })
              }
            />
          </label>
          <label>
            Deadline timezone
            <input
              value={facts.deadlineTimeZone ?? ""}
              placeholder="America/New_York"
              onChange={(event) =>
                onFacts({ deadlineTimeZone: event.target.value || null })
              }
            />
          </label>
          {reviewDates(facts).map(({ key, title, notNeeded }) => {
            const item = dates.find((entry) => entry.key === key);
            const displayed = displayDates.get(key) ?? item?.value;
            const linked = item?.rule && item.rule.kind !== "fixed";
            return (
              <div className={s.dateField} key={key}>
                <label>
                  {title}
                  <input
                    type="date"
                    value={displayed?.date ?? ""}
                    disabled={item?.notNeeded ?? notNeeded}
                    onChange={(event) => {
                      const value = event.target.value;
                      onDate({
                        ...item,
                        key,
                        value: value ? { date: value, instant: null } : null,
                        rule: value ? { kind: "fixed" } : null,
                        notNeeded: item?.notNeeded,
                      });
                    }}
                  />
                </label>
                <label>
                  Display text (optional)
                  <input
                    aria-label={`${title} display text`}
                    value={item?.dateWording ?? ""}
                    maxLength={300}
                    disabled={item?.notNeeded ?? notNeeded}
                    placeholder="e.g. Received, on or before 8/30/26"
                    onChange={(event) =>
                      onDate({
                        ...item,
                        key,
                        value: item?.value ?? null,
                        rule: item?.rule ?? null,
                        dateWording: event.target.value,
                      })
                    }
                  />
                </label>
                {!(item?.notNeeded ?? notNeeded) && (
                  <small>
                    Shown to agent and client:{" "}
                    {checklistDateLabel(
                      {
                        dueDate: displayed?.date,
                        dueAt: displayed?.instant,
                        dateRule: item?.rule,
                        details: { dateWording: item?.dateWording },
                      },
                      key,
                      facts.deadlineTimeZone || "America/New_York",
                    ) || "No date or display text yet"}
                  </small>
                )}
                <div className={s.dateControls}>
                  {linked && <small>Linked date</small>}
                  <label>
                    <input
                      type="checkbox"
                      checked={item?.notNeeded ?? notNeeded}
                      onChange={(event) =>
                        onDate({
                          ...item,
                          key,
                          value: item?.value ?? null,
                          rule: item?.rule ?? null,
                          notNeeded: event.target.checked,
                        })
                      }
                    />
                    Not needed
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
