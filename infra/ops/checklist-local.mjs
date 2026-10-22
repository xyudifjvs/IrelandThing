import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
await mkdir(path.join(root, ".local"), { recursive: true });
try {
  await writeFile(
    path.join(root, ".local/checklist-docker.env"),
    `CHECKLIST_AUTH_SECRET=${randomBytes(40).toString("base64url")}\nCHECKLIST_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}\n`,
    { flag: "wx", mode: 0o600 },
  );
  console.log("Created private local-only secrets in .local/checklist-docker.env.");
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  console.log("Preserved existing local-only secrets.");
}
console.log("See docs/runbooks/checklist-sharing.md for the isolated Docker commands.");
