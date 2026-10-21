import { defineConfig } from "vitest/config";
import { config } from "dotenv";
config({ path: ".env.test", quiet: true });
const url = new URL(process.env.DATABASE_URL || "postgresql://invalid/invalid");
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
  !url.pathname.endsWith("_test")
) {
  throw new Error(
    "Tests require a disposable local DATABASE_URL whose database name ends in _test. Configure .env.test; never use the preview or production database.",
  );
}
export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "tests/**/*.test.ts"],
    testTimeout: 15000,
    env: { APP_ENV: "test" },
  },
});
