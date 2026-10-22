import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";

export const checkoutRoot = fileURLToPath(new URL("../../../../", import.meta.url));
export const syntheticMcpEvidence = "Independent synthetic checklist protocol review only; no real external deployment, account or AI service approval is asserted.";
const execute = promisify(execFile);
async function unusedPort() {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const value = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve()));
  return value;
}
export type ReviewEnvironment = {
  database: pg.Client;
  api: string;
  web: string;
  logs: () => string;
  env: NodeJS.ProcessEnv;
  candidate: string;
};

export async function isolatedReview(
  inspect: (review: ReviewEnvironment) => Promise<void>,
  { web = false, mcp = false }: { web?: boolean; mcp?: boolean } = {},
) {
  const source = new URL(process.env.CHECKER_DATABASE_URL || "postgresql://weatherly:weatherly_local@127.0.0.1:55432/weatherly");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(source.hostname) || process.env.NODE_ENV === "production")
    throw new Error("Independent review refuses a non-local database or production environment.");
  const name = `checker_checklist_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client({ connectionString: source.href });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  source.pathname = "/" + name;
  const temporary = await mkdtemp(path.join(os.tmpdir(), "weatherly-checklist-review-"));
  const apiPort = await unusedPort(), webPort = await unusedPort();
  const api = `http://127.0.0.1:${apiPort}`, origin = `http://127.0.0.1:${webPort}`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: source.href,
    APP_ENV: "local", NEXT_PUBLIC_APP_ENV: "local", NODE_ENV: "development",
    PORT: String(apiPort), WEB_ORIGIN: origin, BETTER_AUTH_URL: origin,
    API_INTERNAL_URL: api, PUBLIC_SITE_URL: origin,
    BETTER_AUTH_SECRET: randomBytes(40).toString("base64url"),
    CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    OBJECT_STORAGE_DIR: path.join(temporary, "objects"),
    S3_BUCKET: "", STRIPE_SECRET_KEY: "", STRIPE_WEBHOOK_SECRET: "",
    OPENROUTER_API_KEY: "", GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "",
    DOTLOOP_CLIENT_ID: "", DOTLOOP_CLIENT_SECRET: "", RESEND_API_KEY: "",
    SYSTEM_EMAIL_FROM: "", NEXT_TELEMETRY_DISABLED: "1",
    MCP_ENABLED: mcp ? "true" : "false",
    MCP_APPROVED_CLIENTS_JSON: mcp ? JSON.stringify([{ id: "checker-checklist-protocol", redirectUris: [origin + "/synthetic-callback"], evidenceHash: createHash("sha256").update(syntheticMcpEvidence).digest("hex") }]) : "[]",
  };
  const db = new pg.Client({ connectionString: source.href });
  const children: ChildProcess[] = [];
  let output = "";
  function launch(args: string[], cwd = checkoutRoot) {
    const child = spawn(process.execPath, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    children.push(child);
    child.stdout?.on("data", (data) => { output = (output + data).slice(-100000); });
    child.stderr?.on("data", (data) => { output = (output + data).slice(-100000); });
    return child;
  }
  async function ready(url: string, child: ChildProcess) {
    for (let attempt = 0; attempt < 160; attempt++) {
      try { if ((await fetch(url)).ok) return; } catch {}
      if (child.exitCode !== null) throw new Error(`Review server exited before readiness (${child.exitCode}). ${output.slice(-2000)}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("Review server readiness timed out. " + output.slice(-2000));
  }
  try {
    await execute(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { cwd: checkoutRoot, env, maxBuffer: 1024 * 1024 });
    await execute(process.execPath, ["--import", "tsx", "packages/db/src/seed.ts"], { cwd: checkoutRoot, env, maxBuffer: 1024 * 1024 });
    await db.connect();
    const server = launch(["--import", "tsx", "apps/api/src/main.ts"]);
    await ready(api + "/health", server);
    if (web) {
      const next = launch([path.join(checkoutRoot, "node_modules/next/dist/bin/next"), "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(webPort)], path.join(checkoutRoot, "apps/web"));
      await ready(origin + "/health", next);
    }
    const candidate = (await execute("git", ["rev-parse", "HEAD"], { cwd: checkoutRoot })).stdout.trim();
    await inspect({ database: db, api, web: origin, logs: () => output, env, candidate });
  } finally {
    for (const child of children) child.kill("SIGTERM");
    for (const child of children) {
      await Promise.race([
        new Promise((resolve) => child.exitCode !== null ? resolve(undefined) : child.once("exit", resolve)),
        new Promise((resolve) => setTimeout(() => { child.kill("SIGKILL"); resolve(undefined); }, 3000)),
      ]);
    }
    await db.end().catch(() => {});
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
    await rm(temporary, { recursive: true, force: true });
  }
}
