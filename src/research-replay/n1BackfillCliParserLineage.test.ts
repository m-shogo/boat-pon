import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const script = readFileSync(new URL("../../scripts/research-replay-n1-backfill.ts", import.meta.url), "utf8");

test("N1 backfill CLI scopes progress and verify to the current parser lineage", () => {
  assert.ok(script.includes("completedBackfillCountForParser({ db })"));
  assert.ok(script.includes("WHERE parser_version=?"));
  assert.ok(script.includes(".all(N1_SETTLEMENT_PARSER_VERSION)"));
  assert.equal(script.includes("checkpoints.completedCount()"), false);
});
