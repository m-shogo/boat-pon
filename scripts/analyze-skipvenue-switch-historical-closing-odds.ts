import { spawnSync } from "node:child_process";

function run(script: string): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const audit = run("scripts/audit-skipvenue-historical-payout-completeness.ts");
if (audit !== 0) {
  console.error("[skipvenue-switch-historical] FAIL CLOSED: official trifecta settlement coverage is incomplete; switch analysis was not generated");
  process.exit(audit);
}

process.exit(run("scripts/analyze-skipvenue-switch-historical-closing-odds-raw.ts"));
