import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("historical forward validates canonical 120-selection completeness before latest-capture selection", () => {
  const source = readFileSync("scripts/audit-t5-historical-market-forward.ts", "utf8");
  const captureQuery = source.slice(source.indexOf("function loadLatestCompleteCaptures"), source.indexOf("function loadPrograms"));

  assert.match(source, /n2CanonicalT5CompleteCaptureSelectionHavingSql/);
  assert.match(captureQuery, /n2CanonicalT5CompleteCaptureSelectionHavingSql\("selection"\)/);
  assert.match(captureQuery, /HAVING \$\{canonicalSelectionHavingSql\}/);
  assert.ok(
    captureQuery.indexOf("canonicalSelectionHavingSql") < captureQuery.indexOf("latest_capture AS"),
    "canonical selection validation must happen before latest capture is chosen",
  );
});
