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
