# Independent review of the checklist and linked-date engine

**Accepted locally at `f99f9f69b2e78ffd66a168d481b9df320cb6079e`.** The first review covered kernel `c06b7fdd7a456e70fae0181f40caf008ee0e8e1a` and candidate `16e93d7aecc0d85e0bbc7c3ae115e115db7c80e6` in `/private/tmp/weatherly-handoff-c03`. Both requested changes passed independent recheck.

## Findings

1. **P2. Provide a checklist control for amendments that change Remedies independently.** The coordinator panel exposes Acceptance and editors for visible keyed tasks. The Remedies request deadline is intentionally a calculation anchor outside the checklist rows. With a synthetic March 11 inspection and a Repairs Agreed On rule three days after Remedies, I sent a date preview for `{kind:"step",key:"remedies"}` and set it to March 13. The preview correctly moved Repairs Agreed On to March 16 and the API applied it. On the same file in Chromium, the checklist had its expected 16 rows and offered no control to edit the Remedies deadline. A signed amendment can change this deadline without moving inspections or fixing the downstream Repairs Agreed On date. Add a coordinator-only control, such as an action near inspections, that uses the existing preview/apply flow while keeping Remedies out of the checklist rows.
2. **P2. Validate appointment wall times before saving.** In Chromium with `America/New_York`, I opened Schedule on Home Inspections and entered March 14, 2027 at 2:30 a.m. The browser date constructor silently normalized that daylight-saving gap to 3:30 a.m. The server stored `2027-03-14T07:30:00.000Z`, and the step displayed 3:30 a.m. after the save. A repeated fall-back hour also resolves to an offset without asking. Validate the selected wall time before saving, using the same exact-time check already used for deadline editing. Keep the appointment independent of the contract deadline.

## Verification

- The isolated checklist test runner applied all 19 migrations and passed 38 tests across four files.
- An independent Express probe with a separate disposable PostgreSQL database used real routes, seeded synthetic actors, and ran competing initial seeds. One seed won and one received `CHECKLIST_ALREADY_EXISTS`. The preexisting task and deadline were unchanged. The buyer and seller templates had 16 and 13 keyed rows respectively, the cash seller financing row was not needed, and seller Title Commitment resolved from April 15 to March 31.
- Real routes denied unauthenticated and participant date writes, rejected a preview digest replayed on a second file and concurrent duplicate application, kept Only this date pins fixed on another anchor change, and denied mutations on a closed versioned file. A recorded HOA delivery changed its status and downstream due date while keeping the provision due date independent. A closing extension shifted its negative-offset walkthrough date and recorded the original and extended dates in audit history.
- Chromium exercised the reviewed Next.js production build against the synthetic routes. The checklist omitted the old unkeyed task and showed no date control for buyer Appraisal Completed. Closing preview displayed the negative-offset walkthrough move, and applying Only this date kept its stored value. No browser errors or horizontal overflow occurred at 320, 390, 768, or 1280 pixels.
- C06 remains a release dependency. The isolated candidate's existing agent and authenticated-client detail projections returned a private versioned step note. C06 must enforce note visibility and return only the intended keyed timeline for a versioned file before C05 enables production creation.

The independent probe is at `/private/tmp/weatherly-r03-probe.mjs` on the review machine. It used only synthetic data and loopback services.

## Recheck at f99f9f6

- In Chromium, Edit Remedies request deadline opened the existing March 13 value. Changing it to March 17 previewed Repairs Agreed On moving from March 16 to March 20. Apply persisted the fixed Remedies date, left inspections at March 11, and retained 16 checklist rows. Reopening the editor showed March 17. Closing the file removed the edit control.
- In New York browser time, March 14, 2027 at 2:30 a.m. produced a validation message and made no write. November 7 at 1:45 a.m. presented both UTC instants and made no write until I chose the first occurrence. It stored `2027-11-07T05:45:00.000Z`, displayed 1:45 a.m. EDT, and retained the same instant after changing just the place. The inspection deadline stayed March 11 throughout.
- TypeScript and all 41 checklist tests passed after applying all 19 migrations to a fresh disposable database. The independent HTTP probe repeated the legacy preservation, permissions, race, and date propagation checks. The built web app fit 320, 390, 768, and 1280 pixel viewports without browser errors.
- C06 still gates release. The isolated candidate retains the existing audience projections. C06 must preserve the coordinator's access to the hidden Remedies anchor, strip it from agent and client data, and enforce private step notes before new versioned files are exposed.

The independent recheck probe is at `/private/tmp/weatherly-r03-recheck-probe.mjs` on the review machine.
