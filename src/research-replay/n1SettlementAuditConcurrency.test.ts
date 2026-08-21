import assert from "node:assert/strict";
import test from "node:test";
import { auditAllLocalKArchives } from "./n1SettlementAudit";

for (const concurrency of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
  test(`archive audit rejects invalid concurrency ${String(concurrency)}`, async () => {
    await assert.rejects(
      auditAllLocalKArchives("/path/does/not/matter", concurrency),
      new RegExp(`^N1_ARCHIVE_AUDIT_CONCURRENCY_INVALID:${String(concurrency).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
    );
  });
}

test("archive audit accepts a positive safe-integer concurrency before checking the archive root", async () => {
  await assert.rejects(
    auditAllLocalKArchives("/path/does/not/matter", 1),
    /archive root is not a directory|ENOENT/,
  );
});
