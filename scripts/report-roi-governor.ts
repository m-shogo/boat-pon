import { existsSync, readFileSync } from "node:fs";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const REQUIRED_REPORTS = [
  "reports/paper-forward-monitor.json",
  "reports/ticket-selector-strategies.json",
  "reports/roi-skip-policy-simulation.json",
] as const;

const OPTIONAL_DECISION_REPORTS = [
  "reports/wind24-exh1-switch-deep-dive.json",
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

function requireFiniteNumber(reportPath: string, root: unknown, path: readonly string[]): number {
  const value = readPath(root, path);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(reportPath, `invalid_required_number:${path.join(".")}`);
  }
  return value;
}

function requireNonNegativeInteger(reportPath: string, root: unknown, path: readonly string[]): number {
  const value = requireFiniteNumber(reportPath, root, path);
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(reportPath, `invalid_required_count:${path.join(".")}`);
  }
  return value;
}

function requireBoolean(reportPath: string, root: unknown, path: readonly string[]): boolean {
  const value = readPath(root, path);
  if (typeof value !== "boolean") fail(reportPath, `invalid_required_boolean:${path.join(".")}`);
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
  requireNonNegativeInteger(reportPath, condB, ["forward", "n"]);
  requireFiniteNumber(reportPath, condB, ["forward", "payoutRoi132"]);
  requireFiniteNumber(reportPath, condB, ["upgradeCheck", "top2ExclRoi"]);
  requireNonNegativeInteger(reportPath, condB, ["upgradeCheck", "recentZeroMonths"]);
  requireNonNegativeInteger(reportPath, condB, ["upgradeCheck", "nToUpgrade"]);
  requireString(reportPath, condB, ["upgradeCheck", "upgradeVerdict"]);
}

function validateTicketSelector(reportPath: string, parsed: unknown): void {
  requireFiniteNumber(reportPath, parsed, ["conditions", "A_all", "singleBets", "3連単1-2-3", "forward", "roi"]);
  requireFiniteNumber(reportPath, parsed, ["selectors", "onePt", "forward", "roi"]);
  requireFiniteNumber(reportPath, parsed, ["selectors", "multiPt", "forward", "roi"]);
}

function validateSkipPolicy(reportPath: string, parsed: unknown): void {
  requireNonNegativeInteger(reportPath, parsed, ["baseline", "n"]);
  requireNonNegativeInteger(reportPath, parsed, ["baseline", "hits"]);
  requireFiniteNumber(reportPath, parsed, ["baseline", "roi"]);
  requireArray(reportPath, parsed, ["policies"]);
  requireArray(reportPath, parsed, ["greedy"]);
}

function validateWind24DeepDive(reportPath: string, parsed: unknown): void {
  requireNonNegativeInteger(reportPath, parsed, ["periods", "fwdAll", "n"]);
  requireFiniteNumber(reportPath, parsed, ["periods", "train", "roi132"]);
  requireFiniteNumber(reportPath, parsed, ["periods", "fwdAll", "roi132"]);
  requireFiniteNumber(reportPath, parsed, ["periods", "fwdH2", "roi132"]);
  requireFiniteNumber(reportPath, parsed, ["excludeMax", "forward", "top1Roi"]);
  requireFiniteNumber(reportPath, parsed, ["excludeMax", "forward", "top2Roi"]);
  requireFiniteNumber(reportPath, parsed, ["excludeMax", "forward", "top3Roi"]);
  requireNonNegativeInteger(reportPath, parsed, ["upgradeStatus", "nForUpgrade"]);
  requireBoolean(reportPath, parsed, ["upgradeStatus", "nReached200"]);
  requireBoolean(reportPath, parsed, ["upgradeStatus", "top2RoiOk"]);
  requireNonNegativeInteger(reportPath, parsed, ["upgradeStatus", "recentZeroCount"]);
}

function validateDecisionCriticalShape(reportPath: string, parsed: unknown): void {
  if (reportPath === "reports/paper-forward-monitor.json") return validatePaperForwardMonitor(reportPath, parsed);
  if (reportPath === "reports/ticket-selector-strategies.json") return validateTicketSelector(reportPath, parsed);
  if (reportPath === "reports/roi-skip-policy-simulation.json") return validateSkipPolicy(reportPath, parsed);
  if (reportPath === "reports/wind24-exh1-switch-deep-dive.json") return validateWind24DeepDive(reportPath, parsed);
}

function validateReport(path: string, identityError: string, required: boolean): void {
  if (!existsSync(path)) {
    if (required) fail(path, "missing");
    return;
  }
  const verifiedPath = assertCanonicalSingleLinkRegularFile(path, identityError);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(verifiedPath, "utf8"));
  } catch {
    fail(path, "invalid_json");
  }
  if (!isObject(parsed)) fail(path, "invalid_shape");
  validateDecisionCriticalShape(path, parsed);
}

for (const path of REQUIRED_REPORTS) {
  validateReport(path, "ROI_GOVERNOR_INPUT_REPORT_IDENTITY_INVALID", true);
}
for (const path of OPTIONAL_DECISION_REPORTS) {
  validateReport(path, "ROI_GOVERNOR_OPTIONAL_DECISION_REPORT_IDENTITY_INVALID", false);
}

// Re-read and revalidate every decision-affecting artifact immediately before
// the raw phase consumes it. This keeps both required inputs and any present
// higher-precedence optional evidence fail-closed across the validation/use window.
for (const path of REQUIRED_REPORTS) {
  validateReport(path, "ROI_GOVERNOR_INPUT_REPORT_HANDOFF_IDENTITY_INVALID", true);
}
for (const path of OPTIONAL_DECISION_REPORTS) {
  validateReport(path, "ROI_GOVERNOR_OPTIONAL_DECISION_REPORT_HANDOFF_IDENTITY_INVALID", false);
}

await import("./report-roi-governor-raw");
