import assert from "node:assert/strict";
import test from "node:test";
import {
  archiveReconcileCheckpointContract,
  assertArchiveReconcileCheckpointContract,
  buildArchiveReconcileSelection,
} from "./n2ArchiveReconcileInput";

test("archive reconciliation applies as-of cutoff before limit", () => {
  const selection = buildArchiveReconcileSelection({
    discoveredFiles: [
      "/archive/z/k260802.lzh",
      "/archive/z/k260731.lzh",
      "/archive/z/k260801.lzh",
    ],
    asOf: "2026-08-01T23:59:59.000Z",
    limit: 1,
  });
  assert.equal(selection.asOf, "2026-08-01T23:59:59.000Z");
  assert.equal(selection.cutoffDate, "2026-08-01");
  assert.deepEqual(selection.eligibleFiles.map((path) => path.split("/").at(-1)), ["k260731.lzh", "k260801.lzh"]);
  assert.deepEqual(selection.selectedFiles.map((path) => path.split("/").at(-1)), ["k260731.lzh"]);
});

test("archive reconciliation canonicalizes equivalent explicit-zone as-of instants", () => {
  const selection = buildArchiveReconcileSelection({
    discoveredFiles: ["/archive/k260801.lzh"],
    asOf: "2026-08-02T08:00:00+09:00",
    limit: null,
  });
  assert.equal(selection.asOf, "2026-08-01T23:00:00.000Z");
  assert.equal(selection.cutoffDate, "2026-08-01");
  assert.equal(selection.selectedFiles.length, 1);
});

test("archive reconciliation rejects normalized or impossible input dates", () => {
  assert.throws(() => buildArchiveReconcileSelection({
    discoveredFiles: ["/archive/k260801.lzh"],
    asOf: "2026-08-01T24:00:00Z",
    limit: null,
  }), /invalid timestamp/);
  assert.throws(() => buildArchiveReconcileSelection({
    discoveredFiles: ["/archive/k260230.lzh"],
    asOf: "2026-03-01T00:00:00.000Z",
    limit: null,
  }), /ARCHIVE_FILE_DATE_INVALID:k260230\.lzh:2026-02-30/);
});

test("archive reconciliation rejects ambiguous duplicate archive basenames", () => {
  assert.throws(() => buildArchiveReconcileSelection({
    discoveredFiles: ["/archive/a/k260801.lzh", "/archive/b/k260801.lzh"],
    asOf: "2026-08-01T23:59:59.000Z",
    limit: null,
  }), /ARCHIVE_INVENTORY_BASENAME_DUPLICATE:k260801\.lzh/);
});

test("resume checkpoint is bound to canonical as-of and selected inventory", () => {
  const selection = buildArchiveReconcileSelection({
    discoveredFiles: ["/archive/k260731.lzh", "/archive/k260801.lzh"],
    asOf: "2026-08-01T23:59:59.000Z",
    limit: null,
  });
  const contract = archiveReconcileCheckpointContract(selection);
  assert.doesNotThrow(() => assertArchiveReconcileCheckpointContract({ ...contract }, contract));
  assert.throws(
    () => assertArchiveReconcileCheckpointContract({ ...contract, asOf: "2026-08-02T00:00:00.000Z" }, contract),
    /ARCHIVE_RECONCILE_CHECKPOINT_CONTRACT_MISMATCH:asOf/,
  );
  assert.throws(
    () => assertArchiveReconcileCheckpointContract({ ...contract, inventoryDigest: "0".repeat(64) }, contract),
    /ARCHIVE_RECONCILE_CHECKPOINT_CONTRACT_MISMATCH:inventoryDigest/,
  );
});
