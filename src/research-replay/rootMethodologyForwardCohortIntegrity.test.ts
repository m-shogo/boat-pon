import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/audit-root-methodology.ts", "utf8");
const internal = readFileSync("scripts/audit-root-methodology-internal.ts", "utf8");

test("root methodology fails closed on governor-forward cohort drift before implementation load", () => {
  assert.match(entrypoint, /dh\.bet_type IS NULL OR dh\.bet_type != '3連単'/u);
  assert.match(entrypoint, /dh\.returned IS NULL OR dh\.returned != 0/u);
  assert.match(entrypoint, /dh\.date >= '2025-01-01'/u);
  assert.match(entrypoint, /dh\.race_no NOT IN \(10,11,12\)/u);
  assert.match(entrypoint, /ROOT_METHODOLOGY_FORWARD_COHORT_INVALID/u);

  const guard = entrypoint.indexOf("const invalidForwardCohort = db.prepare");
  const failure = entrypoint.indexOf("ROOT_METHODOLOGY_FORWARD_COHORT_INVALID");
  const implementationImport = entrypoint.indexOf("audit-root-methodology-internal");
  assert.ok(guard >= 0, "forward cohort guard must exist");
  assert.ok(failure > guard, "forward cohort failure must follow the query");
  assert.ok(implementationImport > failure, "methodology report must load only after cohort validation");
});

test("root methodology guarded entrypoint preserves canonical read-only database boundary", () => {
  assert.match(entrypoint, /assertCanonicalSingleLinkRegularFile/u);
  assert.match(entrypoint, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/u);
  assert.match(entrypoint, /PRAGMA query_only=ON/u);
});

test("root methodology implementation remains read-only and does not alter paper-live criteria", () => {
  assert.match(internal, /run_kind='paper-live' AND model_version='boatpon-v3-alpha15'/u);
  assert.match(internal, /new DatabaseSync\(primaryDbPath, \{ readOnly: true \}\)/u);
  assert.doesNotMatch(internal, /db\.(?:exec|prepare)\([^)]*(?:INSERT|UPDATE|DELETE|DROP|ALTER)/iu);
});
