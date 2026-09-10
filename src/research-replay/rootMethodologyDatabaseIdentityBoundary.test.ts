import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("root methodology internal verifies primary database identity before opening read-only", () => {
  const source = readFileSync("scripts/audit-root-methodology-internal.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile/);
  assert.match(source, /ROOT_METHODOLOGY_PRIMARY_DB_IDENTITY_INVALID/);
  assert.match(source, /const db = new DatabaseSync\(primaryDbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.doesNotMatch(source, /new DatabaseSync\(DB_PATH/);
});

test("root methodology guarded entrypoint reverifies DB identity after cohort preflight", () => {
  const source = readFileSync("scripts/audit-root-methodology.ts", "utf8");
  const primaryIdentity = source.indexOf("ROOT_METHODOLOGY_PRIMARY_DB_IDENTITY_INVALID");
  const cohortGate = source.indexOf("ROOT_METHODOLOGY_FORWARD_COHORT_INVALID");
  const close = source.lastIndexOf("db.close()");
  const handoffIdentity = source.indexOf("ROOT_METHODOLOGY_DB_HANDOFF_IDENTITY_INVALID");
  const internal = source.indexOf("await import(\"./audit-root-methodology-internal\")");

  assert.ok(primaryIdentity >= 0);
  assert.ok(cohortGate > primaryIdentity);
  assert.ok(close > cohortGate);
  assert.ok(handoffIdentity > close, "handoff identity must be checked after the preflight DB closes");
  assert.ok(internal > handoffIdentity, "internal audit must start only after handoff identity revalidation");
  assert.match(source, /BOAT_PON_DB_PATH = handoffDbPath/);
});
