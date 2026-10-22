import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";
const base = process.env.DATABASE_URL;
if (!base)
  throw new Error("DATABASE_URL is required for an isolated test database.");
const url = new URL(base);
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
  throw new Error("The isolated test runner refuses non-local database hosts.");
const name = `weatherly_suite_${randomUUID().replaceAll("-", "")}_test`;
const admin = new pg.Client({ connectionString: base });
await admin.connect();
await admin.query(`CREATE DATABASE "${name}"`);
url.pathname = "/" + name;
const env: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: url.href,
  APP_ENV: "test",
  NODE_ENV: "test",
};
async function run(args: string[]) {
  const child = spawn(process.execPath, args, { env, stdio: "inherit" });
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Isolated test subprocess exited ${code}.`)),
    );
  });
}
try {
  await run(["node_modules/prisma/build/index.js", "migrate", "deploy"]);
  await run([
    "node_modules/vitest/vitest.mjs",
    "run",
    ...process.argv.slice(2),
  ]);
} finally {
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.end();
}
