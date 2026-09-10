/**
 * report-paper-forward-candidates-raw.ts — guarded research-only compatibility entrypoint
 *
 * Historical paper-forward aggregation must not be reachable without the canonical
 * official-settlement completeness preflight. This file intentionally contains no
 * aggregation logic; it only enforces the guard before delegating to the internal
 * read-only implementation.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const OUT_MD = "reports/paper-forward-candidates.md";
const OPAQUE_DB_SOURCE = "primary research database";

function run(script: string, env: NodeJS.ProcessEnv = process.env): number {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    stdio: "inherit",
    env,
  });

  if (result.error) {
    console.error(`[paper-forward-raw] failed to start ${script}: ${result.error.message}`);
    return 1;
  }

  return result.status ?? 1;
}

function redactDbProvenance(handoffDbPath: string): void {
  if (!existsSync(OUT_MD)) {
    throw new Error("PAPER_FORWARD_RAW_REPORT_MISSING_AFTER_INTERNAL_SUCCESS");
  }

  const report = readFileSync(OUT_MD, "utf-8");
  const redacted = report
    .split(handoffDbPath).join(OPAQUE_DB_SOURCE)
    .replace(/^DB:.*$/gm, `DB: ${OPAQUE_DB_SOURCE}`);

  if (redacted.includes(handoffDbPath)) {
    throw new Error("PAPER_FORWARD_RAW_PRIVATE_DB_PATH_REMAINS");
  }

  writeFileSync(OUT_MD, redacted, "utf-8");

  const dbLines = redacted.match(/^DB:.*$/gm) ?? [];
  if (dbLines.length !== 1 || dbLines[0] !== `DB: ${OPAQUE_DB_SOURCE}`) {
    throw new Error("PAPER_FORWARD_RAW_DB_PROVENANCE_UNEXPECTED");
  }
}

const preflight = run("scripts/audit-odds-payout-gap-completeness.ts");
if (preflight !== 0) {
  console.error("[paper-forward-raw] FAIL CLOSED: official trifecta settlement completeness did not pass; internal aggregation was not started");
  process.exit(preflight);
}

const configuredDbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const handoffDbPath = assertCanonicalSingleLinkRegularFile(
  configuredDbPath,
  "PAPER_FORWARD_RAW_DB_HANDOFF_IDENTITY_INVALID",
);

const internal = run("scripts/report-paper-forward-candidates-internal.ts", {
  ...process.env,
  BOAT_PON_DB_PATH: handoffDbPath,
  BOAT_PON_PAPER_FORWARD_INTERNAL_GUARD: "1",
});
if (internal !== 0) {
  console.error("[paper-forward-raw] internal aggregation failed after a successful settlement completeness preflight");
  process.exit(internal);
}

redactDbProvenance(handoffDbPath);
console.log("[paper-forward-raw] PASS: settlement completeness preflight passed before internal aggregation");
