/**
 * Fail-closed runner for the condB historical closing-odds research analysis.
 * The analyzer must not run unless official trifecta settlement coverage is complete.
 */

import { execFileSync } from "node:child_process";

const env = { ...process.env };

execFileSync("pnpm", ["tsx", "scripts/audit-condb-switch-historical-payout-completeness.ts"], {
  stdio: "inherit",
  env,
});

execFileSync("pnpm", ["tsx", "scripts/analyze-condb-switch-historical-closing-odds.ts"], {
  stdio: "inherit",
  env,
});
