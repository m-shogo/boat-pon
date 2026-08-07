import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  appendN2TrifectaPrivateHeartbeat,
  buildN2TrifectaPrivateHeartbeatRecord,
  n2TrifectaPrivateHeartbeatRelativePath,
} from "./n2TrifectaPrivateHeartbeat.js";

test("private heartbeat appends every tick as owner-only JSONL without raw odds", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-private-heartbeat-"));
  try {
    const first = buildN2TrifectaPrivateHeartbeatRecord({
      recordedAt: "2026-08-07T01:12:30.000Z",
      status: "NO_CHANGE",
      runtimeAuthorityStatus: "PASS",
      authoritySha: "6e297602ff34d6cc853ff0e7088ae5a3e56fcfb7",
      selectedVenueCode: "10",
    });
    const second = buildN2TrifectaPrivateHeartbeatRecord({
      recordedAt: "2026-08-07T01:13:00.000Z",
      status: "PASS",
      runtimeAuthorityStatus: "PASS",
      authoritySha: "6e297602ff34d6cc853ff0e7088ae5a3e56fcfb7",
      selectedVenueCode: "10",
      selectedRaceIdentity: "20260807-10-05",
      selectedCheckpointLabel: "T-5",
      dueEntryCount: 1,
      networkRequestCount: 1,
      capturedCount: 1,
    });

    const relativePath = appendN2TrifectaPrivateHeartbeat({ dataRoot: root, record: first });
    assert.equal(relativePath, n2TrifectaPrivateHeartbeatRelativePath(first.recordedAt));
    appendN2TrifectaPrivateHeartbeat({ dataRoot: root, record: second });

    const path = join(root, relativePath);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    const lines = readFileSync(path, "utf8").trim().split("\n");
    assert.equal(lines.length, 2);
    const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.equal(parsed[0]?.status, "NO_CHANGE");
    assert.equal(parsed[1]?.status, "PASS");
    assert.equal(parsed[1]?.selectedCheckpointLabel, "T-5");
    assert.equal(parsed[1]?.networkRequestCount, 1);
    assert.equal(parsed[1]?.rawOddsValuesRecorded, false);
    assert.equal(parsed[1]?.databaseWriteCount, 0);
    assert.equal(parsed[1]?.currentBuyChanged, false);
    assert.equal(parsed[1]?.lineChanged, false);
    assert.equal(parsed[1]?.publicPublished, false);
    assert.equal(parsed[1]?.automatedBettingChanged, false);
    assert.equal(typeof parsed[0]?.recordDigest, "string");
    assert.equal(typeof parsed[1]?.recordDigest, "string");

    const serialized = readFileSync(path, "utf8");
    assert.equal(serialized.includes("odds"), false);
    assert.equal(serialized.includes("rawHtml"), false);
    assert.equal(serialized.includes("snapshot"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("private heartbeat rejects invalid timestamps and negative counters", () => {
  assert.throws(
    () => buildN2TrifectaPrivateHeartbeatRecord({
      recordedAt: "not-a-time",
      status: "NO_CHANGE",
      runtimeAuthorityStatus: "PASS",
    }),
    /HEARTBEAT_RECORDED_AT_INVALID/,
  );
  assert.throws(
    () => buildN2TrifectaPrivateHeartbeatRecord({
      recordedAt: "2026-08-07T01:13:00.000Z",
      status: "PASS",
      runtimeAuthorityStatus: "PASS",
      networkRequestCount: -1,
    }),
    /HEARTBEAT_NETWORK_COUNT_INVALID/,
  );
});
