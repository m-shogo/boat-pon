/**
 * audit-alternative-odds-coverage.ts — research-only fail-closed entrypoint
 *
 * Historical alternative-odds coverage counts are emitted only after verifying
 * that the exact forward BUY population is canonical settled trifecta data.
 * No DB writes, app_settings changes, production decisions, notifications,
 * external access, or betting are performed by this launcher.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";

function run(script: string, env = process.env): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env,
  });
  if (result.error) {
    console.error(`[alternative-odds-coverage] failed to start ${script}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

const preflight = run("scripts/audit-alternative-odds-coverage-preflight.ts");
if (preflight !== 0) {
  console.error("[alternative-odds-coverage] FAIL CLOSED: forward cohort preflight did not pass; coverage/readiness output was not generated");
  process.exit(preflight);
}

if (!existsSync(DB_PATH)) throw new Error("ALT_ODDS_COVERAGE_DB_MISSING");
const handoffDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "ALT_ODDS_COVERAGE_DB_HANDOFF_IDENTITY_INVALID",
);
const audit = run("scripts/audit-alternative-odds-coverage-internal.ts", {
  ...process.env,
  BOAT_PON_DB_PATH: handoffDbPath,
});
if (audit !== 0) {
  console.error("[alternative-odds-coverage] internal read-only audit failed after a successful cohort preflight");
  process.exit(audit);
}

console.log("[alternative-odds-coverage] PASS: cohort preflight passed before coverage audit generation");
