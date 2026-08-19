import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { canonicalHash } from "./canonical.js";
import { buildN2TrifectaPrivateHeartbeatRecord } from "./n2TrifectaPrivateHeartbeat.js";
import { buildN2TrifectaPrivateHeartbeatGapDiagnostics } from
  "./n2TrifectaPrivateHeartbeatGapDiagnostics.js";

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-heartbeat-gap-integrity-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeRecord(root: string, record: Record<string, unknown>): void {
  const path = join(root, "data/private/trifecta-capture/heartbeats/2026-08-07.jsonl");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
}

function heartbeatRecord(): Record<string, unknown> {
  return buildN2TrifectaPrivateHeartbeatRecord({
    recordedAt: "2026-08-07T01:05:30.000Z",
    status: "NO_CHANGE",
    blockers: [],
    authoritySha: "0123456789abcdef0123456789abcdef01234567",
    runtimeAuthorityStatus: "PASS",
  }) as unknown as Record<string, unknown>;
}

function recomputeDigest(record: Record<string, unknown>): void {
  const { recordDigest: _recordDigest, ...core } = record;
  record.recordDigest = canonicalHash(core);
}

test("rejects normalized diagnostics now timestamps", () => {
  withRoot((root) => {
    writeRecord(root, heartbeatRecord());
    const report = buildN2TrifectaPrivateHeartbeatGapDiagnostics({
      dataRoot: root,
      date: "2026-08-07",
      now: "2026-08-07T24:00:00Z",
    });
    assert.equal(report.status, "BLOCKED");
    assert.ok(report.blockers.includes("NOW_INVALID"));
    assert.equal(report.networkRequestCount, 0);
    assert.equal(report.databaseReadCount, 0);
    assert.equal(report.rawOddsValuesRead, false);
  });
});

test("rejects rehashed non-canonical heartbeat record times", () => {
  withRoot((root) => {
    const record = heartbeatRecord();
    record.recordedAt = "2026-08-07T10:05:30+09:00";
    recomputeDigest(record);
    writeRecord(root, record);

    const report = buildN2TrifectaPrivateHeartbeatGapDiagnostics({
      dataRoot: root,
      date: "2026-08-07",
      now: "2026-08-07T01:06:00.000Z",
    });
    assert.equal(report.status, "BLOCKED");
    assert.ok(report.blockers.includes("HEARTBEAT_RECORDED_AT_NON_CANONICAL"));
  });
});

test("rejects heartbeat records whose persisted body no longer matches its digest", () => {
  withRoot((root) => {
    const record = heartbeatRecord();
    record.capturedCount = 1;
    writeRecord(root, record);

    const report = buildN2TrifectaPrivateHeartbeatGapDiagnostics({
      dataRoot: root,
      date: "2026-08-07",
      now: "2026-08-07T01:06:00.000Z",
    });
    assert.equal(report.status, "BLOCKED");
    assert.ok(report.blockers.includes("HEARTBEAT_RECORD_DIGEST_MISMATCH"));
  });
});
