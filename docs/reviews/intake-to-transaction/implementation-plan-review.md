# Independent implementation-plan review

Date: November 11, 2026.

Artifact: `docs/plans/INTAKE_TO_TRANSACTION_IMPLEMENTATION.md`.

Reviewer: independent planning agent `/root/plan_scope_audit`; the coordinator authored and repaired the plan. This report records the independent agent's findings and final recheck. The reviewer did not implement application changes or edit the plan.

## Result

**Accepted as an implementation plan. No remaining blocking findings.** This accepts the plan's ownership, dependencies and requirement coverage. It does not certify unimplemented application behavior, account connections or deployment.

## Findings resolved

1. **P1 — Shared validation/projection ownership:** existing task/deadline field files contained both validation and role projections, assigned to different chunks. The plan now requires C00 to split these before transfer, assigns validation leaves to C03 and projection leaves to C06, and keeps original compatibility exports with C00.
2. **P2 — C05/C11 acceptance dependency:** file confirmation needed HTO sync while HTO depended on confirmation commands. The plan now names an independently reviewed C05-domain milestone using deterministic injected hooks; C15 owns final combined C05/C11 acceptance after real wiring.
3. **P2 — Matters-test ownership:** broad package ownership left shared tests ambiguous. Existing tests now have individual owners, new tests have exclusive feature folders, and C15 owns cross-feature acceptance.
4. **Retained account UI:** C13 now explicitly owns all account-group UI, including login, invitation, recovery and security screens.
5. **Final reviewer independence:** R15 must have authored none of C00–C14's integrated product changes.

## Recheck observations

- Large-file refactoring is an explicit prerequisite with move-only review and sequential ownership transfer.
- Schema and shared entry-point changes have exclusive owners.
- Contract design for canonical dates and recoverable client links precedes schema merge.
- Data preservation, private projections, file deletion/job cancellation, HTO fee/agreement exemptions and digest edge cases are covered.
- All real account-specific setup and provider verification remain on Ireland's laptop; local work uses synthetic data and provider doubles.
- The plan reserves unresolved business decisions/content under D1–D10 instead of silently choosing policies.

## Coordinator validation

A structural check confirmed 16 unique chunks, 16 distinct builder/reviewer pairs, clean Markdown whitespace and an acyclic acceptance dependency graph when C00's initial and final gates are represented separately. Application tests were not run because this change creates planning documents only.
