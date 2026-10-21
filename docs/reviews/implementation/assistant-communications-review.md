# Independent assistant and communications review

Reviewed exact commits `a17e310` and `bfd1791` in isolated checkout `/Users/carson/.codex/worktrees/weatherly-review/IrelandThing`. Review date: 2026-10-20 America/New_York. Database: isolated synthetic `weatherly_independent_review`. API port4100; Next proxy port3100. No live Gmail, Stripe, OpenRouter or Dotloop operation occurred. The MCP approved deployment manifest was synthetic and admitted only the test client.

## Findings and dispositions

### Resolved P1: missing EmailThread revision migration

At `a17e310`, a migration-built database lacks `EmailThread.revision`. Actual MCP `get_matter` fails with INTERNAL_ERROR; a direct domain diagnostic identifies Prisma's missing-column failure. Read-only Prisma migration diff returns exactly `ALTER TABLE "EmailThread" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1`.

At `bfd1791`, committed migration `20261021022451_thread_association_revision` applies successfully. A subsequent read-only migration diff is empty. Actual MCP matter reads succeed. This finding is resolved.

### Open P1 at bfd1791: template refresh hook is not mounted

Neither `apps/api/src/main.ts` nor `apps/worker/src/main.ts` registers `registerMatterChangeHook`. Real HTTP reproduction creates a confirmed Closing date of2026-11-20, creates a template using `closingDate` and `deadline_closing`, renders and saves its draft, and PATCHes Closing to2026-11-27 successfully. The stored draft retains2026-11-20 in subject/body and revision1. Exporting the refresh function does not make application mutations invoke it.

Parent reports a pending API/worker integration fix. Recheck the exact subsequent commit with the actual HTTP probe and verify manual-edit preservation plus review state. Reproduction: `probes/weatherly-independent-merge.mjs`.

## Completed independent runtime checks

At `bfd1791`, actual OAuth/MCP HTTP checks pass **21/21** through the Next proxy:

- Deployment allowlist registration admits the configured synthetic deployment and denies an unapproved deployment.
- Discovery works through rewrites; authorization requires a real session; consent requires the same authorized session.
- Unregistered redirects are rejected; missing PKCE produces a safe error redirect to the registered callback; incorrect verifier is rejected; a correct verifier succeeds; the authorization code is single use.
- Actual MCP initialize, tools discovery and get_matter work against the durable domain records; write tools are unavailable.
- Unexpected Origin and invalid bearer are denied. Revoking the grant immediately denies subsequent bearer use.

At `bfd1791`, actual communications API plus direct synthetic fixture setup pass **15/15**:

- Client projections include only explicitly shared messages. Private sibling messages and the private thread title are absent for portal actors.
- Reassigning a thread clears its old sharing; the client loses the revoked old matter, and gains no message visibility on the new matter until explicit new review.
- A stale pre-rematch revision cannot restore sharing; a current explicit review can.
- Missing direct-contact policy denies client recipients. The copy-agent policy adds the assigned agent automatically. Unsaved external recipients and agent draft creation are denied.
- Unconfigured Gmail connect, sync and send all fail closed503. No send job is queued by these denied requests.

At `a17e310`, independent real PostgreSQL workflow checks pass both assertions: an offset rule produces the expected proposed date, and moving a confirmed authoritative anchor re-proposes the previously confirmed derived date instead of silently preserving stale rule-owned evidence.

## Remaining acceptance limits

These are bounded evidence, not a complete implementation or production approval. Supplemental MCP pagination, safe projections and durable access-receipt assertions are prepared but their latest execution was blocked by the local authentication rate limit429; no result is claimed for that extension yet. Full source-to-screen visual coverage, current browser interactions, recovery delivery/restore, worker crash/retry, live account settings, external provider behavior and infrastructure acceptance remain separate work. Generic consumer MCP clients remain inadmissible unless their downstream AI deployment independently satisfies the OpenRouter ZDR policy.

Probe scripts are retained as review evidence under `probes/`; they use only synthetic local accounts and database fixtures. They are not application tests or production certification. Some earlier probe output labels contain their original checkpoint; the exact executed revisions are recorded in this report and companion reports.
