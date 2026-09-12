import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const REQUIRED_REPORTS = [
  "reports/paper-forward-monitor.json",
  "reports/ticket-selector-strategies.json",
  "reports/roi-skip-policy-simulation.json",
] as const;

const OPTIONAL_DECISION_REPORTS = [
  "reports/wind24-exh1-switch-deep-dive.json",
] as const;

const OPTIONAL_CONTEXT_REPORTS = [
  "reports/paper-forward-candidates.json",
] as const;

const OUT_MD = "reports/roi-governor.md";
const OUT_JSON = "reports/roi-governor.json";

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

function validateReport(path: string, identityError: string, required: boolean, decisionCritical = true): string | null {
  if (!existsSync(path)) {
    if (required) fail(path, "missing");
    return null;
  }
  const verifiedPath = assertCanonicalSingleLinkRegularFile(path, identityError);
  const contents = readFileSync(verifiedPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    fail(path, "invalid_json");
  }
  if (!isObject(parsed)) fail(path, "invalid_shape");
  if (decisionCritical) validateDecisionCriticalShape(path, parsed);
  return contents;
}

function atomicPublish(path: string, contents: string, tempErrorCode: string, destinationErrorCode: string): void {
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "wx", 0o600);
    writeFileSync(fd, contents, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    const verifiedTempPath = assertCanonicalSingleLinkRegularFile(tempPath, tempErrorCode);
    if (existsSync(path)) {
      assertCanonicalSingleLinkRegularFile(path, destinationErrorCode);
    }
    renameSync(verifiedTempPath, path);
  } finally {
    if (fd !== null) closeSync(fd);
    rmSync(tempPath, { force: true });
  }
}

for (const path of REQUIRED_REPORTS) {
  validateReport(path, "ROI_GOVERNOR_INPUT_REPORT_IDENTITY_INVALID", true);
}
for (const path of OPTIONAL_DECISION_REPORTS) {
  validateReport(path, "ROI_GOVERNOR_OPTIONAL_DECISION_REPORT_IDENTITY_INVALID", false);
}
for (const path of OPTIONAL_CONTEXT_REPORTS) {
  validateReport(path, "ROI_GOVERNOR_OPTIONAL_CONTEXT_REPORT_IDENTITY_INVALID", false, false);
}

const rawPath = fileURLToPath(new URL("./report-roi-governor-raw.ts", import.meta.url));
const tsxLoader = import.meta.resolve("tsx");
const workspace = mkdtempSync(join(tmpdir(), "boat-pon-roi-governor-"));

try {
  mkdirSync(join(workspace, "reports"), { recursive: true });

  // Re-read every consumed artifact immediately before child launch, then stage
  // the verified bytes into an isolated workspace. The raw generator can no
  // longer overwrite canonical reports directly or race a validated input.
  for (const path of REQUIRED_REPORTS) {
    const contents = validateReport(path, "ROI_GOVERNOR_INPUT_REPORT_HANDOFF_IDENTITY_INVALID", true);
    writeFileSync(join(workspace, path), contents!, "utf8");
  }
  for (const path of OPTIONAL_DECISION_REPORTS) {
    const contents = validateReport(path, "ROI_GOVERNOR_OPTIONAL_DECISION_REPORT_HANDOFF_IDENTITY_INVALID", false);
    if (contents !== null) writeFileSync(join(workspace, path), contents, "utf8");
  }
  for (const path of OPTIONAL_CONTEXT_REPORTS) {
    const contents = validateReport(path, "ROI_GOVERNOR_OPTIONAL_CONTEXT_REPORT_HANDOFF_IDENTITY_INVALID", false, false);
    if (contents !== null) writeFileSync(join(workspace, path), contents, "utf8");
  }

  const raw = spawnSync(process.execPath, ["--import", tsxLoader, rawPath], {
    cwd: workspace,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (raw.error || raw.status !== 0) {
    throw new Error("ROI_GOVERNOR_RAW_ISOLATED_GENERATION_FAILED");
  }

  const stagedJson = join(workspace, OUT_JSON);
  const stagedMarkdown = join(workspace, OUT_MD);
  if (!existsSync(stagedJson)) throw new Error("ROI_GOVERNOR_JSON_OUTPUT_MISSING");
  if (!existsSync(stagedMarkdown)) throw new Error("ROI_GOVERNOR_MARKDOWN_OUTPUT_MISSING");

  const verifiedJson = assertCanonicalSingleLinkRegularFile(stagedJson, "ROI_GOVERNOR_JSON_OUTPUT_IDENTITY_INVALID");
  const verifiedMarkdown = assertCanonicalSingleLinkRegularFile(stagedMarkdown, "ROI_GOVERNOR_MARKDOWN_OUTPUT_IDENTITY_INVALID");
  const json = readFileSync(verifiedJson, "utf8");
  const markdown = readFileSync(verifiedMarkdown, "utf8");

  mkdirSync("reports", { recursive: true });
  atomicPublish(
    OUT_JSON,
    json,
    "ROI_GOVERNOR_JSON_PUBLISH_TEMP_IDENTITY_INVALID",
    "ROI_GOVERNOR_JSON_PUBLISH_DESTINATION_IDENTITY_INVALID",
  );
  atomicPublish(
    OUT_MD,
    markdown,
    "ROI_GOVERNOR_MARKDOWN_PUBLISH_TEMP_IDENTITY_INVALID",
    "ROI_GOVERNOR_MARKDOWN_PUBLISH_DESTINATION_IDENTITY_INVALID",
  );
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

console.log("[roi-governor] PASS: validated inputs, isolated generation, and atomic publication completed");
