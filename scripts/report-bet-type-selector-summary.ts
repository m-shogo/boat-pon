import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const REQUIRED_REPORTS = [
  "reports/bet-type-coverage-audit.json",
  "reports/all-bet-type-screening.json",
  "reports/promising-bet-type-strategies.json",
  "reports/miss-to-bet-type-recovery.json",
  "reports/bet-type-course-edge.json",
  "reports/bet-type-risk-factors.json",
] as const;
const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/bet-type-selector-summary.md";
const OUT_JSON = "reports/bet-type-selector-summary.json";
const OPAQUE_DB_SOURCE = "primary research database";

type ReportEnvelope = {
  safety?: {
    pointInTimeSafe?: unknown;
  };
};

function fail(path: string, reason: string): never {
  console.error(`BET_TYPE_SELECTOR_INPUT_REPORT_INVALID ${JSON.stringify({ path, reason })}`);
  process.exit(2);
}

for (const path of REQUIRED_REPORTS) {
  if (!existsSync(path)) fail(path, "missing");
  const verifiedPath = assertCanonicalSingleLinkRegularFile(
    path,
    "BET_TYPE_SELECTOR_INPUT_REPORT_IDENTITY_INVALID",
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(verifiedPath, "utf8"));
  } catch {
    fail(path, "invalid_json");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail(path, "invalid_shape");
  }

  const envelope = parsed as ReportEnvelope;
  if (envelope.safety?.pointInTimeSafe === false) {
    fail(path, "point_in_time_unsafe");
  }
}

function verifyDbHandoff(): string {
  if (!existsSync(DB_PATH)) {
    console.error("BET_TYPE_SELECTOR_DB_MISSING");
    process.exit(2);
  }
  return assertCanonicalSingleLinkRegularFile(DB_PATH, "BET_TYPE_SELECTOR_DB_HANDOFF_IDENTITY_INVALID");
}

function run(script: string, verifiedDbPath: string): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: { ...process.env, BOAT_PON_DB_PATH: verifiedDbPath },
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function redactDbProvenance(dbPath: string): void {
  if (!existsSync(OUT_MD)) {
    throw new Error("BET_TYPE_SELECTOR_REPORT_MISSING_AFTER_ANALYSIS");
  }
  const verifiedReportPath = assertCanonicalSingleLinkRegularFile(
    OUT_MD,
    "BET_TYPE_SELECTOR_REPORT_IDENTITY_INVALID",
  );
  const report = readFileSync(verifiedReportPath, "utf8");
  const provenance = `DB: ${dbPath}`;
  if (!report.includes(provenance)) {
    throw new Error("BET_TYPE_SELECTOR_DB_PROVENANCE_NOT_FOUND");
  }
  const handoffReportPath = assertCanonicalSingleLinkRegularFile(
    verifiedReportPath,
    "BET_TYPE_SELECTOR_REPORT_HANDOFF_IDENTITY_INVALID",
  );
  writeFileSync(handoffReportPath, report.replaceAll(provenance, `DB: ${OPAQUE_DB_SOURCE}`));
}

function verifyJsonOutput(): void {
  if (!existsSync(OUT_JSON)) {
    throw new Error("BET_TYPE_SELECTOR_JSON_REPORT_MISSING_AFTER_ANALYSIS");
  }
  const verifiedJsonPath = assertCanonicalSingleLinkRegularFile(
    OUT_JSON,
    "BET_TYPE_SELECTOR_JSON_REPORT_IDENTITY_INVALID",
  );
  try {
    JSON.parse(readFileSync(verifiedJsonPath, "utf8"));
  } catch {
    throw new Error("BET_TYPE_SELECTOR_JSON_REPORT_INVALID");
  }
  assertCanonicalSingleLinkRegularFile(
    verifiedJsonPath,
    "BET_TYPE_SELECTOR_JSON_REPORT_HANDOFF_IDENTITY_INVALID",
  );
}

const verifiedDbPath = verifyDbHandoff();
const status = run("scripts/report-bet-type-selector-summary-internal.ts", verifiedDbPath);
if (status === 0) {
  redactDbProvenance(verifiedDbPath);
  verifyJsonOutput();
}
process.exit(status);