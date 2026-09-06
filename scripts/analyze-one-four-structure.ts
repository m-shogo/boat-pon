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
  console.error("[one-four-structure] FAIL CLOSED: official payout settlement coverage is incomplete; structure analysis was not generated");
  process.exit(audit);
}

process.exit(run("scripts/analyze-one-four-structure-raw.ts"));
