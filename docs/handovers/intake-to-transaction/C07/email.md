# C07 email workspace handoff

C14 mounts `FileEmailWorkspace` with the canonical matter ID, side, package, contacts and direct-contact policy. The read-only view shows sent messages. Mount `ChecklistEmailPrompt` after a checklist item has been checked off. Send now opens the composer, Later adds work, and Skip leaves the checklist change in place. The composer always needs separate saved-draft review and explicit approval.

C12 consumes `listEmailWork` from `packages/communications/src/email-work.ts`. Use the same IDs in the file and Overview. Date-filtered work excludes undated Later. C00 injects `invalidateFileEmailWork` in close-out, termination and deletion, and `queueAgentInvitation` in identity routing. The existing communications job registry dispatches the invitation topic when the approved system mail configuration is present.

New attachments use the document upload receipt and remain private unless Ireland separately publishes them. A verified send to an external address records coordinator-owned address book history. Use the separate Add to deal action to include that address on a file. Template placeholders stay disabled for actual delivery until edited and reviewed.

Local builder checks used a disposable database, a mock Gmail transport and Chrome with intercepted API requests. All 30 communications tests, typecheck and a Webpack production build passed. Chrome checked recipient chips, explicit replacement, private upload and saved-draft payload, and the disabled send control while Gmail was unconfigured. Ireland verifies the real Gmail mailbox and system-mail connection on her laptop.
