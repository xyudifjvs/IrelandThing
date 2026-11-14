# People, documents, and sharing

## Composition

- Register `registerMatterPeopleRoutes` in the authenticated Matter router. Its create, patch, and retire paths are coordinator-only. They preserve the directory and prior file snapshots, and serialize on the Matter row.
- Pass `seedMatterPeople` as C05's `seedPeople` callback. Intake people are shown to agents by default. Buyer clients see their own agent, title rep, and lender. Seller clients see their own agent and title rep. People added after confirmation start hidden on both portals.
- Pass the existing private object store's `get` method to `createPublicChecklistRouter` as the document reader. Keep the existing outer authorization headers and rate limits. The bearer endpoints are `/api/public/checklist/documents/:documentId/view` and `.../download`. Pass the token through the Authorization header. Storage keys stay inside the API.
- Compose `queueFileDocumentCleanup(tx, matterId)` and `queueIntakeDocumentCleanup(tx, source)` into C05 deletion effects. Register `documentCleanupTopic` with `payload => removeDeletedDocumentBlob(store, payload)` in the worker. Cleanup jobs commit with the row deletions and skip a key still referenced by a document version.
- Use `FileDocumentsPanel` with the existing transaction upload queue. A coordinator can flip each switch independently, and an authorized agent can upload a separate document on an active file. Closed files expose `/api/v1/documents/archive/:matterId` for the actor's accessible documents. An agreement's primary and supporting documents remain private and immutable once linked.
- The creation form sends multipart `creationReviewId`, `category=contract`, `file`, and `uploadRequestId` to `POST /api/v1/documents`. View an exact pinned version through `GET /api/v1/documents/:id/view?versionId=...`. Version a staged file only in its open owning review. For a receipt document that needs replacement, upload a new staged file and select it without editing the receipt.

## Portal behavior

- Canonical portal timelines use keyed checklist tasks, ordered as saved. Agent projections include checked items, Not needed items, and the step notes with Show to agent selected. Client projections omit notes and Not needed items. Closing and Final Walkthrough can include the scheduled appointment.
- Canonical client team and document projections use explicit shared flags. Current authenticated and bearer clients see the same approved records. Authorized agents copy the current token via `POST /api/v1/matters/:id/checklist-share/copy`. A coordinator alone rotates and revokes. The current link generation pins the encrypted token, and old hash-only links can be replaced to enable copying.
- Historical null document flags use the existing visibility mapping. Explicit client-only rows keep coordinator legacy visibility for rollback safety. Historical hash-only public links retain their existing checklist scope. Client step notes are excluded on both canonical and historical links.
- The current agent copy and historical issuer check use C08's `hasAgentAgreementAccess`. A current HTO member can copy a coordinator-issued link without a Weatherly agreement. Reuse C06's document audience predicate in C05 agent receipt reads after integration.
