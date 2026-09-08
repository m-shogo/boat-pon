#!/usr/bin/env node
/**
 * Dependency-free smoke test for scripts/explore-roi.ts.
 *
 * Use when node_modules (tsx/typescript) is unavailable. Builds a small
 * throwaway SQLite fixture DB (node:sqlite), runs a copy of explore-roi.ts
 * via `node --experimental-strip-types`, and asserts the JSON output has the
 * required RuleEvaluationResult shape and expected canonical official-payout
 * ROI numbers. Everything is created under a temp directory and removed after.
 */

import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const KNOWN_EXTENSIONS = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "json"]);

function hasKnownExtension(spec) {
  const match = spec.match(/\.([a-zA-Z0-9]+)$/);
  return match != null && KNOWN_EXTENSIONS.has(match[1].toLowerCase());
}

let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  console.error("node:sqlite is unavailable on this Node build; cannot run the smoke test.");
  console.error("This requires a Node version with node:sqlite support (Node >=22.5, still experimental).");
  process.exit(1);
}

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const domainDir = join(repoRoot, "src", "domain");
const researchReplayDir = join(repoRoot, "src", "research-replay");
const tempDir = mkdtempSync(join(tmpdir(), "boatpon-verify-roi-smoke-"));
const tempDomainDir = join(tempDir, "src", "domain");
const tempResearchReplayDir = join(tempDir, "src", "research-replay");
const tempViewModelsDir = join(tempDir, "src", "view-models");
const tempPresentationDir = join(tempDir, "src", "presentation");
const tempPresentationTokensDir = join(tempPresentationDir, "tokens");
const tempScriptsDir = join(tempDir, "scripts");
const dbPath = join(tempDir, "fixture.sqlite");

let failures = 0;

try {
  mkdirSync(tempDomainDir, { recursive: true });
  mkdirSync(tempResearchReplayDir, { recursive: true });
  mkdirSync(tempViewModelsDir, { recursive: true });
  mkdirSync(tempPresentationTokensDir, { recursive: true });
  mkdirSync(tempScriptsDir, { recursive: true });
  for (const name of ["types.ts", "backtest.ts", "researchRule.ts", "researchRuleLifecycle.ts", "researchEvaluation.ts"]) {
    copyFileSync(join(domainDir, name), join(tempDomainDir, name));
  }
  copyFileSync(join(researchReplayDir, "roiExplorerOptions.ts"), join(tempResearchReplayDir, "roiExplorerOptions.ts"));
  copyFileSync(join(researchReplayDir, "researchFileIdentity.ts"), join(tempResearchReplayDir, "researchFileIdentity.ts"));
  for (const name of ["researchViewModel.ts", "researchViewModel.adapters.ts"]) {
    copyFileSync(join(repoRoot, "src", "view-models", name), join(tempViewModelsDir, name));
  }
  for (const name of ["presentationModel.ts", "presentationBuilder.ts"]) {
    copyFileSync(join(repoRoot, "src", "presentation", name), join(tempPresentationDir, name));
  }
  copyFileSync(join(repoRoot, "scripts", "explore-roi.ts"), join(tempScriptsDir, "explore-roi.ts"));
  addExplicitTsExtensions(tempDomainDir);
  addExplicitTsExtensions(tempResearchReplayDir);
  addExplicitTsExtensions(tempViewModelsDir);
  addExplicitTsExtensions(tempPresentationDir);
  addExplicitTsExtensions(tempScriptsDir);

  buildFixtureDb(dbPath);

  console.log("--- scenario 1: no condition ---");
  const full = runExplore(["--from", "2026-01-01", "--to", "2026-06-01", "--json"]);
  check("exit code 0", full.status === 0);
  const fullResult = parseJson(full.stdout);
  if (fullResult) {
    for (const field of ["ruleId", "metadata", "hitRate", "roi", "confidence", "maxDrawdown", "isForwardTested", "isProductionEligible", "reasonSummary", "warnings"]) {
      check(`result has field "${field}"`, field in fullResult);
    }
    for (const field of ["dataWindowStart", "dataWindowEnd", "evaluationRunAt", "sampleSize"]) {
      check(`metadata has field "${field}"`, field in fullResult.metadata);
    }
    check("sampleSize is 3 (settled non-returned BUY rows in window)", fullResult.metadata.sampleSize === 3);
    check("roi is 5.4 from canonical race_payouts only", closeTo(fullResult.roi, 5.4));
    check("roi basis is payout_yen", fullResult.reasonSummary.includes("roi basis: payout_yen"));
    check("roi basis does not mention current_odds", !fullResult.reasonSummary.includes("current_odds"));
  }

  console.log("--- scenario 2: --condition venue=桐生 ---");
  const filtered = runExplore(["--from", "2026-01-01", "--to", "2026-06-01", "--condition", "venue=桐生", "--json"]);
  check("exit code 0", filtered.status === 0);
  const filteredResult = parseJson(filtered.stdout);
  if (filteredResult) {
    check("condition narrows sampleSize to 2", filteredResult.metadata.sampleSize === 2);
    check("roi is 8.1 with venue filter", closeTo(filteredResult.roi, 8.1));
    check("reasonSummary echoes the condition", filteredResult.reasonSummary.includes("condition: venue=桐生"));
  }

  console.log("--- scenario 3: malformed --condition ---");
  const malformed = runExplore(["--condition", "badformat"]);
  check("malformed condition exits non-zero", malformed.status !== 0);

  console.log("--- scenario 4: no DB present ---");
  const noDb = runExplore(["--json"], { BOAT_PON_DB_PATH: join(tempDir, "does-not-exist.sqlite") });
  check("missing DB still exits 0", noDb.status === 0);
  const noDbResult = parseJson(noDb.stdout);
  if (noDbResult) {
    check("missing DB reports 0 sampleSize", noDbResult.metadata.sampleSize === 0);
    check("missing DB warning is opaque", noDbResult.warnings.some((w) => w.includes("research database not found")));
    check("missing DB warning does not expose configured path", !noDbResult.warnings.some((w) => w.includes("does-not-exist.sqlite")));
  }

  console.log("--- scenario 5: invalid window is rejected before evaluation ---");
  const reversed = runExplore(["--from", "2026-06-02", "--to", "2026-06-01", "--json"]);
  check("reversed window exits non-zero", reversed.status !== 0);

  console.log("--- scenario 6: ambiguous official winning settlement fails closed ---");
  addDuplicateSettlement(dbPath);
  const ambiguous = runExplore(["--from", "2026-01-01", "--to", "2026-06-01", "--json"]);
  check("duplicate official settlement exits non-zero", ambiguous.status !== 0);
  check("duplicate settlement fails with stable opaque code", ambiguous.stderr.includes("ROI_EXPLORER_OFFICIAL_SETTLEMENT_INTEGRITY_FAILED"));
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.log("");
if (failures > 0) {
  console.error(`FAILED: ${failures} check(s) did not pass`);
  process.exit(1);
}
console.log("OK: all roi-smoke checks passed");

function check(label, ok) {
  console.log(`${ok ? "ok" : "NOT OK"} - ${label}`);
  if (!ok) failures++;
}

function closeTo(actual, expected, epsilon = 1e-6) {
  return Math.abs(actual - expected) < epsilon;
}

function parseJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    check("output is valid JSON", false);
    return null;
  }
}

function runExplore(args, extraEnv = {}) {
  return spawnSync(
    process.execPath,
    ["--experimental-strip-types", join(tempScriptsDir, "explore-roi.ts"), ...args],
    { encoding: "utf8", env: { ...process.env, BOAT_PON_DB_PATH: dbPath, ...extraEnv } },
  );
}

function buildFixtureDb(path) {
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE decision_history (
    id INTEGER PRIMARY KEY, race_id TEXT, date TEXT, venue TEXT, race_no INTEGER, bet_type TEXT, selection TEXT,
    estimated_hit_rate REAL, required_odds REAL, current_odds REAL, ev REAL, decision TEXT,
    actually_bought INTEGER, stake_yen INTEGER, recommended_stake_yen INTEGER, sample_size INTEGER,
    result TEXT, payout_yen INTEGER, popularity INTEGER, returned INTEGER, source TEXT,
    fetched_at TEXT, created_at TEXT);
    CREATE TABLE race_payouts (
      race_id TEXT NOT NULL,
      bet_type TEXT NOT NULL,
      combination TEXT NOT NULL,
      payout_yen INTEGER,
      returned INTEGER NOT NULL DEFAULT 0
    );`);
  const insert = db.prepare(`INSERT INTO decision_history VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const row = (id, overrides) => {
    const base = {
      raceId: "r" + id, date: "2026-02-0" + id, venue: "桐生", raceNo: id, betType: "3連単", selection: "1-2-3",
      estimatedHitRate: 0.2, requiredOdds: 6, currentOdds: 10, ev: 1.2, decision: "BUY",
      actuallyBought: 0, stakeYen: 0, recommendedStakeYen: 100, sampleSize: 500,
      result: "1-2-3", payoutYen: 99999, popularity: 5, returned: 0, source: "fixture",
      fetchedAt: "x", createdAt: "x",
      ...overrides,
    };
    insert.run(
      id, base.raceId, base.date, base.venue, base.raceNo, base.betType, base.selection, base.estimatedHitRate,
      base.requiredOdds, base.currentOdds, base.ev, base.decision, base.actuallyBought, base.stakeYen,
      base.recommendedStakeYen, base.sampleSize, base.result, base.payoutYen, base.popularity,
      base.returned, base.source, base.fetchedAt, base.createdAt,
    );
  };

  row(1, {});
  row(2, { result: "2-1-3", currentOdds: 30, payoutYen: 88888 });
  row(3, { venue: "蒲郡", result: "3-1-2", payoutYen: 77777 });
  row(4, { venue: "蒲郡", decision: "SKIP" });
  row(5, { venue: "蒲郡", result: null });
  row(6, { date: "2027-01-01", venue: "蒲郡", currentOdds: 99 });

  const payout = db.prepare("INSERT INTO race_payouts (race_id, bet_type, combination, payout_yen, returned) VALUES (?,?,?,?,0)");
  payout.run("r1", "trifecta", "1-2-3", 1620);
  payout.run("r2", "trifecta", "2-1-3", 2500);
  payout.run("r3", "trifecta", "3-1-2", 1800);
  payout.run("r6", "trifecta", "1-2-3", 9900);

  db.close();
}

function addDuplicateSettlement(path) {
  const db = new DatabaseSync(path);
  db.prepare("INSERT INTO race_payouts (race_id, bet_type, combination, payout_yen, returned) VALUES (?,?,?,?,0)")
    .run("r1", "trifecta", "1-2-3", 1620);
  db.close();
}

function addExplicitTsExtensions(dir) {
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".ts")) continue;
    const path = join(dir, name);
    const content = readFileSync(path, "utf8");
    const fixed = content
      .replace(/from\s+"(\.\.?\/[^"]+)"/g, (full, spec) => (hasKnownExtension(spec) ? full : full.replace(spec, `${spec}.ts`)));
    if (fixed !== content) writeFileSync(path, fixed, "utf8");
  }
}
