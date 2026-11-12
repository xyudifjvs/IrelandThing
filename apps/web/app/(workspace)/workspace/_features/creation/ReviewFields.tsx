"use client";

import type {
  ChecklistDateInput,
  TransactionBusiness,
} from "@weatherly/platform/handoff-contracts";
import UserPicker from "../../_components/UserPicker";
import { previewDates, reviewDates, type ReviewFacts } from "./review-model";
import s from "./creation.module.css";

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
          <UserPicker
            label="Assigned agent (optional)"
            role="agent"
            required={false}
            value={facts.agentId ?? ""}
            onChange={(agentId) =>
              onFacts({ agentId: agentId || null, agentRosterId: null })
            }
          />
        </div>
      </section>
      <section className={s.section} aria-labelledby="creation-dates">
        <h2 id="creation-dates">Checklist dates</h2>
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
                        key,
                        value: value ? { date: value, instant: null } : null,
                        rule: value ? { kind: "fixed" } : null,
                        notNeeded: item?.notNeeded,
                      });
                    }}
                  />
                </label>
                <div className={s.dateControls}>
                  {linked && <small>Linked date</small>}
                  <label>
                    <input
                      type="checkbox"
                      checked={item?.notNeeded ?? notNeeded}
                      onChange={(event) =>
                        onDate({
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
