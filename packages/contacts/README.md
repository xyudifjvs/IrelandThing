# Private business contacts

The reusable directory is owned by the signed-in coordinator. Every service method requires the coordinator role and filters by `ownerId`; agents and clients cannot list, read, save or use directory records. Selecting a saved business contact does not create a user, grant matter access, invite anyone or send email. Clients are not imported from intake or automatically added to the directory.

The authenticated `/api/v1/contacts` API is mounted behind the existing exact-origin write boundary:

- `GET /` searches person, company, email and phone with `q`, optional `kind`, `favorites=true`, `sort=frequent|recent|name`, `limit` and `cursor`. Returns `{items, hasMore, nextCursor}`. No match is automatically chosen.
- `GET /:id` retrieves an owned saved contact.
- `POST /` explicitly saves `{kind, name, company?, email?, phone?, favorite?}`.
- `PATCH /:id` explicitly corrects fields and requires `expectedRevision`. Concurrent edits return 409 and preserve the editor's entries for review.
- `POST /:id/usage` explicitly records a successful selection, with `expectedRevision` and optional `matterId`. Usage does not change the facts revision. A stale selection returns 409.

Kinds are `agent`, `co_op_agent`, `title_company`, `title_rep`, `lender`, `loan_officer` and `other`. Multiple representatives at one company are separate records. Only an exact normalized identity collision returns `CONTACT_EXISTS`; there is no approximate-name merge, automatic update or automatic representative selection.

Transaction contacts are copied values in the existing matter record, with `directoryContactId`, `directoryRevision`, `snapshotAt` and actual name/company/email/phone/role. Reads never resolve the pointer back to the current directory. Directory corrections therefore leave old matters, submitted intake and sent-message snapshots unchanged. Manual changes to a previously selected transaction contact retain source provenance and mark the local snapshot modified. Nonblank contact-entry conflicts require an explicit replacement choice. New selections also compare saved intake title/lender/co-op controls, normalized transaction details, confirmed source facts and existing coordinator contacts. Disputed source values are displayed rather than silently replaced; empty controls are prefilled only where the sources agree. Explicit acceptance stores `reviewedSourceConflict`, a copied `priorSourceSnapshot` and the reason with the new contact. The existing `matter.updated` audit captures this details patch while original intake/source values remain intact. Multiple representatives remain separate contacts and do not automatically select a message recipient. “Save reusable contact” is optional and is unavailable for client roles.

The web picker is exported from `apps/web/app/(workspace)/workspace/_components/BusinessContactPicker.tsx`: `{kind?, query?, onSelect(contact)}`. The caller reviews conflicts and saves the transaction snapshot. Call the usage endpoint only after the transaction save succeeds. The standalone editor lives at `/workspace/contacts`.

`packages/contacts/test/directory.test.ts` exercises a fresh PostgreSQL database through independent Prisma sessions, same-company representatives, exact collision handling, revision conflicts, immutable historical transaction snapshots, role/owner boundaries, explicit usage/favorites and 401/403 HTTP denial. The HTTP router unit fixture uses explicit synthetic principals; it is separate from real-cookie acceptance against the app.

`packages/contacts/test/source-conflicts.test.ts` checks blank-form conflicts against saved title/lender/co-op sources, confirmed-fact disagreements, preservation of multiple representatives, original evidence immutability, exact legacy projections and safe non-overwriting prefill.
