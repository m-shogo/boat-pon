/**
 * Canonical read-only entrypoint for the racer ability audit.
 *
 * This wrapper keeps the legacy aggregation isolated in a temporary workspace,
 * validates the research DB and frozen candidate artifact identities before use,
 * and removes filesystem provenance before publishing reports.
 */

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const configuredDbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const configuredCandidatesPath = "data/exacta-forward-candidates.json";
const outMd = "reports/racer-ability-data-audit.md";
const outJson = "reports/racer-ability-data-audit.json";
const internalPath = fileURLToPath(new URL("./report-racer-ability-audit-internal.ts", import.meta.url));

if (!existsSync(configuredDbPath)) throw new Error("RACER_ABILITY_AUDIT_DB_MISSING");
if (!existsSync(configuredCandidatesPath)) throw new Error("RACER_ABILITY_AUDIT_CANDIDATES_MISSING");

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(
  configuredDbPath,
  "RACER_ABILITY_AUDIT_DB_IDENTITY_INVALID",
);
const verifiedCandidatesPath = assertCanonicalSingleLinkRegularFile(
  configuredCandidatesPath,
  "RACER_ABILITY_AUDIT_CANDIDATES_IDENTITY_INVALID",
);

const workspace = mkdtempSync(join(tmpdir(), "boat-pon-racer-ability-"));
try {
  const workspaceCandidates = join(workspace, configuredCandidatesPath);
  mkdirSync(dirname(workspaceCandidates), { recursive: true });
  mkdirSync(join(workspace, "reports"), { recursive: true });
  copyFileSync(verifiedCandidatesPath, workspaceCandidates);

  const child = spawnSync(process.execPath, ["--import", "tsx", internalPath], {
    cwd: workspace,
    env: { ...process.env, BOAT_PON_DB_PATH: verifiedDbPath },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (child.status !== 0) throw new Error("RACER_ABILITY_AUDIT_INTERNAL_FAILED");

  const generatedJsonPath = join(workspace, outJson);
  const generatedMdPath = join(workspace, outMd);
  if (!existsSync(generatedJsonPath) || !existsSync(generatedMdPath)) {
    throw new Error("RACER_ABILITY_AUDIT_OUTPUT_MISSING");
  }

  const report = JSON.parse(readFileSync(generatedJsonPath, "utf8")) as Record<string, unknown>;
  delete report.dbPath;
  report.dbProvenance = "verified-read-only-research-db";

  const markdown = readFileSync(generatedMdPath, "utf8").replace(
    /^DB: .*$/mu,
    "DB: verified read-only research DB",
  );

  mkdirSync("reports", { recursive: true });
  writeFileSync(outJson, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(outMd, markdown);

  console.log("[report-racer-ability-audit] completed with verified research inputs");
  console.log(`[report-racer-ability-audit] wrote ${outMd}`);
  console.log(`[report-racer-ability-audit] wrote ${outJson}`);
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
