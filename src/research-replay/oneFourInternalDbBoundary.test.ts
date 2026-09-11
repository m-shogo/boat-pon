import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entrypoint = readFileSync("scripts/analyze-one-four-structure.ts", "utf8");
const raw = readFileSync("scripts/analyze-one-four-structure-raw.ts", "utf8");
const internal = readFileSync("scripts/analyze-one-four-structure-internal.ts", "utf8");

test("one-four canonical entrypoint revalidates DB after payout audit and immediately before internal analysis", () => {
  const audit = entrypoint.indexOf("audit !== 0");
  const handoffIdentity = entrypoint.indexOf("ONE_FOUR_STRUCTURE_DB_HANDOFF_IDENTITY_INVALID");
  const mdPreflight = entrypoint.indexOf("ONE_FOUR_STRUCTURE_MD_PREEXISTING_IDENTITY_INVALID", handoffIdentity);
  const jsonPreflight = entrypoint.indexOf("ONE_FOUR_STRUCTURE_JSON_PREEXISTING_IDENTITY_INVALID", handoffIdentity);
  const childIdentity = entrypoint.indexOf("ONE_FOUR_STRUCTURE_DB_CHILD_HANDOFF_IDENTITY_INVALID", jsonPreflight);
  const childEnv = entrypoint.indexOf("process.env.BOAT_PON_DB_PATH = childDbPath", childIdentity);
  const internalImport = entrypoint.indexOf('await import("./analyze-one-four-structure-internal")');

  assert.ok(audit >= 0);
  assert.ok(handoffIdentity > audit, "DB identity must be revalidated only after payout audit passes");
  assert.ok(mdPreflight > handoffIdentity && jsonPreflight > handoffIdentity, "report paths must be checked after initial DB handoff");
  assert.ok(childIdentity > mdPreflight && childIdentity > jsonPreflight, "DB identity must be revalidated after report-path checks");
  assert.ok(childEnv > childIdentity, "only the final reverified DB path may be exported to the internal analyzer");
  assert.ok(internalImport > childEnv, "internal analyzer must load only after the final verified DB handoff");
  assert.match(entrypoint, /ONE_FOUR_STRUCTURE_DB_MISSING/);
  assert.match(entrypoint, /process\.env\.BOAT_PON_DB_PATH = handoffDbPath/);
  assert.match(entrypoint, /process\.env\.BOAT_PON_DB_PATH = childDbPath/);
  assert.doesNotMatch(entrypoint, /analyze-one-four-structure-raw/);
});

test("one-four canonical entrypoint protects generated report identities around internal execution", () => {
  const mdPreflight = entrypoint.indexOf("ONE_FOUR_STRUCTURE_MD_PREEXISTING_IDENTITY_INVALID");
  const jsonPreflight = entrypoint.indexOf("ONE_FOUR_STRUCTURE_JSON_PREEXISTING_IDENTITY_INVALID");
  const internalImport = entrypoint.indexOf('await import("./analyze-one-four-structure-internal")');
  const outputMissing = entrypoint.indexOf("ONE_FOUR_STRUCTURE_OUTPUT_MISSING");
  const mdPostflight = entrypoint.indexOf("ONE_FOUR_STRUCTURE_MD_OUTPUT_IDENTITY_INVALID");
  const jsonPostflight = entrypoint.indexOf("ONE_FOUR_STRUCTURE_JSON_OUTPUT_IDENTITY_INVALID");

  assert.ok(mdPreflight >= 0 && jsonPreflight >= 0);
  assert.ok(mdPreflight < internalImport && jsonPreflight < internalImport, "existing report paths must be identity-checked before legacy writes");
  assert.ok(outputMissing > internalImport, "successful internal execution must still prove both outputs exist");
  assert.ok(mdPostflight > outputMissing && jsonPostflight > outputMissing, "generated outputs must be canonical single-link files before success");
});

test("one-four guarded raw compatibility module cannot bypass canonical payout audit", () => {
  assert.match(raw, /ONE_FOUR_STRUCTURE_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(raw, /await import\("\.\/analyze-one-four-structure"\)/);
  assert.doesNotMatch(raw, /analyze-one-four-structure-internal/);
  assert.doesNotMatch(raw, /BOAT_PON_DB_PATH/);
  assert.doesNotMatch(raw, /DatabaseSync/);
});

test("one-four internal verifies canonical DB identity and enables query_only before analysis", () => {
  const identity = internal.indexOf("ONE_FOUR_STRUCTURE_DB_IDENTITY_INVALID");
  const open = internal.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  const queryOnly = internal.indexOf("PRAGMA query_only = ON");
  const firstQuery = internal.indexOf("db.prepare(");

  assert.match(internal, /assertCanonicalSingleLinkRegularFile/u);
  assert.ok(identity >= 0, "internal DB identity error code must exist");
  assert.ok(open > identity, "internal must verify DB identity before SQLite open");
  assert.ok(queryOnly > open, "internal must enable query_only after read-only open");
  assert.ok(firstQuery > queryOnly, "internal must enable query_only before analysis queries");
  assert.doesNotMatch(internal, /DB not found: \$\{DB_PATH\}/u);
  assert.doesNotMatch(internal, /new DatabaseSync\(DB_PATH, \{ readOnly: true \}\)/u);
});
