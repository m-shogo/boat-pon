/**
 * analyze-payout-rebase.ts — guarded research-only entrypoint
 *
 * Direct invocation must pass the same settlement-integrity preflight as the
 * canonical safe runner before the legacy payout-rebase analysis is allowed to
 * execute. No DB writes, app_settings changes, production decisions,
 * notifications, or automated betting are performed here.
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
    console.error(`[payout-rebase-entrypoint] failed to start guarded research step: ${result.error.message}`);
    return 1;
  }

  return result.status ?? 1;
}

const preflight = run("scripts/audit-odds-payout-gap-completeness.ts");
if (preflight !== 0) {
  console.error("[payout-rebase-entrypoint] FAIL CLOSED: settlement integrity preflight did not pass; payout-based classifications were not generated");
  process.exit(preflight);
}

if (!existsSync(DB_PATH)) {
  throw new Error("PAYOUT_REBASE_PRIMARY_DB_MISSING");
}
const verifiedDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "PAYOUT_REBASE_PRIMARY_DB_IDENTITY_INVALID",
);

const analysis = run("scripts/analyze-payout-rebase-internal.ts", {
  ...process.env,
  BOAT_PON_DB_PATH: verifiedDbPath,
});
if (analysis !== 0) {
  console.error("[payout-rebase-entrypoint] payout rebase analysis failed after a successful settlement integrity preflight");
  process.exit(analysis);
}

console.log("[payout-rebase-entrypoint] PASS: settlement integrity preflight and DB identity verification passed before payout rebase analysis");
