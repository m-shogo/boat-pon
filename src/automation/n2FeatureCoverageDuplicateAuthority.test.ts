import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { runN2ActiveFeatureCoverageAudit } from "./n2FeatureCoverageAuditRuntime";

test("feature coverage fails closed before counting invalid source-duplicate resolution evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-feature-coverage-duplicate-authority-"));
  const sidecarPath = join(root, "sidecar.sqlite");
  const db = new DatabaseSync(sidecarPath);
  db.exec(`
    CREATE TABLE domain_observations(
      observation_id TEXT PRIMARY KEY,
      canonical_race_key TEXT,
      observation_type TEXT,
      payload_type TEXT,
      raw_document_id TEXT,
      parse_run_id TEXT,
      supersedes_id TEXT,
      correction_kind TEXT,
      correction_reason TEXT
    );
    CREATE TABLE settlement_source_duplicate_resolutions_v2(
      resolution_id TEXT PRIMARY KEY,
      duplicate_observation_id TEXT,
      canonical_observation_id TEXT,
      canonical_race_key TEXT,
      raw_document_id TEXT,
      source_archive_file TEXT,
      resolution_kind TEXT,
      detection_reason TEXT,
      duplicate_semantic_digest TEXT,
      resolver_version TEXT,
      policy_version TEXT,
      schema_version TEXT
    );
  `);
  db.prepare(`INSERT INTO settlement_source_duplicate_resolutions_v2 VALUES (
    'resolution-invalid',
    'obs-duplicate-missing',
    'obs-canonical-missing',
    '2024-06-05:12:R1',
    'raw-missing',
    'missing-source-archive',
    'source_duplicate',
    'invalid-evidence',
    ?,
    'invalid-resolver',
    'invalid-policy',
    'invalid-schema'
  )`).run("a".repeat(64));
  db.close();

  try {
    const result = runN2ActiveFeatureCoverageAudit({
      repoRoot: root,
      runId: "test-run",
      requestId: "test-request",
      taskId: "TASK-N2-006",
      sidecarPath,
      historyDir: join(root, "history"),
      reportsDir: join(root, "reports"),
      dryRun: true,
      taskStatuses: { "TASK-N2-004": "PASS" },
    });
    assert.equal(result.result, "BLOCKED");
    assert.deepEqual(result.blocks, ["SOURCE_DUPLICATE_RESOLUTION_EVIDENCE_INVALID"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
