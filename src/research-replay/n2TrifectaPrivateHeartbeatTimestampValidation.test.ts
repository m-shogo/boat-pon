import assert from "node:assert/strict";
import test from "node:test";

import {
  buildN2TrifectaPrivateHeartbeatRecord,
  n2TrifectaPrivateHeartbeatRelativePath,
} from "./n2TrifectaPrivateHeartbeat";

for (const recordedAt of [
  "2026-02-30T01:00:00.000Z",
  "2026-08-07T24:00:00.000Z",
  "2026-08-07T01:13:00.000",
]) {
  test(`private heartbeat rejects non-canonical recordedAt ${recordedAt}`, () => {
    assert.throws(
      () => buildN2TrifectaPrivateHeartbeatRecord({
        recordedAt,
        status: "NO_CHANGE",
        runtimeAuthorityStatus: "PASS",
      }),
      /HEARTBEAT_RECORDED_AT_INVALID/,
    );
    assert.throws(
      () => n2TrifectaPrivateHeartbeatRelativePath(recordedAt),
      /HEARTBEAT_RECORDED_AT_INVALID/,
    );
  });
}

test("private heartbeat preserves valid leap-day timestamps with an explicit offset", () => {
  const recordedAt = "2028-02-29T23:30:00.000+09:00";
  const record = buildN2TrifectaPrivateHeartbeatRecord({
    recordedAt,
    status: "NO_CHANGE",
    runtimeAuthorityStatus: "PASS",
  });

  assert.equal(record.dateJst, "2028-02-29");
  assert.equal(
    n2TrifectaPrivateHeartbeatRelativePath(recordedAt),
    "data/private/trifecta-capture/heartbeats/2028-02-29.jsonl",
  );
});
