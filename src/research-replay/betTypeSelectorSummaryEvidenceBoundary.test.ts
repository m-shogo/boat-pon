import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("bet-type selector summary derives headline evidence from current inputs", () => {
  const source = readFileSync("scripts/report-bet-type-selector-summary-raw.ts", "utf8");

  assert.match(source, /assertCanonicalSingleLinkRegularFile\(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID"\)/);
  assert.match(source, /new DatabaseSync\(dbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only=ON/);
  assert.match(source, /const bestOverall = sortedByROI\[0\]/);
  assert.match(source, /const allScreenedBelowBreakEven =/);
  assert.match(source, /totalBuy\.toLocaleString\(\)/);
  assert.match(source, /bestOverall\?\.ROI/);
  assert.doesNotMatch(source, /6,260/);
  assert.doesNotMatch(source, /77\.96/);
  assert.doesNotMatch(source, /全5券種でROI < 80%/);
});
