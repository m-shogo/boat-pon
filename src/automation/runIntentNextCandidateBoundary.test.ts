import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("operator nextCandidate uses the same canonical NEXT resolver as dispatch", () => {
  const source = readFileSync("scripts/run-intent-task.ts", "utf8");
  const helperStart = source.indexOf("function pickNext(");
  const helperEnd = source.indexOf("\n}\n\n// state を atomic 更新", helperStart);

  assert.ok(helperStart >= 0 && helperEnd > helperStart, "pickNext helper must exist");
  const helper = source.slice(helperStart, helperEnd + 2);
  assert.match(
    helper,
    /const next = resolveTask\(merged, "NEXT"\)\.task;/,
    "nextCandidate must inherit dependency ordering and global definition-drift fail-closed behavior from resolveTask",
  );
  assert.doesNotMatch(helper, /\.find\(/, "runner must not maintain a second NEXT eligibility implementation");
});
