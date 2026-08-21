import assert from "node:assert/strict";
import test from "node:test";
import {
  archiveReconcileCheckpointContract,
  assertArchiveReconcileCheckpointContract,
  buildArchiveReconcileSelection,
} from "./n2ArchiveReconcileInput";

const fakeArchiveBytes = (path: string): Uint8Array => Buffer.from(`bytes:${path}`, "utf8");
const sidecarSha = "a".repeat(64);

test("archive reconciliation applies last-completed JST race-day cutoff before limit", () => {
  const selection = buildArchiveReconcileSelection({
    discoveredFiles: [
      "/archive/z/k260802.lzh",
      "/archive/z/k260731.lzh",
      "/archive/z/k260801.lzh",
    ],
    asOf: "2026-08-01T23:59:59.000Z",
    limit: 1,
    readArchiveBytes: fakeArchiveBytes,
  });
  assert.equal(selection.asOf, "2026-08-01T23:59:59.000Z");
  assert.equal(selection.cutoffDate, "2026-08-01");
  assert.deepEqual(selection.eligibleFiles.map((path) => path.split("/").at(-1)), ["k260731.lzh", "k260801.lzh"]);
  assert.deepEqual(selection.selectedFiles.map((path) => path.split("/").at(-1)), ["k260731.lzh"]);
});

test("archive reconciliation rejects invalid bounded-selection limits before reading inventory", () => {
  let readCount = 0;
  const readArchiveBytes = (path: string): Uint8Array => {
    readCount += 1;
    return fakeArchiveBytes(path);
  };
  for (const limit of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => buildArchiveReconcileSelection({
      discoveredFiles: ["/archive/k260731.lzh", "/archive/k260801.lzh"],
      asOf: "2026-08-01T23:59:59.000Z",
      limit,
      readArchiveBytes,
    }), /ARCHIVE_RECONCILE_LIMIT_INVALID/);
  }
  assert.equal(readCount, 0);
});

test("archive reconciliation excludes the JST race day still in progress", () => {
  const selection = buildArchiveReconcileSelection({
    discoveredFiles: ["/archive/k260731.lzh", "/archive/k260801.lzh"],
    asOf: "2026-08-01T00:00:00.000Z",
    limit: null,
    readArchiveBytes: fakeArchiveBytes,
  });
  // 00:00Z is 09:00 JST on Aug 1, so the complete Aug 1 daily archive is future information.
  assert.equal(selection.cutoffDate, "2026-07-31");
  assert.deepEqual(selection.selectedFiles.map((path) => path.split("/").at(-1)), ["k260731.lzh"]);
});

test("archive reconciliation includes the prior JST day exactly after its midnight boundary", () => {
  const selection = buildArchiveReconcileSelection({
    discoveredFiles: ["/archive/k260801.lzh", "/archive/k260802.lzh"],
    asOf: "2026-08-02T00:00:00+09:00",
    limit: null,
    readArchiveBytes: fakeArchiveBytes,
  });
  assert.equal(selection.asOf, "2026-08-01T15:00:00.000Z");
  assert.equal(selection.cutoffDate, "2026-08-01");
  assert.deepEqual(selection.selectedFiles.map((path) => path.split("/").at(-1)), ["k260801.lzh"]);
});

test("archive reconciliation rejects normalized or impossible input dates", () => {
  assert.throws(() => buildArchiveReconcileSelection({
    discoveredFiles: ["/archive/k260801.lzh"],
    asOf: "2026-08-01T24:00:00Z",
    limit: null,
    readArchiveBytes: fakeArchiveBytes,
  }), /invalid timestamp/);
  assert.throws(() => buildArchiveReconcileSelection({
    discoveredFiles: ["/archive/k260230.lzh"],
    asOf: "2026-03-01T00:00:00.000Z",
    limit: null,
    readArchiveBytes: fakeArchiveBytes,
  }), /ARCHIVE_FILE_DATE_INVALID:k260230\.lzh:2026-02-30/);
});

test("archive reconciliation rejects ambiguous duplicate archive basenames", () => {
  assert.throws(() => buildArchiveReconcileSelection({
    discoveredFiles: ["/archive/a/k260731.lzh", "/archive/b/k260731.lzh"],
    asOf: "2026-08-01T23:59:59.000Z",
    limit: null,
    readArchiveBytes: fakeArchiveBytes,
  }), /ARCHIVE_INVENTORY_BASENAME_DUPLICATE:k260731\.lzh/);
});

test("archive inventory digest changes when compressed archive bytes change", () => {
  const common = {
    discoveredFiles: ["/archive/k260731.lzh"],
    asOf: "2026-08-01T23:59:59.000Z",
    limit: null,
  } as const;
  const first = buildArchiveReconcileSelection({
    ...common,
    readArchiveBytes: () => Buffer.from("archive-v1"),
  });
  const second = buildArchiveReconcileSelection({
    ...common,
    readArchiveBytes: () => Buffer.from("archive-v2"),
  });
  assert.notEqual(first.inventoryDigest, second.inventoryDigest);
  assert.throws(
    () => assertArchiveReconcileCheckpointContract(
      archiveReconcileCheckpointContract(first, sidecarSha),
      archiveReconcileCheckpointContract(second, sidecarSha),
    ),
    /ARCHIVE_RECONCILE_CHECKPOINT_CONTRACT_MISMATCH:inventoryDigest/,
  );
});

test("resume checkpoint is bound to canonical as-of, inventory, and source sidecar snapshot", () => {
  const selection = buildArchiveReconcileSelection({
    discoveredFiles: ["/archive/k260731.lzh", "/archive/k260801.lzh"],
    asOf: "2026-08-01T23:59:59.000Z",
    limit: null,
    readArchiveBytes: fakeArchiveBytes,
  });
  const contract = archiveReconcileCheckpointContract(selection, sidecarSha);
  assert.doesNotThrow(() => assertArchiveReconcileCheckpointContract({ ...contract }, contract));
  assert.throws(
    () => assertArchiveReconcileCheckpointContract({ ...contract, asOf: "2026-08-02T00:00:00.000Z" }, contract),
    /ARCHIVE_RECONCILE_CHECKPOINT_CONTRACT_MISMATCH:asOf/,
  );
  assert.throws(
    () => assertArchiveReconcileCheckpointContract({ ...contract, inventoryDigest: "0".repeat(64) }, contract),
    /ARCHIVE_RECONCILE_CHECKPOINT_CONTRACT_MISMATCH:inventoryDigest/,
  );
  assert.throws(
    () => assertArchiveReconcileCheckpointContract({ ...contract, sourceSidecarSha256: "b".repeat(64) }, contract),
    /ARCHIVE_RECONCILE_CHECKPOINT_CONTRACT_MISMATCH:sourceSidecarSha256/,
  );
  assert.throws(
    () => archiveReconcileCheckpointContract(selection, "ABC"),
    /ARCHIVE_RECONCILE_SIDECAR_SHA_INVALID/,
  );
});
