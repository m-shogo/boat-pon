import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const REQUIRED_REPORTS = [
  "reports/paper-forward-monitor.json",
  "reports/ticket-selector-strategies.json",
  "reports/roi-skip-policy-simulation.json",
] as const;

type JsonObject = Record<string, unknown>;

function fail(path: string, reason: string): never {
  console.error(`ROI_GOVERNOR_INPUT_REPORT_INVALID ${JSON.stringify({ path, reason })}`);
  process.exit(2);
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readPath(root: unknown, path: readonly string[]): unknown {
  let current = root;
  for (const segment of path) {
    if (!isObject(current) || !(segment in current)) return undefined;
    current = current[segment];
  }
  return current;
}

function requireFiniteNumber(reportPath: string, root: unknown, path: readonly string[], integer = false): number {
  const value = readPath(root, path);
  if (typeof value !== "number" || !Number.isFinite(value) || (integer && !Number.isSafeInteger(value))) {
    fail(reportPath, `invalid_required_number:${path.join(".")}`);
  }
  return value;
}

function requireString(reportPath: string, root: unknown, path: readonly string[]): string {
  const value = readPath(root, path);
  if (typeof value !== "string" || value.length === 0) fail(reportPath, `invalid_required_string:${path.join(".")}`);
  return value;
}

function requireArray(reportPath: string, root: unknown, path: readonly string[]): unknown[] {
  const value = readPath(root, path);
  if (!Array.isArray(value)) fail(reportPath, `invalid_required_array:${path.join(".")}`);
  return value;
}

function validatePaperForwardMonitor(reportPath: string, parsed: unknown): void {
  const switches = requireArray(reportPath, parsed, ["switchMonitors"]);
  const condB = switches.find((value) => isObject(value) && value.id === "sw_wind24_exh1");
  if (!condB) fail(reportPath, "missing_required_switch:sw_wind24_exh1");

  requireFiniteNumber(reportPath, condB, ["train", "payoutRoi132"]);
  requireFiniteNumber(reportPath, condB, ["forward", "n"], true);
  requireFiniteNumber(reportPath, condB, ["forward", "payoutRoi132"]);
  requireFiniteNumber(reportPath, condB, ["upgradeCheck", "top2ExclRoi"]);
  requireFiniteNumber(reportPath, condB, ["upgradeCheck", "recentZeroMonths"], true);
  requireFiniteNumber(reportPath, condB, ["upgradeCheck", "nToUpgrade"], true);
  requireString(reportPath, condB, ["upgradeCheck", "upgradeVerdict"]);
}

function validateTicketSelector(reportPath: string, parsed: unknown): void {
  requireFiniteNumber(reportPath, parsed, ["conditions", "A_all", "singleBets", "3連単1-2-3", "forward", "roi"]);
  requireFiniteNumber(reportPath, parsed, ["selectors", "onePt", "forward", "roi"]);
  requireFiniteNumber(reportPath, parsed, ["selectors", "multiPt", "forward", "roi"]);
}

function validateSkipPolicy(reportPath: string, parsed: unknown): void {
  requireFiniteNumber(reportPath, parsed, ["baseline", "n"], true);
  requireFiniteNumber(reportPath, parsed, ["baseline", "hits"], true);
  requireFiniteNumber(reportPath, parsed, ["baseline", "roi"]);
  requireArray(reportPath, parsed, ["policies"]);
  requireArray(reportPath, parsed, ["greedy"]);
}

function validateDecisionCriticalShape(reportPath: string, parsed: unknown): void {
  if (reportPath === "reports/paper-forward-monitor.json") return validatePaperForwardMonitor(reportPath, parsed);
  if (reportPath === "reports/ticket-selector-strategies.json") return validateTicketSelector(reportPath, parsed);
  if (reportPath === "reports/roi-skip-policy-simulation.json") return validateSkipPolicy(reportPath, parsed);
}

for (const path of REQUIRED_REPORTS) {
  if (!existsSync(path)) fail(path, "missing");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail(path, "invalid_json");
  }
  if (!isObject(parsed)) fail(path, "invalid_shape");
  validateDecisionCriticalShape(path, parsed);
}

const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/report-roi-governor-raw.ts"], {
  stdio: "inherit",
  env: process.env,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
