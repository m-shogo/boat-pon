/**
 * analyze-roi-skip-interactions.ts — research-only fail-closed entrypoint
 *
 * Missing official trifecta settlement coverage must not become a synthetic
 * zero-return observation in skip/intersection residual analysis.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const OUT_MD = "reports/roi-skip-interactions.md";
const OPAQUE_DB_SOURCE = "primary research database";

function run(script: string, env = process.env): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env,
  });

  if (result.error) {
    console.error(`[skip-interactions] failed to start ${script}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

function redactDbProvenance(dbPath: string): void {
  if (!existsSync(OUT_MD)) {
    throw new Error("ROI_SKIP_INTERACTIONS_REPORT_MISSING_AFTER_ANALYSIS");
  }

  const verifiedReportPath = assertCanonicalSingleLinkRegularFile(
    OUT_MD,
    "ROI_SKIP_INTERACTIONS_REPORT_IDENTITY_INVALID",
  );
  const report = readFileSync(verifiedReportPath, "utf-8");
  const privateMarker = `DB: ${dbPath}`;
  if (!report.includes(privateMarker)) {
    throw new Error("ROI_SKIP_INTERACTIONS_PRIVATE_DB_PROVENANCE_MARKER_MISSING");
  }

  const handoffReportPath = assertCanonicalSingleLinkRegularFile(
    verifiedReportPath,
    "ROI_SKIP_INTERACTIONS_REPORT_HANDOFF_IDENTITY_INVALID",
  );
  writeFileSync(
    handoffReportPath,
    report.replaceAll(privateMarker, `DB: ${OPAQUE_DB_SOURCE}`),
    "utf-8",
  );
}

const preflight = run("scripts/audit-roi-skip-interactions-payout-completeness.ts");
if (preflight !== 0) {
  console.error("[skip-interactions] FAIL CLOSED: official trifecta settlement coverage is incomplete; skip/intersection verdicts were not generated");
  process.exit(preflight);
}

if (!existsSync(DB_PATH)) {
  throw new Error("ROI_SKIP_INTERACTIONS_PRIMARY_DB_MISSING");
}
const verifiedDbPath = assertCanonicalSingleLinkRegularFile(
  DB_PATH,
  "ROI_SKIP_INTERACTIONS_PRIMARY_DB_IDENTITY_INVALID",
);

process.env.BOAT_PON_DB_PATH = verifiedDbPath;
await import("./analyze-roi-skip-interactions-core");

redactDbProvenance(verifiedDbPath);
console.log("[skip-interactions] PASS: settlement completeness preflight and DB identity verification passed before interaction analysis");
