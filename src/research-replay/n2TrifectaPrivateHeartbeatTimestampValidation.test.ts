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

test("private heartbeat canonicalizes equivalent explicit-offset instants before hashing", () => {
  const offsetRecord = buildN2TrifectaPrivateHeartbeatRecord({
    recordedAt: "2028-02-29T23:30:00.000+09:00",
    status: "NO_CHANGE",
    runtimeAuthorityStatus: "PASS",
  });
  const utcRecord = buildN2TrifectaPrivateHeartbeatRecord({
    recordedAt: "2028-02-29T14:30:00.000Z",
    status: "NO_CHANGE",
    runtimeAuthorityStatus: "PASS",
  });

  assert.equal(offsetRecord.recordedAt, "2028-02-29T14:30:00.000Z");
  assert.equal(offsetRecord.dateJst, "2028-02-29");
  assert.equal(offsetRecord.recordDigest, utcRecord.recordDigest);
  assert.equal(
    n2TrifectaPrivateHeartbeatRelativePath("2028-02-29T23:30:00.000+09:00"),
    "data/private/trifecta-capture/heartbeats/2028-02-29.jsonl",
  );
});
