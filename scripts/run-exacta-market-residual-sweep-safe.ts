import { spawnSync } from "node:child_process";

const runner = process.platform === "win32" ? "npx.cmd" : "npx";

const audit = spawnSync(runner, ["tsx", "scripts/audit-exacta-market-residual-payout-completeness.ts"], {
  stdio: "inherit",
  env: process.env,
});
if (audit.error) throw audit.error;
if (audit.status !== 0) process.exit(audit.status ?? 2);

const analysis = spawnSync(runner, ["tsx", "scripts/analyze-exacta-market-residual-sweep.ts"], {
  stdio: "inherit",
  env: process.env,
});
if (analysis.error) throw analysis.error;
process.exit(analysis.status ?? 1);
