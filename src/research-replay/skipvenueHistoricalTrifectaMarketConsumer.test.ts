import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entry = readFileSync("scripts/analyze-skipvenue-switch-historical-closing-odds.ts", "utf8");
const internal = readFileSync("scripts/analyze-skipvenue-switch-historical-closing-odds-internal.ts", "utf8");
const raw = readFileSync("scripts/analyze-skipvenue-switch-historical-closing-odds-raw.ts", "utf8");

test("skipVenue historical switch uses the shared canonical trifecta market authority", () => {
  assert.match(internal, /historicalTrifectaCanonicalSourcePredicate\("h"\)/);
  assert.match(internal, /historicalTrifectaCompleteMarketPredicate\("h\.race_id"\)/);
  assert.match(internal, /h\.bet_type = 'trifecta'/);
  assert.doesNotMatch(internal, /WHERE source_quality = 'historical_closing_odds'/);
});

test("skipVenue historical switch internal independently fails closed before SQLite reads", () => {
  const directGuard = internal.indexOf("SKIPVENUE_SWITCH_HISTORICAL_INTERNAL_DIRECT_EXECUTION_FORBIDDEN");
  const missing = internal.indexOf("SKIPVENUE_SWITCH_HISTORICAL_INTERNAL_DB_MISSING");
  const identity = internal.indexOf("SKIPVENUE_SWITCH_HISTORICAL_INTERNAL_DB_IDENTITY_INVALID");
  const open = internal.indexOf("new DatabaseSync(verifiedDbPath, { readOnly: true })");
  const queryOnly = internal.indexOf("PRAGMA query_only = ON");

  assert.ok(directGuard >= 0, "internal analyzer must reject direct CLI execution");
  assert.ok(missing > directGuard, "DB existence check must follow the direct-execution guard");
  assert.ok(identity > missing, "DB identity must be revalidated before SQLite open");
  assert.ok(open > identity, "SQLite must open only the revalidated DB path");
  assert.ok(queryOnly > open, "SQLite connection must be forced query-only after read-only open");
  assert.match(internal, /assertCanonicalSingleLinkRegularFile/);
  assert.doesNotMatch(internal, /DB not found: \$\{DB_PATH\}/);
  assert.doesNotMatch(internal, /new DatabaseSync\(DB_PATH/);
  assert.doesNotMatch(internal, /db\.(?:exec|prepare)\(\s*[`"']\s*(?:INSERT|UPDATE|DELETE|DROP)\b/i);
});

test("skipVenue canonical entrypoint owns settlement preflight and the internal handoff", () => {
  const audit = entry.indexOf('run("scripts/audit-skipvenue-historical-payout-completeness.ts")');
  const gate = entry.indexOf("audit !== 0");
  const identity = entry.indexOf("SKIPVENUE_SWITCH_HISTORICAL_DB_HANDOFF_IDENTITY_INVALID");
  const internalImport = entry.indexOf('await import("./analyze-skipvenue-switch-historical-closing-odds-internal")');

  assert.ok(audit >= 0);
  assert.ok(gate > audit, "settlement audit must fail closed before analysis");
  assert.ok(identity > gate, "DB identity must be revalidated after settlement preflight");
  assert.ok(internalImport > identity, "internal analyzer must run only after the canonical handoff identity check");
  assert.doesNotMatch(entry, /analyze-skipvenue-switch-historical-closing-odds-raw/);
});

test("skipVenue raw compatibility path cannot bypass canonical settlement preflight", () => {
  assert.match(raw, /SKIPVENUE_SWITCH_HISTORICAL_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(raw, /invokedPath === rawEntrypointPath/);
  assert.match(raw, /await import\("\.\/analyze-skipvenue-switch-historical-closing-odds"\)/);
  assert.doesNotMatch(raw, /analyze-skipvenue-switch-historical-closing-odds-internal/);
  assert.doesNotMatch(raw, /assertCanonicalSingleLinkRegularFile/);
});