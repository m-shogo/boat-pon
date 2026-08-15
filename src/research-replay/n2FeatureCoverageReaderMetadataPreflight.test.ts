import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { readOfficialProgramCoverageEvents } from "./n2FeatureCoverageReader";

test("feature coverage rejects invalid race metadata before raw program columns are required", () => {
  const dir = mkdtempSync(join(tmpdir(), "boat-pon-n2-feature-metadata-preflight-"));
  const primaryPath = join(dir, "primary.sqlite");
  const sidecarPath = join(dir, "sidecar.sqlite");

  const primary = new DatabaseSync(primaryPath);
  primary.exec(`
    CREATE TABLE official_programs (
      race_id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      venue TEXT NOT NULL,
      race_no INTEGER NOT NULL
    );
    INSERT INTO official_programs VALUES ('20260230-01-01', '2026-02-30', '01', 1);
  `);
  primary.close();

  const sidecar = new DatabaseSync(sidecarPath);
  sidecar.close();

  try {
    assert.throws(
      () => readOfficialProgramCoverageEvents({
        primaryDbPath: primaryPath,
        sidecarDbPath: sidecarPath,
        dateFrom: "2026-02-01",
        dateTo: "2026-03-01",
      }),
      /N2_COVERAGE_INVALID_PROGRAM_DATE:20260230-01-01/u,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
