import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("successful runner completion records the persisted queue stateVersion exactly", () => {
  const source = readFileSync("scripts/run-intent-task.ts", "utf8");

  assert.match(
    source,
    /stateVersion:\s*state\.stateVersion,\s*stateDigest:\s*computeStateDigest\(state\)/,
    "current-run must record the exact stateVersion already persisted by updateState",
  );
  assert.doesNotMatch(
    source,
    /stateVersion:\s*state\.stateVersion\s*\+\s*1/,
    "current-run must not invent an extra stateVersion increment",
  );
});

test("successful recurring runner cycle resets its attempt budget before returning READY", () => {
  const source = readFileSync("scripts/run-intent-task.ts", "utf8");

  assert.match(
    source,
    /if \(task\.recurring && \(nextStatus === "PASS" \|\| nextStatus === "CONDITIONAL"\)\) \{\s*updateState\(task\.taskId, \{ status: "READY", attemptCount: 0 \}, true\);/,
    "recurring success must not carry a completed cycle's attempts into the next explicit dispatch",
  );
});

test("runner reports the actual post-transition task status", () => {
  const source = readFileSync("scripts/run-intent-task.ts", "utf8");

  assert.match(
    source,
    /const finalTaskStatus = state\.tasks\[task\.taskId\]\?\.status \?\? nextStatus;/,
    "runner must derive the reported task status from the persisted post-transition state",
  );
  assert.match(
    source,
    /taskStatus:\s*finalTaskStatus,\s*nextCandidate:\s*pickNext\(mergeCatalogAndState\(catalog, state\)\)/,
    "runner completion must report status and next candidate from the same updated state",
  );
});