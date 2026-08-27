import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("T-5 collector efficiency requires canonical persisted timing for full coverage", () => {
  const source = readFileSync("scripts/audit-t5-collector-efficiency.ts", "utf8");

  assert.match(source, /n2CanonicalT5CoverageTimingSql/);
  assert.match(source, /canonical_timing_rows/);
  assert.match(source, /timing_values/);
  assert.match(
    source,
    /checkpoint_label = 'T-5' AND selections = canonical_selections AND rows = canonical_timing_rows AND timing_values = 1/,
  );
  assert.match(
    source,
    /checkpoint_label = 'T-5' AND captured_at >= \? AND selections = canonical_selections AND rows = canonical_timing_rows AND timing_values = 1/,
  );
});
