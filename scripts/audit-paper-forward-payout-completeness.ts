/**
 * audit-paper-forward-payout-completeness.ts — compatibility wrapper
 *
 * Historical paper-forward payout completeness has one canonical authority:
 * audit-paper-forward-monitor-payout-completeness.ts. Keep this legacy path
 * fail-closed by delegating to that stronger cohort + settlement-integrity gate
 * rather than maintaining a second, weaker SQL definition.
 *
 * Research-only: no DB writes, app_settings changes, production decisions,
 * notifications, external access, or betting behavior.
 */

import { spawnSync } from "node:child_process";

const CANONICAL_PREFLIGHT = "scripts/audit-paper-forward-monitor-payout-completeness.ts";

const result = spawnSync(process.execPath, ["--import", "tsx", CANONICAL_PREFLIGHT], {
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  console.error(`[paper-forward-payout-preflight] failed to start canonical settlement preflight: ${result.error.message}`);
  process.exit(1);
}

const status = result.status ?? 1;
if (status !== 0) {
  console.error("[paper-forward-payout-preflight] FAIL CLOSED: canonical paper-forward settlement integrity did not pass");
  process.exit(status);
}

console.log("[paper-forward-payout-preflight] PASS: canonical paper-forward settlement integrity passed");
