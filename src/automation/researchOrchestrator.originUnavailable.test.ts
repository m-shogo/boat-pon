import assert from "node:assert/strict";
import test from "node:test";
import { preflight } from "./researchOrchestrator";

test("preflight blocks when origin main authority is unavailable", () => {
  const result = preflight({
    emergencyStop: false,
    paused: false,
    workingTreeClean: true,
    localHeadSha: "a".repeat(40),
    parentShas: [],
    originHeadSha: "",
    activeWal: false,
    freeDiskBytes: 10_000,
    minFreeDiskBytes: 1,
    queueDigest: "b".repeat(64),
    requestQueueDigest: "b".repeat(64),
    authoritySha: "a".repeat(40),
    alreadyProcessedRequestIds: [],
    requestId: "REQ-origin-fetch-fail-closed",
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.blocks, ["GIT_DRIFT_LOCAL_VS_ORIGIN"]);
});
