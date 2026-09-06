import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const REQUIRED_REPORTS = [
  "reports/bet-type-coverage-audit.json",
  "reports/all-bet-type-screening.json",
  "reports/promising-bet-type-strategies.json",
  "reports/miss-to-bet-type-recovery.json",
  "reports/bet-type-course-edge.json",
  "reports/bet-type-risk-factors.json",
] as const;

function fail(path: string, reason: string): never {
  console.error(`BET_TYPE_SELECTOR_INPUT_REPORT_INVALID ${JSON.stringify({ path, reason })}`);
  process.exit(2);
}

for (const path of REQUIRED_REPORTS) {
  if (!existsSync(path)) fail(path, "missing");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail(path, "invalid_json");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail(path, "invalid_shape");
  }
}

function run(script: string): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

process.exit(run("scripts/report-bet-type-selector-summary-raw.ts"));
