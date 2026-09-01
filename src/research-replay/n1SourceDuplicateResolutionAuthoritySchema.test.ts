import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { readCurrentlyValidSourceDuplicateObservationIds } from "./n1SourceDuplicateResolutionValidation";

test("source duplicate evidence rejects malformed empty authority schema", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      CREATE TABLE settlement_source_duplicate_resolutions_v2 (
        duplicate_observation_id TEXT NOT NULL
      );
    `);

    assert.throws(
      () => readCurrentlyValidSourceDuplicateObservationIds(db),
      /SOURCE_DUPLICATE_RESOLUTION_EVIDENCE_SCHEMA_INVALID/,
    );
  } finally {
    db.close();
  }
});

test("source duplicate evidence accepts empty semantic authority schema", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      CREATE TABLE settlement_source_duplicate_resolutions_v2 (
        resolution_id TEXT NOT NULL,
        duplicate_observation_id TEXT NOT NULL,
        canonical_observation_id TEXT NOT NULL,
        canonical_race_key TEXT NOT NULL,
        raw_document_id TEXT NOT NULL,
        source_archive_file TEXT NOT NULL,
        resolution_kind TEXT NOT NULL,
        detection_reason TEXT NOT NULL,
        duplicate_semantic_digest TEXT NOT NULL,
        resolver_version TEXT NOT NULL,
        policy_version TEXT NOT NULL,
        schema_version TEXT NOT NULL
      );
    `);

    assert.deepEqual([...readCurrentlyValidSourceDuplicateObservationIds(db)], []);
  } finally {
    db.close();
  }
});
