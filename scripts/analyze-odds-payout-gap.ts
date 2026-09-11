/**
 * odds-payout-gap fail-closed entrypoint implementation.
 * Runs official trifecta settlement completeness validation before the legacy
 * odds-vs-payout analysis. No DB writes, app_settings changes, production
 * decisions, notifications, or betting.
 */

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

function run(script: string): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    console.error(`[odds-payout-gap-safe-runner] failed to start ${script}: ${result.error.message}`);
    return 1;
  }

  return result.status ?? 1;
}

const preflight = run("scripts/audit-odds-payout-gap-completeness.ts");
if (preflight !== 0) {
  console.error("[odds-payout-gap-safe-runner] FAIL CLOSED: payout completeness preflight did not pass; payout ROI/verdict analysis was not generated");
  process.exit(preflight);
}

const configuredDbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
if (!existsSync(configuredDbPath)) throw new Error("ODDS_PAYOUT_GAP_DB_MISSING");
process.env.BOAT_PON_DB_PATH = assertCanonicalSingleLinkRegularFile(
  configuredDbPath,
  "ODDS_PAYOUT_GAP_DB_IDENTITY_INVALID",
);

await import("./analyze-odds-payout-gap-internal");

console.log("[odds-payout-gap-safe-runner] PASS: completeness preflight passed before odds-payout-gap analysis");
