import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("no-executor block reports digest from reconciled persisted state", () => {
  const source = readFileSync("scripts/run-intent-task.ts", "utf8");
  const noExecutor = source.indexOf("if (!executor) {");
  const claim = source.indexOf("// ---- state: READY → CLAIMED → RUNNING ----", noExecutor);

  assert.ok(noExecutor >= 0 && claim > noExecutor, "no-executor branch must exist before claim");
  const branch = source.slice(noExecutor, claim);
  assert.match(
    branch,
    /stateVersion:\s*state\.stateVersion,\s*stateDigest:\s*computeStateDigest\(state\)/,
    "stateVersion and stateDigest must describe the same post-reconciliation queue authority",
  );
  assert.doesNotMatch(
    branch,
    /stateVersion:\s*state\.stateVersion,\s*stateDigest,\s*blocks/,
    "no-executor branch must not report the pre-reconciliation digest",
  );
});
