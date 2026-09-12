import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-condb-switch-historical-closing-odds.ts", "utf8");
const raw = readFileSync("scripts/analyze-condb-switch-historical-closing-odds-raw.ts", "utf8");
const internal = readFileSync("scripts/analyze-condb-switch-historical-closing-odds-internal.ts", "utf8");

test("condB raw compatibility path cannot bypass canonical payout preflight", () => {
  assert.match(raw, /CONDB_SWITCH_HISTORICAL_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(raw, /await import\("\.\/analyze-condb-switch-historical-closing-odds"\)/);
  assert.doesNotMatch(raw, /BOAT_PON_DB_PATH/);
  assert.doesNotMatch(raw, /assertCanonicalSingleLinkRegularFile/);
  assert.doesNotMatch(raw, /analyze-condb-switch-historical-closing-odds-internal/);

  const guard = raw.indexOf("CONDB_SWITCH_HISTORICAL_RAW_DIRECT_EXECUTION_FORBIDDEN");
  const canonicalImport = raw.indexOf('await import("./analyze-condb-switch-historical-closing-odds")');
  assert.ok(guard >= 0 && canonicalImport > guard);
});

test("condB canonical entrypoint enters isolated internal only after payout preflight and DB launch revalidation", () => {
  const audit = entrypoint.indexOf("audit-condb-switch-historical-payout-completeness.ts");
  const handoff = entrypoint.indexOf("CONDB_SWITCH_HISTORICAL_DB_HANDOFF_IDENTITY_INVALID");
  const launchIdentity = entrypoint.indexOf("CONDB_SWITCH_HISTORICAL_DB_CHILD_LAUNCH_IDENTITY_INVALID");
  const internalLaunch = entrypoint.indexOf("const analysis = spawnSync");
  assert.ok(audit >= 0);
  assert.ok(handoff > audit);
  assert.ok(launchIdentity > handoff);
  assert.ok(internalLaunch > launchIdentity);
  assert.match(entrypoint, /cwd: workspace/);
  assert.doesNotMatch(entrypoint, /analyze-condb-switch-historical-closing-odds-raw/);
  assert.doesNotMatch(entrypoint, /await import\("\.\/analyze-condb-switch-historical-closing-odds-internal"\)/);
});

test("condB internal analyzer revalidates the DB and remains query-only", () => {
  assert.match(internal, /CONDB_SWITCH_HISTORICAL_INTERNAL_DB_MISSING/);
  assert.match(internal, /CONDB_SWITCH_HISTORICAL_INTERNAL_DB_IDENTITY_INVALID/);
  assert.match(internal, /assertCanonicalSingleLinkRegularFile/);
  assert.match(internal, /new DatabaseSync\(verifiedDbPath, \{ readOnly: true \}\)/);
  assert.match(internal, /PRAGMA query_only = ON/);
  assert.doesNotMatch(internal, /DB not found: \$\{/);
  assert.doesNotMatch(internal, /db\.(?:exec|prepare)\(\s*[`\"']\s*(?:INSERT|UPDATE|DELETE|DROP)\b/i);

  const identity = internal.indexOf("CONDB_SWITCH_HISTORICAL_INTERNAL_DB_IDENTITY_INVALID");
  const dbOpen = internal.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  const queryOnly = internal.indexOf('db.exec("PRAGMA query_only = ON;")');
  assert.ok(identity >= 0 && dbOpen > identity && queryOnly > dbOpen);
});