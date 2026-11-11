// Independent comparison against the Express registrations at baseline 2177674.
// Run with: node --import tsx docs/reviews/intake-to-transaction/C00/router-inventory-probe.mjs [candidate-root]
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const candidateRoot = path.resolve(process.argv[2] || process.cwd());
// Router construction needs a configured client but makes no database requests.
process.env.DATABASE_URL = "postgresql://synthetic:synthetic@127.0.0.1:1/route_inventory_test";
process.env.DOTENV_CONFIG_PATH = "/dev/null";
process.env.APP_ENV = "test";
process.env.NODE_ENV = "test";

const entry = pathToFileURL(path.join(candidateRoot, "packages/matters/src/index.ts"));
const candidate = await import(entry.href);
const baselineExports = [
  "addDeadline", "addNote", "addTask", "applyInitialWorkflow", "applyReviewedFacts",
  "approvedWorkflowTaskDates", "audit", "canonicalDeadlineLabel", "checklistPrivacyHeaders",
  "confirmFile", "createChecklistShare", "createMatter", "createMattersRouter",
  "createPublicChecklistRouter", "createWorkflowTemplate", "createWorkflowsRouter",
  "dateOnly", "defaultDefinition", "definitionSchema", "deleteDeadline", "deleteNote",
  "deleteTask", "fileReviewPending", "getChecklistShare", "getFileReview", "getMatter",
  "getPublicChecklist", "listMatters", "listWorkflowTemplates", "matterInput", "matterScope",
  "offsetDate", "recalculateWorkflow", "registerChecklistShareRoutes", "registerMatterChangeHook",
  "reorderTasks", "requireMatter", "revision", "revokeChecklistShare", "updateDeadline",
  "updateMatter", "updateNote", "updateTask", "updateWorkflowTemplate",
];
assert.deepEqual(Object.keys(candidate).sort(), baselineExports, "Public runtime exports changed");

function describe(router) {
  return router.stack.map(({ route, name }) => {
    if (!route) return `middleware ${name}`;
    assert.equal(route.stack.length, 1, `Handler count changed for ${route.path}`);
    return `${Object.keys(route.methods).sort().join(",")} ${route.path}`;
  });
}

assert.deepEqual(describe(candidate.createMattersRouter()), [
  "middleware checklistPrivacyHeaders",
  "get /:id/file-review",
  "post /:id/confirm-file",
  "get /:id/checklist-share",
  "post /:id/checklist-share",
  "delete /:id/checklist-share",
  "post /:id/tasks/reorder",
  "get /",
  "post /",
  "get /:id",
  "patch /:id",
  "post /:id/tasks",
  "patch /:id/tasks/:childId",
  "delete /:id/tasks/:childId",
  "post /:id/deadlines",
  "patch /:id/deadlines/:childId",
  "delete /:id/deadlines/:childId",
  "post /:id/notes",
  "patch /:id/notes/:childId",
  "delete /:id/notes/:childId",
  "post /:id/participants",
  "delete /:id/participants/:participantId",
  "get /:id/activity",
], "Matters router registration changed");
assert.deepEqual(describe(candidate.createPublicChecklistRouter()), [
  "middleware checklistPrivacyHeaders",
  "get /",
], "Public checklist router registration changed");
assert.deepEqual(describe(candidate.createWorkflowsRouter()), [
  "get /templates",
  "post /templates",
  "patch /templates/:id",
  "post /matters/:id/recalculate",
], "Workflows router registration changed");

console.log("Matched baseline: 44 runtime exports, 27 routes, and 2 privacy middleware registrations in order.");
