import { fileURLToPath } from "node:url";
export const checkoutRoot = fileURLToPath(
  new URL("../../../../", import.meta.url),
);
export const checkerDatabaseUrl =
  process.env.CHECKER_DATABASE_URL || process.env.DATABASE_URL;
if (!checkerDatabaseUrl)
  throw new Error(
    "Set CHECKER_DATABASE_URL to an isolated local review/test database before running a mutating probe.",
  );
const database = new URL(checkerDatabaseUrl);
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(database.hostname) ||
  !/(?:_test$|^\/weatherly_independent_review$|^\/checker_)/.test(
    database.pathname,
  ) ||
  process.env.NODE_ENV === "production"
)
  throw new Error(
    "Review probes refuse production or non-local/non-review databases.",
  );
process.env.DATABASE_URL = checkerDatabaseUrl;
export const apiBase = process.env.CHECKER_API_URL || "http://127.0.0.1:4100";
export const webBase = process.env.CHECKER_WEB_URL || "http://127.0.0.1:3100";
for (const value of [apiBase, webBase])
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(value).hostname))
    throw new Error("Review HTTP probes refuse non-local servers.");
