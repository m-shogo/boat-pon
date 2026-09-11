import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entry = readFileSync("scripts/analyze-skip6r-switch-historical-closing-odds.ts", "utf8");
const internal = readFileSync("scripts/analyze-skip6r-switch-historical-closing-odds-internal.ts", "utf8");
const raw = readFileSync("scripts/analyze-skip6r-switch-historical-closing-odds-raw.ts", "utf8");

test("skip6R historical switch uses the shared canonical trifecta market authority", () => {
  assert.match(internal, /historicalTrifectaCanonicalSourcePredicate\("h"\)/);
  assert.match(internal, /historicalTrifectaCompleteMarketPredicate\("h\.race_id"\)/);
  assert.match(internal, /h\.bet_type = 'trifecta'/);
  assert.doesNotMatch(internal, /WHERE source_quality = 'historical_closing_odds'/);
});

test("skip6R canonical entrypoint owns settlement preflight and the internal handoff", () => {
  const audit = entry.indexOf('run("scripts/audit-skip6r-historical-payout-completeness.ts")');
  const gate = entry.indexOf("audit !== 0");
  const identity = entry.indexOf("SKIP6R_SWITCH_HISTORICAL_DB_HANDOFF_IDENTITY_INVALID");
  const internalImport = entry.indexOf('await import("./analyze-skip6r-switch-historical-closing-odds-internal")');

  assert.ok(audit >= 0);
  assert.ok(gate > audit, "settlement audit must fail closed before analysis");
  assert.ok(identity > gate, "DB identity must be revalidated after settlement preflight");
  assert.ok(internalImport > identity, "internal analyzer must run only after the canonical handoff identity check");
  assert.doesNotMatch(entry, /analyze-skip6r-switch-historical-closing-odds-raw/);
});

test("skip6R raw compatibility path cannot bypass canonical settlement preflight", () => {
  assert.match(raw, /SKIP6R_SWITCH_HISTORICAL_RAW_DIRECT_EXECUTION_FORBIDDEN/);
  assert.match(raw, /invokedPath === rawEntrypointPath/);
  assert.match(raw, /await import\("\.\/analyze-skip6r-switch-historical-closing-odds"\)/);
  assert.doesNotMatch(raw, /analyze-skip6r-switch-historical-closing-odds-internal/);
  assert.doesNotMatch(raw, /assertCanonicalSingleLinkRegularFile/);
});