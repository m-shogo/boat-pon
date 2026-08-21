import assert from "node:assert/strict";
import test from "node:test";
import { auditAllLocalKArchives } from "./n1SettlementAudit";

for (const concurrency of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
  test(`archive audit rejects invalid concurrency ${String(concurrency)}`, async () => {
    await assert.rejects(
      auditAllLocalKArchives("/path/does/not/matter", concurrency),
      (error) => error instanceof Error
        && error.message === `N1_ARCHIVE_AUDIT_CONCURRENCY_INVALID:${String(concurrency)}`,
    );
  });
}
