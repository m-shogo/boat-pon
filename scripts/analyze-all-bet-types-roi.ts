import { spawnSync } from "node:child_process";

function run(script: string): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const audit = run("scripts/audit-all-bet-types-payout-completeness.ts");
if (audit !== 0) {
  console.error("[all-bet-types-roi] FAIL CLOSED: official payout settlement coverage is incomplete; ROI analysis was not generated");
  process.exit(audit);
}

const analysis = run("scripts/analyze-all-bet-types-roi-raw.ts");
process.exit(analysis);
