# Private notes and to-dos

The Notes page and reusable note list live under `workspace/notes` and `_features/private-notes`. `PrivateTodoPanel` takes an optional `matterId` for the file side panel or `overview` for the five-item overview. C14 and C12 own those composition points. C00 mounts `createPrivateNotesRouter` at `/api/v1/private-notes` and coordinates navigation once the route is available.

The API verifies coordinator role and note ownership. One record drives all three views. Completed items stay visible and Clear completed respects the selected scope. Scratchpad saves serialize edits and reject stale revisions. Conflicts preserve the typed draft until Ireland chooses to discard it. The scratchpad is separate from the to-do list.

TypeScript and the focused synthetic database tests passed. The tests exercise file and general items, ownership, stale mutations, scoped clearing, concurrent scratchpad saves and agent/client denials. Final composition and browser acceptance remain separate checks.
