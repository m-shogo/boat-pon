import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const REQUIRED_REPORTS = [
  "reports/bet-type-coverage-audit.json",
  "reports/all-bet-type-screening.json",
  "reports/promising-bet-type-strategies.json",
  "reports/miss-to-bet-type-recovery.json",
  "reports/bet-type-course-edge.json",
  "reports/bet-type-risk-factors.json",
] as const;

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

function run(script: string): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

process.exit(run("scripts/report-bet-type-selector-summary-internal.ts"));
