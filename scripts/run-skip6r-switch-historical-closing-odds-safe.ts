import { spawnSync } from "node:child_process";

function run(script: string): void {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("scripts/audit-skip6r-historical-payout-completeness.ts");
run("scripts/analyze-skip6r-switch-historical-closing-odds.ts");
