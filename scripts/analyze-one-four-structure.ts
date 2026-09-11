import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const OUT_MD = "reports/one-four-structure.md";
const OUT_JSON = "reports/one-four-structure.json";

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
  console.error("[one-four-structure] FAIL CLOSED: official payout settlement coverage is incomplete; structure analysis was not generated");
  process.exit(audit);
}

const configuredDbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
if (!existsSync(configuredDbPath)) {
  throw new Error("ONE_FOUR_STRUCTURE_DB_MISSING");
}
process.env.BOAT_PON_DB_PATH = assertCanonicalSingleLinkRegularFile(
  configuredDbPath,
  "ONE_FOUR_STRUCTURE_DB_HANDOFF_IDENTITY_INVALID",
);

assertExistingOutputIdentity(OUT_MD, "ONE_FOUR_STRUCTURE_MD_PREEXISTING_IDENTITY_INVALID");
assertExistingOutputIdentity(OUT_JSON, "ONE_FOUR_STRUCTURE_JSON_PREEXISTING_IDENTITY_INVALID");

await import("./analyze-one-four-structure-internal");

if (!existsSync(OUT_MD) || !existsSync(OUT_JSON)) {
  throw new Error("ONE_FOUR_STRUCTURE_OUTPUT_MISSING");
}
assertCanonicalSingleLinkRegularFile(OUT_MD, "ONE_FOUR_STRUCTURE_MD_OUTPUT_IDENTITY_INVALID");
assertCanonicalSingleLinkRegularFile(OUT_JSON, "ONE_FOUR_STRUCTURE_JSON_OUTPUT_IDENTITY_INVALID");
