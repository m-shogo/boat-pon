/**
 * report-paper-forward-candidates-raw.ts — guarded research-only compatibility entrypoint
 *
 * Historical paper-forward aggregation must not be reachable without the canonical
 * official-settlement completeness preflight. This file intentionally contains no
 * aggregation logic; it only enforces the guard before delegating to the internal
 * read-only implementation.
 */

import { spawnSync } from "node:child_process";

function run(script: string): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    console.error(`[paper-forward-raw] failed to start ${script}: ${result.error.message}`);
    return 1;
  }

  return result.status ?? 1;
}

const preflight = run("scripts/audit-odds-payout-gap-completeness.ts");
if (preflight !== 0) {
  console.error("[paper-forward-raw] FAIL CLOSED: official trifecta settlement completeness did not pass; internal aggregation was not started");
  process.exit(preflight);
}

const internal = run("scripts/report-paper-forward-candidates-internal.ts");
if (internal !== 0) {
  console.error("[paper-forward-raw] internal aggregation failed after a successful settlement completeness preflight");
  process.exit(internal);
}

console.log("[paper-forward-raw] PASS: settlement completeness preflight passed before internal aggregation");
