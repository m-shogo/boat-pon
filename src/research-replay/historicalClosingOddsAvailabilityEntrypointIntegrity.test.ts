import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/audit-historical-closing-odds-availability.ts", "utf8");
const internal = readFileSync("scripts/audit-historical-closing-odds-availability-internal.ts", "utf8");

test("historical closing-odds audit entrypoint verifies canonical read-only DB without leaking configured paths", () => {
  assert.match(entrypoint, /assertCanonicalSingleLinkRegularFile/u);
  assert.match(entrypoint, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/u);
  assert.match(entrypoint, /PRAGMA query_only\s*=\s*ON/u);
  assert.match(entrypoint, /research database unavailable/u);
  assert.doesNotMatch(entrypoint, /DB not found: \$\{DB_PATH\}/u);
});

test("historical closing-odds audit fails closed on bet-type or return-state drift before implementation import", () => {
  assert.match(entrypoint, /dh\.bet_type IS NULL OR dh\.bet_type != '3連単'/u);
  assert.match(entrypoint, /dh\.returned IS NULL OR dh\.returned != 0/u);
  assert.match(entrypoint, /HISTORICAL_CLOSING_ODDS_AUDIT_DECISION_COHORT_INVALID/u);

  const guardQuery = entrypoint.indexOf("const invalidCohort = db.prepare");
  const guardFailure = entrypoint.indexOf("HISTORICAL_CLOSING_ODDS_AUDIT_DECISION_COHORT_INVALID");
  const implementationImport = entrypoint.indexOf("audit-historical-closing-odds-availability-internal");
  assert.ok(guardQuery >= 0, "cohort integrity query must exist");
  assert.ok(guardFailure > guardQuery, "cohort integrity failure must follow the query");
  assert.ok(implementationImport > guardFailure, "archive/cache implementation must load only after the cohort guard");
});

test("historical closing-odds implementation remains read-only and scoped to historical-backfill BUY", () => {
  assert.match(internal, /new DatabaseSync\(DB_PATH, \{ readOnly: true \}\)/u);
  assert.match(internal, /dh\.decision='BUY' AND dh\.run_kind='historical-backfill'/u);
  assert.doesNotMatch(internal, /db\.(?:exec|prepare)\([^)]*(?:INSERT|UPDATE|DELETE|DROP)/iu);
});
