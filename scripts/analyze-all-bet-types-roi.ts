import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const OUT_MD = "reports/all-bet-types-roi.md";
const OUT_JSON = "reports/all-bet-types-roi.json";

function run(script: string): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function assertExistingOutputIdentity(path: string, code: string): void {
  if (!existsSync(path)) return;
  assertCanonicalSingleLinkRegularFile(path, code);
}

const audit = run("scripts/audit-all-bet-types-payout-completeness.ts");
if (audit !== 0) {
  console.error("[all-bet-types-roi] FAIL CLOSED: official payout settlement coverage is incomplete; ROI analysis was not generated");
  process.exit(audit);
}

const configuredDbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const handoffDbPath = assertCanonicalSingleLinkRegularFile(
  configuredDbPath,
  "ALL_BET_TYPES_ROI_DB_HANDOFF_IDENTITY_INVALID",
);
process.env.BOAT_PON_DB_PATH = handoffDbPath;

assertExistingOutputIdentity(OUT_MD, "ALL_BET_TYPES_ROI_MD_PREEXISTING_IDENTITY_INVALID");
assertExistingOutputIdentity(OUT_JSON, "ALL_BET_TYPES_ROI_JSON_PREEXISTING_IDENTITY_INVALID");

const status = run("scripts/analyze-all-bet-types-roi-internal.ts");
if (status !== 0) process.exit(status);

if (!existsSync(OUT_MD) || !existsSync(OUT_JSON)) {
  throw new Error("ALL_BET_TYPES_ROI_OUTPUT_MISSING");
}
assertCanonicalSingleLinkRegularFile(OUT_MD, "ALL_BET_TYPES_ROI_MD_OUTPUT_IDENTITY_INVALID");
assertCanonicalSingleLinkRegularFile(OUT_JSON, "ALL_BET_TYPES_ROI_JSON_OUTPUT_IDENTITY_INVALID");
