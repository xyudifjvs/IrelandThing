# Canonical file facts

C00 injects `updateFileFacts` from `packages/matters/src/commands/file-facts.ts` into the C11 linked-row service. It accepts `(tx, actor, matterId, input)` and returns `{ matterId, revision }`. The caller supplies its open transaction and the current Matter revision. The command checks coordinator access, locks the Matter, and rejects a stale revision before updating any contacts.

| Input | Effect |
| --- | --- |
| `expectedRevision` | Required current Matter revision. |
| `agentRosterId` | Assigns the active roster ID and its linked agent login, if any. Null clears the assignment. |
| `propertyAddress`, `address` | Updates the canonical address. A supplied structured address can set the display address when the caller omits it. Null clears the structure. Editing the display address alone drops its prior structure. |
| `clients` | The complete active client list. Entries with a canonical ID retain their audience flags and directory provenance. New entries are private. Omitted clients are retired with their history retained. |
| `side` | Corrects the represented side on the Matter. |
| `purchasePriceCents` | Updates exact safe-integer cents. Null clears the price. A change records the previous and current cents on `matter.facts_updated`. |

The command writes the structured address to `Matter.details.structuredAddress` and first and last names to `Matter.details.structuredClientNames` keyed by canonical contact ID. It preserves the intake receipt, the file's lifecycle, and any checklist or legacy date records. C06 must omit the structured client map from agent projections before C00 activates linked edits.

HTO Operations can correct these facts for published closed and terminated HTO files. The ordinary file UI and generic Matter PATCH retain their read-only terminal behavior. C03 supplies the linked close-date command separately. C00 keeps this command on the linked HTO edit path and uses the existing transactional Matter change effects.

**Confirm with Ireland during the integration handoff.** Correcting the side on an existing published file preserves its seeded checklist, completion history, and date rules. The side chosen at creation still determines the initial checklist.
