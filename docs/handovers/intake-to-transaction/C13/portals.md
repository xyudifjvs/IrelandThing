# Agent, client and account views

The agent's file picker and file detail share a frame. The file chooser includes Active, Closed and Terminated plus an address or client search. Pending receipts have an intake status and approved existing documents. The first confirmed active file opens by default. Timeline and Documents are keyboard-accessible tabs. Only an active authorized agent can upload, and closed files can download the approved ZIP. The existing linked replacement intake stays available on terminated files.

The authenticated client preview and the bearer route use the same renderer for published timeline steps, appointments, people and documents. Older approved deadlines fill gaps in a historical timeline. The bearer sends the fragment token only in Authorization and requests no cookies. Each document action asks the authorized backend for its bytes. The agent link panel requests the existing copy-only link and writes it directly to the clipboard.

Account retains transaction history, existing payment history and checkout continuation, agent phone and brokerage, optional two-step login, and password recovery. Password changes revoke other sessions. A separate upcoming payments section presents frozen obligations using scoped summaries from C09. It traverses empty intermediate result pages. Missing gift amounts and unverified payment dates stay blank. `tests/acceptance/account-history.test.ts` updates the C13 view loader and fixtures for the component split and adds a synthetic HTO gift-only obligation. Existing service and actor tests remain in that suite.

## Integration

C06 supplies authorized agent `clientNames`, `closedOn`, approved `people`, approved `documents`, and legacy bearer/client projection parity. Display surfaces accept omitted fields during rollout. Client-name search uses the names already published to that agent. The public document routes need the private object-store reader injected by C00.

C09 supplies `/api/v1/billing/account/file-summary?matterId=...` and `/api/v1/billing/account/obligations?limit=...&cursor=...`. A file summary has `matterId`, `propertyAddress`, `service` and `gift`. A fee has `name`, nullable `amountCents` and `currency`, `status` and nullable `paidAt`. Upcoming fees represented by an existing payment order remain in the actual payment history. A historical client sees only the people and documents approved by the current server response. C15 should test these composed boundaries and existing preview account availability.

## Local verification

The focused 34-test account and checklist suite, TypeScript and the production Next Webpack build passed. Desktop and 390-pixel Chrome checks used synthetic Better Auth cookies for Weatherly, HTO, buyer, seller and coordinator. They exercised agent upload, closed ZIP, link copying, account phone and password changes, buyer and seller step filtering, bearer download headers, and withdrawal of documents, share links and authenticated grants. The local browser fixture supplied the agreed C09 summary shape. The integrated C06 projection and C09 fee endpoints require the final C15 journey on the composed branch.

Ireland owns the final client wording and all real account connections and verification.

## Independent review corrections

Upcoming payments revalidates on focus and polls after the preceding scan finishes. Each scan has a deadline and reads all cursor pages before publishing. Lost access, failed reads and hidden pages clear the rendered obligations. When an issued order replaces an obligation, an open payment history refreshes.

A known appointment place accompanies the contract date and “Details to come” until a time is available. The client timeline and next-step summary apply the same rule to Closing and Final Walkthrough.

The corrected candidate passed 37 focused tests, TypeScript and a production Webpack build. A real-session Chrome probe with accepted C09 verified reassignment, failed refresh, polling recovery, no overlap across repeated focus events, and Checkout replacement in an already-open payment history. A separate coordinator and seller session verified the real appointment edit and both client views.
