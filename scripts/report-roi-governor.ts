import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const REQUIRED_REPORTS = [
  "reports/paper-forward-monitor.json",
  "reports/ticket-selector-strategies.json",
  "reports/roi-skip-policy-simulation.json",
] as const;

function fail(path: string, reason: string): never {
  console.error(`ROI_GOVERNOR_INPUT_REPORT_INVALID ${JSON.stringify({ path, reason })}`);
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

const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/report-roi-governor-raw.ts"], {
  stdio: "inherit",
  env: process.env,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
