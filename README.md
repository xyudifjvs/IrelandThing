# IrelandThing

Weatherly Transaction Co. — the website and transaction-coordination system for Ireland's business.

## Project planning

- [Project scope](PROJECT_SCOPE.md): inspected mockups, full product requirements, conflicts, and owner decisions.
- [Technical plan](TECHNICAL_PLAN.md): persistent records, API/MCP, Gmail, Stripe, Dotloop, Railway, and OpenRouter ZDR.
- [Implementation plan](IMPLEMENTATION_PLAN.md): 14 exclusive builder packages, independent check-team assignments, dependencies, acceptance criteria, and GitHub workflow.
- [Planning review](docs/reviews/planning-review.md): independent review of the planning artifacts; not application test results.

The original HTML mockups and supplied JPEG assets are preserved in the repository root. The product application has not been implemented yet.

## Delivery model

Build and check teams use GPT-6.1 sol. Builders own separate code areas; reviewers independently validate the exact implementation commit and send defects back to its owner. Agent work uses separate branches/worktrees and is pushed at reviewable checkpoints.

All product AI must use OpenRouter with enforced zero data retention. Authorized matter records must be available through the shared API and MCP services. Production data and credentials belong in secured application storage, never in this repository.
