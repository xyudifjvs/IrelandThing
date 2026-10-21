import "./_review-safety.mjs";
import {
  checkoutRoot,
  checkerDatabaseUrl,
  apiBase,
  webBase,
} from "./_review-safety.mjs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile),
  cwd = checkoutRoot,
  require = createRequire(cwd + "/package.json"),
  { Client } = require("pg"),
  suffix = randomUUID().replaceAll("-", ""),
  name = "checker_bootstrap_" + suffix,
  raceName = name + "_race";
const base = new URL("./", checkerDatabaseUrl).href,
  admin = new Client({ connectionString: checkerDatabaseUrl });
await admin.connect();
const initialOwnerEmail = (
  process.env.CHECKER_OWNER_EMAIL || "carson@synthetic.invalid"
)
  .trim()
  .toLowerCase();
const env = {
  ...process.env,
  DATABASE_URL: base + name,
  BOOTSTRAP_OWNER_EMAIL: `  ${initialOwnerEmail.toUpperCase()}  `,
  BOOTSTRAP_OWNER_NAME: " Carson ",
  BOOTSTRAP_OWNER_PASSWORD: "Synthetic-Strong-" + randomUUID(),
  BOOTSTRAP_OWNER_CONFIRMED: ` ${initialOwnerEmail} `,
};
const checks = [];
const check = (name, pass) => checks.push({ name, pass });
async function run(extra = {}) {
  try {
    return {
      ok: true,
      ...(await exec(
        process.execPath,
        ["--import", "tsx", "packages/db/src/bootstrap.ts"],
        { cwd, env: { ...env, ...extra }, maxBuffer: 1024 * 1024 },
      )),
    };
  } catch (e) {
    return { ok: false, text: e.stderr + e.stdout };
  }
}
try {
  await admin.query('CREATE DATABASE "' + name + '"');
  await exec(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    { cwd, env, maxBuffer: 1024 * 1024 },
  );
  const placeholder = await run({
    BOOTSTRAP_OWNER_EMAIL: "ireland@ireland.com",
  });
  check(
    "Placeholder mailbox refused",
    !placeholder.ok && placeholder.text.includes("actual approved email"),
  );
  const legacyWrong = await run({ BOOTSTRAP_OWNER_CONFIRMED: "ireland" });
  check(
    "Named temporary owner cannot use legacy Ireland confirmation",
    !legacyWrong.ok && legacyWrong.text.includes("exact approved owner email"),
  );
  const wrongEmail = await run({
    BOOTSTRAP_OWNER_CONFIRMED: "other@synthetic.invalid",
  });
  check(
    "Named owner rejects mismatched email confirmation",
    !wrongEmail.ok && wrongEmail.text.includes("exact approved owner email"),
  );
  const blankName = await run({ BOOTSTRAP_OWNER_NAME: "   " });
  check("Explicit blank owner name rejected", !blankName.ok);
  const weak = await run({ BOOTSTRAP_OWNER_PASSWORD: "too-short" });
  check("Short password refused", !weak.ok);
  const unconfirmed = await run({ BOOTSTRAP_OWNER_CONFIRMED: "" });
  check(
    "Explicit owner confirmation required",
    !unconfirmed.ok && unconfirmed.text.includes("Confirm"),
  );
  const db = new Client({ connectionString: env.DATABASE_URL });
  await db.connect();
  check(
    "Invalid bootstrap attempts created no user",
    (await db.query('SELECT count(*)::int n FROM "User"')).rows[0].n === 0,
  );
  const created = await run();
  const ownerRows = (
    await db.query('SELECT id,name,email,role,"twoFactorEnabled" FROM "User"')
  ).rows;
  check(
    "Explicit normalized Carson name/email confirmation creates one owner",
    created.ok &&
      ownerRows.length === 1 &&
      ownerRows[0].name === "Carson" &&
      ownerRows[0].email === initialOwnerEmail &&
      ownerRows[0].role === "coordinator",
  );
  check(
    "New owner still requires authenticator enrollment",
    ownerRows[0]?.twoFactorEnabled === false,
  );
  await admin.query('CREATE DATABASE "' + raceName + '"');
  await exec(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    {
      cwd,
      env: { ...env, DATABASE_URL: base + raceName },
      maxBuffer: 1024 * 1024,
    },
  );
  const concurrent = await Promise.all([
    run({ DATABASE_URL: base + raceName }),
    run({
      DATABASE_URL: base + raceName,
      BOOTSTRAP_OWNER_EMAIL: "other@synthetic.invalid",
      BOOTSTRAP_OWNER_NAME: "Independent Other",
      BOOTSTRAP_OWNER_CONFIRMED: "other@synthetic.invalid",
    }),
  ]);
  const raceDb = new Client({ connectionString: base + raceName });
  await raceDb.connect();
  check(
    "Concurrent distinct valid owners create exactly one coordinator",
    concurrent.filter((r) => r.ok).length === 1 &&
      (
        await raceDb.query('SELECT count(*)::int n FROM "User" WHERE role=$1', [
          "coordinator",
        ])
      ).rows[0].n === 1,
  );
  await raceDb.end();
  const catalog = (
    await db.query(
      'SELECT "priceCents",approved FROM "CatalogItem" ORDER BY "priceCents"',
    )
  ).rows;
  check(
    "Bootstrap installs approved375/475/625 catalog",
    JSON.stringify(catalog.map((x) => x.priceCents)) ===
      "[37500,47500,62500]" && catalog.every((x) => x.approved),
  );
  const accounts = (await db.query('SELECT password FROM "Account"')).rows;
  check(
    "Bootstrap stores one hashed credential",
    accounts.length === 1 &&
      accounts[0].password !== env.BOOTSTRAP_OWNER_PASSWORD &&
      accounts[0].password.length > 32,
  );
  const credentialBefore = accounts[0]?.password;
  const repeat = await run();
  check(
    "Existing coordinator bootstrap refused without mutation",
    !repeat.ok &&
      repeat.text.includes("already exists") &&
      (await db.query('SELECT count(*)::int n FROM "User"')).rows[0].n === 1,
  );
  check(
    "Rejected repeat preserves original name and credential",
    (await db.query('SELECT name FROM "User"')).rows[0].name === "Carson" &&
      (await db.query('SELECT password FROM "Account"')).rows[0].password ===
        credentialBefore,
  );
  await db.end();
  console.log(
    JSON.stringify(
      {
        candidate: "ed5b4aa",
        checks: checks.length,
        failed: checks.filter((x) => !x.pass).length,
        results: checks,
      },
      null,
      2,
    ),
  );
} finally {
  await admin.query('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)');
  await admin.query('DROP DATABASE IF EXISTS "' + raceName + '" WITH (FORCE)');
  await admin.end();
}
