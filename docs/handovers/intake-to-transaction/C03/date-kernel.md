# C03 checklist and date kernel

The kernel uses the C00 checklist contracts and runs without Prisma or provider access. Review this milestone before wiring the new checklist version to persistence and the coordinator UI.

| Module | Boundary |
| --- | --- |
| `checklist/templates.ts` | Official buyer and seller steps, stable extraction keys, cash titles and financing exclusions, date capability, scheduled appointment markers, and labeled workflow default proposals |
| `checklist/seed.ts` | Build the ordered checklist from the coordinator's confirmation and resolve its reviewed rules. Return Remedies separately as a calculation anchor. |
| `date-graph/calendar.ts` | Civil days, explicit working calendars and rollover, elapsed hours, exact local clock handling |
| `date-graph/resolve.ts` | Resolve dependent dates, detect invalid references and cycles, preserve completed and skipped values |
| `date-graph/preview.ts` | Bind preview to the matter, revision and change. Recompute on apply and pin moved downstream values when the coordinator chooses Only this date. |

## Implementation choices for Ireland to review

- The supplied same-day Remedies and seller Title Commitment defaults are labeled proposals. The confirmation seed uses the selected rule or fixed signed value. A blank confirmed input stays blank.
- Extend adds a calendar-day or elapsed-hour adjustment to the resolved date. A relative rule retains that adjustment when an anchor moves later. A fixed date remains fixed. Persist the extension command and before and after dates in the audit record during API integration.
- An elapsed-hour rule needs a known exact anchor and timezone. Calendar-day rules produce civil dates. A calendar-day extension of an exact deadline preserves its local clock when there is one matching instant. A daylight saving gap or fold requires a manual date. Working-hour rules and unspecified calendars remain unresolved.
- Completed and not-needed items retain their stored dates. An actual event can be entered on a completed item without changing its due date. A not-needed item cannot act as a date anchor.
- Without the actual HOA delivery date, an available acceptance-cap branch can resolve the review deadline. Once delivery is entered, the earlier available branch governs.

## Builder verification

The existing repository typecheck passed. All 19 focused kernel and template tests passed. They cover both official lists, signed-term precedence, negative and same-day rules, business calendars, HOA actual delivery, protected statuses, cycles, linked extensions, downstream pins, preview replay and daylight saving transitions.
