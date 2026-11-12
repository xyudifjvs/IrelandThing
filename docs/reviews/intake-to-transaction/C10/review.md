# Independent review of private notes and to-dos

Candidate `112d7d06efc970ef6d790a74b9256710be4cb400` in `/private/tmp/weatherly-handoff-c10`.

**Changes requested.** The API checks passed. Two browser paths discard text the coordinator has typed.

## Findings

1. **P2. Preserve unsaved scratchpad text when leaving Notes after a save conflict.** `PrivateScratchpad.tsx` initializes the editor from the server at lines 10–18 and 146. The draft lives only in that editor instance. In Chrome, type a draft, receive a 409, click Calendar, and go Back. The textarea restores the server value and drops the conflict draft despite the earlier preservation message. Keep the unsaved draft and its base revision across workspace navigation in an owner-scoped store, or prevent navigation while that unresolved draft needs a decision. Retain revision checks when resuming a draft.
2. **P2. Preserve newer text typed while an Add request is pending.** `PrivateTodoPanel.tsx` clears the draft at line 79 after the POST resolves. The textarea at lines 86–93 stays editable. In Chrome, delay a POST, type a second draft into the textarea, then allow the first POST to succeed. The first item appears and the second draft disappears. Clear the field only if it still contains the submitted text, or disable editing while the Add request runs.
3. **P3. Link attached file addresses on the Notes page.** The implementation plan calls for links to active files. `PrivateTodoPanel.tsx` renders an attached address as text. Retain the General label and link an attached file from the full Notes view.

## Verification

- The repository's two focused tests passed on a freshly migrated synthetic database.
- An independent Express harness with synthetic principals and a separate disposable database passed 15 access denials with `Cache-Control: no-store`. It also passed cross-owner writes and cursors, file cursor scope, pagination, file-scoped clearing, concurrent initial scratchpad saves, and scratchpad isolation from the to-do response.
- A local production build succeeded with Webpack. The default Turbopack build could not resolve the linked Next dependency outside this worktree's root.
- Headless Chrome against the exact build verified immediate blur saving, serial persistence of an edit typed during a pending save, the two draft-loss cases, the agent workspace gate, and no horizontal overflow at 320, 390, 768, and 1280 pixels.
- C00 still owns the application mount and navigation. C12 and C14 own the overview and transaction-file placements.

Synthetic review harnesses are at `/private/tmp/weatherly-r10-http.mjs` and `/private/tmp/weatherly-r10-browser.mjs`.

## Recheck of f18b826

Candidate `f18b826a8ebbde4a364b8c7f82f0521c9901485d`. **Changes requested.** All three original findings are resolved. Chrome browser history can still expose the previous coordinator’s scratchpad after sign-out.

- **P2. Revalidate the Notes page when the browser restores it after an account transition.** The scratchpad loads the session on React mount in `PrivateScratchpad.tsx:73–79`. Chrome can restore the existing document and editor without mounting React again. In Chrome with back-forward cache enabled, the workspace sign-out control removed the synthetic HTTP-only session cookie and redirected to Login. Browser Back fired `pageshow` with `persisted: true` and displayed the prior coordinator’s unsaved scratchpad while signed out. Signing in as a different coordinator and traversing history back two entries also restored the first coordinator’s unsaved text with the second coordinator’s cookie active. Prevent display of stale private Notes content during restoration and establish the current session before showing private content.
- In a fresh local Webpack build, Chrome preserved a newer to-do draft during a pending Add and linked the active attached transaction. A 409 scratchpad conflict preserved both the unsaved text and error through Calendar and Back. Explicit discard reloaded the saved copy. With a queued save and an account switch, the old editor sent its original owner guard and received a 409 on both its pending write and its reload attempt. Reopening Notes showed the second coordinator’s own scratchpad.
- The independent synthetic Express and PostgreSQL harness rejected a prior owner’s guarded GET and PATCH under the second coordinator, even when the PATCH matched the second scratchpad’s revision. Both returned `409 SCRATCHPAD_OWNER_CHANGED` with `Cache-Control: no-store`. The harness verified both saved scratchpads were unchanged and passed the previous owner, role, cursor, clearing, and concurrent-save checks.

The sign-out and second-coordinator history repros are at `/private/tmp/weatherly-r10-recheck-history.mjs` and `/private/tmp/weatherly-r10-recheck-history-second.mjs`. Both use the local synthetic API at `/private/tmp/weatherly-r10-test-api.mjs`.

## Final recheck of 62d2d42

Candidate `62d2d42357dc23d51909874923445c10b8f1b731`. **Accepted for C10.** The Notes route sends `Cache-Control: private, no-store`. The browser history fix passed the independent Chrome recheck.

- With Chrome’s back-forward cache enabled, Sign out → Back showed the sign-in gate. Signing in as a second coordinator and going Back twice showed only that coordinator’s scratchpad and to-dos. In both paths, a lifecycle probe found that the first coordinator’s scratchpad, saved to-do, and unsaved to-do text were already absent from the DOM during `pagehide`.
- Chrome did not persist the document in those natural history runs. An independent Chrome check dispatched a persisted `pagehide` and `pageshow` pair with a cookie change between the events. Both private panels stayed absent during the events and a fresh authenticated document opened for the second coordinator.
- Calendar → Back within the same document retained the scratchpad’s unsaved text and conflict error. A cross-document return with the same signed-in account opened a fresh Notes document and loaded the saved content.
- The two focused tests passed after 19 migrations applied to a disposable synthetic PostgreSQL database. The browser checks used distinct synthetic accounts and a localhost-only API. C00 owns history restoration across the other workspace surfaces where C12 and C14 place private to-dos.

The final browser harnesses are at `/private/tmp/weatherly-r10-verify-history-fixed.mjs` and `/private/tmp/weatherly-r10-verify-persisted-handler.mjs`, with the account-scoped API fixture at `/private/tmp/weatherly-r10-test-api-scoped.mjs`.
