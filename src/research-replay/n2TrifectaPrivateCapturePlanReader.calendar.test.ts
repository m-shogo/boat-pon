import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readN2TrifectaPrivateCapturePlan } from "./n2TrifectaPrivateCapturePlanReader.js";

test("private capture plan rejects impossible dates before opening the primary database", () => {
  const dir = mkdtempSync(join(tmpdir(), "boat-pon-private-plan-date-"));
  const path = join(dir, "not-a-database.sqlite");
  try {
    writeFileSync(path, "metadata-only fixture", "utf8");
    const result = readN2TrifectaPrivateCapturePlan({
      primaryDbPath: path,
      date: "2026-02-30",
      venueCode: "05",
    });
    assert.equal(result.status, "BLOCKED");
    assert.deepEqual(result.blockers, ["INVALID_DATE"]);
    assert.equal(result.sourceRowCount, 0);
    assert.equal(result.selectedRaceCount, 0);
    assert.equal(result.plan.entries.length, 0);
    assert.equal(result.databaseWriteCount, 0);
    assert.equal(result.approvalCreated, false);
    assert.equal(result.networkExecuted, false);
    assert.equal(result.productionApplyExecuted, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
