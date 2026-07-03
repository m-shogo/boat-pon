#!/usr/bin/env node
/**
 * Dependency-free smoke test for scripts/explore-roi.ts.
 *
 * Use when node_modules (tsx/typescript) is unavailable. Builds a small
 * throwaway SQLite fixture DB (node:sqlite, a Node built-in), runs a copy of
 * explore-roi.ts against it via `node --experimental-strip-types` (with
 * `.ts` added to extensionless relative imports, same approach as
 * verify-strip-types.mjs), and asserts the JSON output has the required
 * RuleEvaluationResult shape and expected ROI numbers for a hand-computed
 * fixture. Everything is created under a temp directory and removed after.
 *
 * This is NOT a replacement for `pnpm explore:roi -- --json` against the
 * real project DB — it only proves the CLI and the payout_yen/current_odds
 * basis logic still work end-to-end without node_modules. See
 * docs/ai/05-VERIFICATION.md.
 */

import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

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
const tempDir = mkdtempSync(join(tmpdir(), "boatpon-verify-roi-smoke-"));
const tempDomainDir = join(tempDir, "src", "domain");
const tempScriptsDir = join(tempDir, "scripts");
const dbPath = join(tempDir, "fixture.sqlite");

let failures = 0;

try {
  mkdirSync(tempDomainDir, { recursive: true });
  mkdirSync(tempScriptsDir, { recursive: true });
  for (const name of ["types.ts", "backtest.ts", "researchRule.ts", "researchEvaluation.ts"]) {
    copyFileSync(join(domainDir, name), join(tempDomainDir, name));
  }
  copyFileSync(join(repoRoot, "scripts", "explore-roi.ts"), join(tempScriptsDir, "explore-roi.ts"));
  addExplicitTsExtensions(tempDomainDir);
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
    check("sampleSize is 3 (settled BUY rows in window)", fullResult.metadata.sampleSize === 3);
    check("roi is 15.4 (mixed payout_yen/current_odds basis)", closeTo(fullResult.roi, 15.4));
    check("roi basis mentions mixed", fullResult.reasonSummary.includes("mixed"));
    check("warns about payout_yen fallback", fullResult.warnings.some((w) => w.includes("lack payout_yen")));
  }

  console.log("--- scenario 2: --condition venue=桐生 ---");
  const filtered = runExplore(["--from", "2026-01-01", "--to", "2026-06-01", "--condition", "venue=桐生", "--json"]);
  check("exit code 0", filtered.status === 0);
  const filteredResult = parseJson(filtered.stdout);
  if (filteredResult) {
    check("condition narrows sampleSize to 2", filteredResult.metadata.sampleSize === 2);
    check("roi is 23.1 with venue filter", closeTo(filteredResult.roi, 23.1));
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
    check("missing DB warns about it", noDbResult.warnings.some((w) => w.includes("db not found")));
  }
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
    id INTEGER PRIMARY KEY, race_id TEXT, date TEXT, venue TEXT, race_no INTEGER, selection TEXT,
    estimated_hit_rate REAL, required_odds REAL, current_odds REAL, ev REAL, decision TEXT,
    actually_bought INTEGER, stake_yen INTEGER, recommended_stake_yen INTEGER, sample_size INTEGER,
    result TEXT, payout_yen INTEGER, popularity INTEGER, returned INTEGER, source TEXT,
    fetched_at TEXT, created_at TEXT)`);
  const insert = db.prepare(`INSERT INTO decision_history VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const row = (id, overrides) => {
    const base = {
      raceId: "r" + id, date: "2026-02-0" + id, venue: "桐生", raceNo: id, selection: "1-2-3",
      estimatedHitRate: 0.2, requiredOdds: 6, currentOdds: 10, ev: 1.2, decision: "BUY",
      actuallyBought: 0, stakeYen: 0, recommendedStakeYen: 100, sampleSize: 500,
      result: "1-2-3", payoutYen: null, popularity: 5, returned: 0, source: "fixture",
      fetchedAt: "x", createdAt: "x",
      ...overrides,
    };
    insert.run(
      id, base.raceId, base.date, base.venue, base.raceNo, base.selection, base.estimatedHitRate,
      base.requiredOdds, base.currentOdds, base.ev, base.decision, base.actuallyBought, base.stakeYen,
      base.recommendedStakeYen, base.sampleSize, base.result, base.payoutYen, base.popularity,
      base.returned, base.source, base.fetchedAt, base.createdAt,
    );
  };

  // row1: 桐生, hit, payout_yen present (1620/100yen) -> realized 1620
  row(1, { payoutYen: 1620 });
  // row2: 桐生, hit, payout_yen missing -> fallback to currentOdds(30)*100=3000
  row(2, { currentOdds: 30, payoutYen: null });
  // row3: 蒲郡, miss -> realized 0 regardless of basis
  row(3, { venue: "蒲郡", result: "3-1-2", payoutYen: 500 });
  // row4: 蒲郡, SKIP -> excluded from BUY aggregation
  row(4, { venue: "蒲郡", decision: "SKIP" });
  // row5: 蒲郡, unsettled BUY -> excluded from settled aggregation
  row(5, { venue: "蒲郡", result: null });
  // row6: out of window (2027) -> excluded by date filter
  row(6, { date: "2027-01-01", venue: "蒲郡", currentOdds: 99, payoutYen: null });

  db.close();
}

function addExplicitTsExtensions(dir) {
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".ts")) continue;
    const path = join(dir, name);
    const content = readFileSync(path, "utf8");
    const fixed = content
      .replace(/from\s+"(\.\.?\/[^"]+)"/g, (full, spec) => (/\.[a-zA-Z]+$/.test(spec) ? full : full.replace(spec, `${spec}.ts`)));
    if (fixed !== content) writeFileSync(path, fixed, "utf8");
  }
}
