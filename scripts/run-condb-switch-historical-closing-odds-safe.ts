/**
 * Compatibility runner for condB historical closing-odds research.
 * Delegate to the canonical entrypoint so settlement preflight cannot diverge
 * from the analyzer boundary.
 */

import { execFileSync } from "node:child_process";

execFileSync("pnpm", ["tsx", "scripts/analyze-condb-switch-historical-closing-odds.ts"], {
  stdio: "inherit",
  env: { ...process.env },
});
