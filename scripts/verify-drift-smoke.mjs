#!/usr/bin/env node
/**
 * Dependency-free smoke test for scripts/detect-research-drift.ts.
 *
 * Use when node_modules (tsx/typescript) is unavailable. Builds a small
 * throwaway SQLite fixture DB (node:sqlite, a Node built-in) with a
 * profitable baseline window and an unprofitable recent window, runs a copy
 * of detect-research-drift.ts against it via `node --experimental-strip-types`
 * (with `.ts` added to extensionless relative imports, same approach as
 * verify-roi-smoke.mjs / verify-strip-types.mjs), and asserts:
 *   - the JSON output has the required DriftDetectionResult shape (--json)
 *   - severity reflects the injected roi collapse
 *   - --presentation-json (Phase 4.1) has the required DriftDetectionPresentation shape
 *   - --rule-id + a fixture data/research-rules.json attaches title/status without
 *     ever writing to that file (read-only lookup)
 *   - the fixture DB file is byte-for-byte unchanged after the CLI runs
 *     (proves the CLI is read-only, never writes to decision_history)
 *
 * This is NOT a replacement for `pnpm detect:drift -- --json` against the
 * real project DB — it only proves the CLI and drift-detection wiring work
 * end-to-end without node_modules. See docs/ai/05-VERIFICATION.md.
 */

import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const KNOWN_EXTENSIONS = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "json"]);

/** MIN_DRIFT_SAMPLE_SIZE (src/domain/researchDrift.ts) is 30; each window needs >= that many settled BUY rows to exercise the roi-delta/collapse logic instead of the "sample too small" bail-out. */
const ROWS_PER_WINDOW = 30;

/**
 * A naive `/\.[a-zA-Z]+$/` check misfires on specifiers with a dot in the
 * filename but no real extension (e.g. "./researchViewModel.adapters") — only
 * treat it as "already has an extension" if the suffix is a known one.
 */
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
const viewModelsDir = join(repoRoot, "src", "view-models");
const presentationDir = join(repoRoot, "src", "presentation");
const tempDir = mkdtempSync(join(tmpdir(), "boatpon-verify-drift-smoke-"));
const tempDomainDir = join(tempDir, "src", "domain");
const tempViewModelsDir = join(tempDir, "src", "view-models");
const tempPresentationDir = join(tempDir, "src", "presentation");
const tempScriptsDir = join(tempDir, "scripts");
const dbPath = join(tempDir, "fixture.sqlite");
const ruleStorePath = join(tempDir, "research-rules-fixture.json");

let failures = 0;

try {
  mkdirSync(tempDomainDir, { recursive: true });
  mkdirSync(tempViewModelsDir, { recursive: true });
  mkdirSync(tempPresentationDir, { recursive: true });
  mkdirSync(tempScriptsDir, { recursive: true });
  for (const name of ["types.ts", "backtest.ts", "researchRule.ts", "researchEvaluation.ts", "researchDrift.ts"]) {
    copyFileSync(join(domainDir, name), join(tempDomainDir, name));
  }
  for (const name of ["driftViewModel.ts", "driftViewModel.adapters.ts"]) {
    copyFileSync(join(viewModelsDir, name), join(tempViewModelsDir, name));
  }
  for (const name of ["driftPresentationModel.ts", "driftPresentationBuilder.ts"]) {
    copyFileSync(join(presentationDir, name), join(tempPresentationDir, name));
  }
  copyFileSync(join(repoRoot, "scripts", "detect-research-drift.ts"), join(tempScriptsDir, "detect-research-drift.ts"));
  addExplicitTsExtensions(tempDomainDir);
  addExplicitTsExtensions(tempViewModelsDir);
  addExplicitTsExtensions(tempPresentationDir);
  addExplicitTsExtensions(tempScriptsDir);

  buildFixtureDb(dbPath);
  const dbHashBefore = hashFile(dbPath);

  console.log("--- scenario 1: profitable baseline vs unprofitable recent -> drift detected (--json) ---");
  const drifted = runDetect([
    "--baseline-from", "2025-01-01", "--baseline-to", "2025-06-01",
    "--recent-from", "2026-01-01", "--recent-to", "2026-06-01",
    "--json",
  ]);
  check("exit code 0", drifted.status === 0);
  const driftedResult = parseJson(drifted.stdout);
  if (driftedResult) {
    for (const field of [
      "ruleId", "baselineWindow", "recentWindow", "baselineRoi", "recentRoi", "roiDelta",
      "baselineHitRate", "recentHitRate", "hitRateDelta", "baselineSampleSize", "recentSampleSize",
      "severity", "signals", "warnings", "evaluatedAt",
    ]) {
      check(`result has field "${field}"`, field in driftedResult);
    }
    check(`baselineSampleSize is ${ROWS_PER_WINDOW} (settled BUY rows in baseline window)`, driftedResult.baselineSampleSize === ROWS_PER_WINDOW);
    check(`recentSampleSize is ${ROWS_PER_WINDOW} (settled BUY rows in recent window)`, driftedResult.recentSampleSize === ROWS_PER_WINDOW);
    check("baseline roi is at/above breakeven", driftedResult.baselineRoi >= 1);
    check("recent roi is below breakeven", driftedResult.recentRoi < 1);
    check("severity is critical", driftedResult.severity === "critical");
    check("signals include roiCollapse", driftedResult.signals.some((s) => s.id === "roiCollapse"));
  }

  console.log("--- scenario 2: no DB present ---");
  const noDb = runDetect(
    ["--baseline-from", "2025-01-01", "--baseline-to", "2025-06-01", "--recent-from", "2026-01-01", "--recent-to", "2026-06-01", "--json"],
    { BOAT_PON_DB_PATH: join(tempDir, "does-not-exist.sqlite") },
  );
  check("missing DB still exits 0", noDb.status === 0);
  const noDbResult = parseJson(noDb.stdout);
  if (noDbResult) {
    check("missing DB reports 0 sample on both windows", noDbResult.baselineSampleSize === 0 && noDbResult.recentSampleSize === 0);
    check("missing DB severity is unknown (0 recent sample)", noDbResult.severity === "unknown");
  }

  console.log("--- scenario 3: --presentation-json (Phase 4.1, adhoc rule, no research-rules.json fixture) ---");
  const presented = runDetect([
    "--baseline-from", "2025-01-01", "--baseline-to", "2025-06-01",
    "--recent-from", "2026-01-01", "--recent-to", "2026-06-01",
    "--rule-id", "adhoc-not-registered",
    "--presentation-json",
  ], { BOAT_PON_RULE_STORE_PATH: ruleStorePath }); // path does not exist yet -> adhoc
  check("presentation-json exit code 0", presented.status === 0);
  const presentedResult = parseJson(presented.stdout);
  if (presentedResult) {
    for (const field of [
      "ruleId", "ruleTitle", "ruleStatus", "severity", "severityLabel", "baselineRoi", "recentRoi",
      "roiDelta", "baselineSampleSize", "recentSampleSize", "signals", "warnings", "reasonSummary", "evaluatedAt",
    ]) {
      check(`presentation has field "${field}"`, field in presentedResult);
    }
    check("unregistered rule-id -> ruleTitle is null", presentedResult.ruleTitle === null);
    check("unregistered rule-id -> ruleStatus is null", presentedResult.ruleStatus === null);
    check("severityLabel is a non-empty display string", typeof presentedResult.severityLabel === "string" && presentedResult.severityLabel.length > 0);
  }

  console.log("--- scenario 4: --rule-id reads data/research-rules.json but never writes it ---");
  const ruleStoreFixture = {
    _meta: { description: "smoke fixture", warning: "smoke fixture", lastUpdated: "2026-01-01T00:00:00Z" },
    rules: [
      {
        ruleId: "wind24-exh1-switch", status: "forward", createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z", reasonSummary: "smoke fixture rule", warnings: [],
        title: "風速2-4x展示1位",
      },
    ],
  };
  writeFileSync(ruleStorePath, `${JSON.stringify(ruleStoreFixture, null, 2)}\n`, "utf8");
  const ruleStoreHashBefore = hashFile(ruleStorePath);
  const withRuleMeta = runDetect([
    "--baseline-from", "2025-01-01", "--baseline-to", "2025-06-01",
    "--recent-from", "2026-01-01", "--recent-to", "2026-06-01",
    "--rule-id", "wind24-exh1-switch",
    "--presentation-json",
  ], { BOAT_PON_RULE_STORE_PATH: ruleStorePath });
  check("rule-id lookup exit code 0", withRuleMeta.status === 0);
  const withRuleMetaResult = parseJson(withRuleMeta.stdout);
  if (withRuleMetaResult) {
    check("registered rule-id -> ruleTitle attached", withRuleMetaResult.ruleTitle === "風速2-4x展示1位");
    check("registered rule-id -> ruleStatus attached", withRuleMetaResult.ruleStatus === "forward");
    check(
      "status != production -> warnings note it is not a confirmed production incident",
      withRuleMetaResult.warnings.some((w) => w.includes("do not treat this drift as a confirmed production incident")),
    );
  }
  check("research-rules.json fixture is byte-for-byte unchanged after the CLI runs (read-only)", hashFile(ruleStorePath) === ruleStoreHashBefore);

  console.log("--- scenario 5: CLI never writes to the fixture DB ---");
  check("fixture DB file is byte-for-byte unchanged after running the CLI multiple times", hashFile(dbPath) === dbHashBefore);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.log("");
if (failures > 0) {
  console.error(`FAILED: ${failures} check(s) did not pass`);
  process.exit(1);
}
console.log("OK: all drift-smoke checks passed");

function check(label, ok) {
  console.log(`${ok ? "ok" : "NOT OK"} - ${label}`);
  if (!ok) failures++;
}

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function parseJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    check("output is valid JSON", false);
    return null;
  }
}

function runDetect(args, extraEnv = {}) {
  return spawnSync(
    process.execPath,
    ["--experimental-strip-types", join(tempScriptsDir, "detect-research-drift.ts"), ...args],
    { encoding: "utf8", env: { ...process.env, BOAT_PON_DB_PATH: dbPath, ...extraEnv } },
  );
}

function isoDate(base, offsetDays) {
  const d = new Date(base + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
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
      raceId: "r" + id, date: "2025-02-01", venue: "桐生", raceNo: 1, selection: "1-2-3",
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

  // baseline window (2025-02..): ROWS_PER_WINDOW hits, payout_yen present -> profitable (roi >= 1.0)
  for (let i = 0; i < ROWS_PER_WINDOW; i++) {
    row(i + 1, { date: isoDate("2025-02-01", i), payoutYen: 180 });
  }

  // recent window (2026-02..): ROWS_PER_WINDOW misses -> realized 0, roi collapses to 0
  for (let i = 0; i < ROWS_PER_WINDOW; i++) {
    row(ROWS_PER_WINDOW + i + 1, { date: isoDate("2026-02-01", i), result: "3-1-2", payoutYen: 500 });
  }
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
