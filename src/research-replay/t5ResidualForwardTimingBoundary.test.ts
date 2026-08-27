import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("residual forward validates canonical T-5 capture timing before latest-capture selection", () => {
  const source = readFileSync("scripts/analyze-t5-residual-forward.ts", "utf8");
  const completeCapture = source.slice(
    source.indexOf("const canonicalSelectionHavingSql"),
    source.indexOf("const results="),
  );

  assert.match(source, /n2CanonicalT5ForwardCaptureTimingHavingSql/);
  assert.match(completeCapture, /n2CanonicalT5ForwardCaptureTimingHavingSql\("minutes_before_close"\)/);
  assert.match(completeCapture, /HAVING \$\{canonicalSelectionHavingSql\} AND \$\{canonicalTimingHavingSql\}/);
  assert.ok(
    completeCapture.indexOf("canonicalTimingHavingSql") < completeCapture.indexOf("latest_capture AS"),
    "timing validation must happen before latest capture is chosen",
  );
});
