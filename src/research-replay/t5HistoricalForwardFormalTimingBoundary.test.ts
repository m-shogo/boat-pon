import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("historical forward gates formal future on canonical T-5 timing without reclassifying calibration", () => {
  const source = readFileSync("scripts/audit-t5-historical-market-forward.ts", "utf8");
  const captureQuery = source.slice(source.indexOf("function loadLatestCompleteCaptures"), source.indexOf("function loadPrograms"));

  assert.match(source, /n2CanonicalT5ForwardCaptureTimingHavingSql/);
  assert.match(
    captureQuery,
    /capturedFrom == null\s*\? "1 = 1"\s*:\s*n2CanonicalT5ForwardCaptureTimingHavingSql\("minutes_before_close"\)/,
  );
  assert.match(captureQuery, /HAVING \$\{canonicalSelectionHavingSql\} AND \$\{canonicalTimingHavingSql\}/);
});
