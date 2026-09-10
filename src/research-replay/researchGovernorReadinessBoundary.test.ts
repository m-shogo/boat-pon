import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/report-research-governor.ts", "utf8");
const preflight = readFileSync("scripts/audit-research-governor-readiness.ts", "utf8");
const internal = readFileSync("scripts/report-research-governor-internal.ts", "utf8");

test("research governor cannot publish readiness before its integrity preflight", () => {
  const audit = entrypoint.indexOf('run("scripts/audit-research-governor-readiness.ts")');
  const guard = entrypoint.indexOf("if (preflight !== 0)");
  const handoffIdentity = entrypoint.indexOf("RESEARCH_GOVERNOR_DB_HANDOFF_IDENTITY_INVALID");
  const envHandoff = entrypoint.indexOf("process.env.BOAT_PON_DB_PATH = handoffDbPath");
  const report = entrypoint.indexOf('await import("./report-research-governor-raw")');
  assert.ok(audit >= 0 && guard > audit && handoffIdentity > guard && envHandoff > handoffIdentity && report > envHandoff);
  assert.match(entrypoint, /process\.exit\(preflight\)/);
  assert.match(entrypoint, /RESEARCH_GOVERNOR_DB_MISSING/);
  assert.match(entrypoint, /assertCanonicalSingleLinkRegularFile\(\s*DB_PATH,/u);
  assert.match(entrypoint, /process\.env\.BOAT_PON_DB_PATH = handoffDbPath/u);
  assert.doesNotMatch(entrypoint, /run\("scripts\/report-research-governor-raw\.ts"/u);
});

test("research governor readiness rejects decision cohort drift and misleading non-canonical trifecta coverage", () => {
  assert.match(preflight, /assertCanonicalSingleLinkRegularFile\(DB_PATH/);
  assert.match(preflight, /readOnly: true/);
  assert.match(preflight, /PRAGMA query_only = ON/);
  assert.match(preflight, /dh\.bet_type IS NULL OR dh\.bet_type != '3連単'/);
  assert.match(preflight, /dh\.returned IS NULL OR dh\.returned != 0/);
  assert.match(preflight, /h\.bet_type='trifecta'/);
  assert.match(preflight, /historicalTrifectaCanonicalSourcePredicate\("h"\)/);
  assert.match(preflight, /historicalTrifectaCompleteMarketPredicate\("h\.race_id"\)/);
  assert.match(preflight, /RESEARCH_GOVERNOR_TRIFECTA_COVERAGE_INVALID/);
});

test("legacy governor remains report-only behind the guard", () => {
  assert.match(internal, /new DatabaseSync\(DB_PATH, \{ readOnly: true \}\)/);
  assert.match(internal, /app_settings \/ 本番 decision \/ 自動投票 は絶対に変更しない/);
  assert.match(internal, /futureOnlySwitchReady/);
});
