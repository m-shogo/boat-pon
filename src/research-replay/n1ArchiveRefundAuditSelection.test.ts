import assert from "node:assert/strict";
import test from "node:test";
import { selectRefundAuditArchives } from "./n1ArchiveRefundAuditSelection";

test("refund audit validates all archive dates before bounded selection", () => {
  const files = [
    "/archive/k260101.lzh",
    "/archive/k260230.lzh",
    "/archive/k260102.lzh",
  ];

  assert.throws(
    () => selectRefundAuditArchives(files, 1),
    /invalid JST race date/,
  );
});

test("refund audit validates bounded selection limit before archive preflight", () => {
  const files = ["/archive/k260230.lzh"];

  for (const limit of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => selectRefundAuditArchives(files, limit),
      /N1_REFUND_AUDIT_LIMIT_INVALID/u,
    );
  }
});

test("refund audit preserves valid archive ordering after preflight", () => {
  const files = [
    "/archive/k280229.lzh",
    "/archive/k280301.lzh",
  ];

  assert.deepEqual(selectRefundAuditArchives(files, 1), [files[0]]);
  assert.deepEqual(selectRefundAuditArchives(files, null), files);
});
