import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { canonicalHash } from "../research-replay/canonical";
import { PAYLOAD_SCHEMA_VERSION, semanticPayloadHash } from "../research-replay/domain";
import { runN2PitAuditExecutor } from "./n2PitAuditExecutor";
import type { ExecutorContext } from "./taskExecutors";

const MANIFEST_ENV = "BOAT_PON_N2_DATASET_MANIFEST_PATH";

function createPrimary(path: string): void {
  const db = new DatabaseSync(path);
  try {
    db.exec(`CREATE TABLE official_programs (
      race_id TEXT PRIMARY KEY, date TEXT NOT NULL, venue TEXT NOT NULL,
      race_no INTEGER NOT NULL, close_at TEXT
    )`);
    db.prepare("INSERT INTO official_programs VALUES(?,?,?,?,?)")
      .run("20240601-01-01", "2024-06-01", "01", 1, "10:00");
  } finally {
    db.close();
  }
}

function createSidecar(path: string): void {
  const db = new DatabaseSync(path);
  try {
    db.exec(`
      CREATE TABLE raw_documents (
        raw_document_id TEXT PRIMARY KEY, integrity_status TEXT NOT NULL,
        security_scan_status TEXT NOT NULL, parser_replay_eligible INTEGER NOT NULL
      );
      CREATE TABLE parse_runs (
        parse_run_id TEXT PRIMARY KEY, raw_document_id TEXT NOT NULL, status TEXT NOT NULL
      );
      CREATE TABLE domain_observations (
        observation_id TEXT PRIMARY KEY, canonical_race_key TEXT NOT NULL,
        observation_type TEXT NOT NULL, payload_type TEXT NOT NULL,
        payload_schema_version TEXT NOT NULL, semantic_payload_hash TEXT NOT NULL,
        raw_document_id TEXT NOT NULL, parse_run_id TEXT NOT NULL, source_published_at TEXT,
        source_observed_at TEXT NOT NULL, first_seen_at TEXT NOT NULL,
        timing_quality TEXT NOT NULL, source_quality TEXT NOT NULL
      );
      CREATE TABLE typed_observation_payloads (
        observation_id TEXT PRIMARY KEY, payload_type TEXT NOT NULL,
        payload_schema_version TEXT NOT NULL, payload_json TEXT NOT NULL, payload_hash TEXT NOT NULL
      );
    `);
    db.prepare("INSERT INTO raw_documents VALUES(?,?,?,?)").run("raw-1", "verified", "passed", 1);
    db.prepare("INSERT INTO parse_runs VALUES(?,?,?)").run("parse-1", "raw-1", "success");
    const payload = {
      canonicalRaceKey: "2024-06-01:01:R1",
      observedAt: "2024-06-01T00:01:00.000Z",
      boats: [{
        course: 1, registrationNo: null, className: null,
        nationalWinRate: null, nationalTop2Rate: null, localWinRate: null, localTop2Rate: null,
        motorTop2Rate: null, boatTop2Rate: null,
      }],
    };
    const hash = semanticPayloadHash("official_program", payload);
    db.prepare("INSERT INTO domain_observations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
      "obs-1",
      "2024-06-01:01:R1",
      "official_program",
      "official_program",
      PAYLOAD_SCHEMA_VERSION,
      hash,
      "raw-1",
      "parse-1",
      "2024-06-01T00:00:00.000Z",
      "2024-06-01T00:01:00.000Z",
      "2024-06-01T00:02:00.000Z",
      "source_exact",
      "official_public",
    );
    db.prepare("INSERT INTO typed_observation_payloads VALUES(?,?,?,?,?)").run(
      "obs-1", "official_program", PAYLOAD_SCHEMA_VERSION, JSON.stringify(payload), hash,
    );
  } finally {
    db.close();
  }
}

function validPitEvidence(candidateCount: number): Record<string, unknown> {
  return {
    status: "NOT_APPLICABLE",
    validatorId: "settlement-inventory-pit-applicability",
    validatorVersion: "v1",
    checkedRecordCount: candidateCount,
    sameRaceViolationCount: 0,
    futureViolationCount: 0,
    ambiguousTimingCount: 0,
    evidencePath: null,
    evidenceDigest: null,
    notApplicableReason: "settlement inventory does not join prediction-time features",
  };
}

function writeManifest(
  path: string,
  mutatePit: Record<string, unknown> = {},
  candidateCount = 1,
): void {
  const core: Record<string, unknown> = {
    datasetManifestVersion: "n2-dataset-manifest-v2",
    datasetVersion: "n2-corrected-2000_2026",
    inventoryTotals: { candidates: candidateCount, races: 1 },
    holdoutExcludedFromResearchCohort: true,
    readOnly: true,
  };
  writeFileSync(path, `${JSON.stringify({
    ...core,
    pitEvidence: { ...validPitEvidence(candidateCount), ...mutatePit },
    runId: "manifest-run",
    requestId: "manifest-request",
    taskId: "TASK-N2-010",
    executorVersion: "n2-task-executor-registry-v2",
    generatedAt: "2026-08-05T00:00:00.000Z",
    outputDigest: canonicalHash(core),
  }, null, 2)}\n`);
}

function setup(): { root: string; externalRoot: string; context: ExecutorContext; manifestPath: string } {
  const root = mkdtempSync(join(tmpdir(), "n2-pit-external-repo-"));
  const externalRoot = mkdtempSync(join(tmpdir(), "n2-pit-external-input-"));
  const data = join(root, "data");
  mkdirSync(data, { recursive: true });
  createPrimary(join(data, "boat.sqlite"));
  createSidecar(join(data, "research-replay.sqlite"));
  const manifestPath = join(externalRoot, "n2-dataset-manifest.json");
  writeManifest(manifestPath);
  return {
    root,
    externalRoot,
    manifestPath,
    context: {
      repoRoot: root,
      runId: "run-external-manifest",
      requestId: "REQ-external-manifest",
      taskId: "TASK-N2-011",
      sidecarPath: join(data, "research-replay.sqlite"),
      historyDir: join(root, "reports/automation/history"),
      reportsDir: join(root, "reports/n2"),
      dryRun: false,
      taskStatuses: { "TASK-N2-010": "PASS" },
    },
  };
}

function restoreEnv(previous: string | undefined): void {
  if (previous === undefined) delete process.env[MANIFEST_ENV];
  else process.env[MANIFEST_ENV] = previous;
}

test("external verified manifest is read without creating a worktree input file", () => {
  const { root, externalRoot, context, manifestPath } = setup();
  const previous = process.env[MANIFEST_ENV];
  try {
    process.env[MANIFEST_ENV] = manifestPath;
    const result = runN2PitAuditExecutor(context);
    assert.equal(result.result, "PASS", result.blocks.join("; "));
    assert.equal(existsSync(join(root, "reports/n2/n2-dataset-manifest.json")), false);
    const report = JSON.parse(readFileSync(join(root, "reports/n2/n2-pit-audit.json"), "utf8")) as Record<string, unknown>;
    assert.equal(report.datasetVersion, "n2-corrected-2000_2026");
    assert.equal(report.datasetManifestPitCheckedRecordCount, 1);
  } finally {
    restoreEnv(previous);
    rmSync(root, { recursive: true, force: true });
    rmSync(externalRoot, { recursive: true, force: true });
  }
});

test("external manifest symlink is rejected fail-closed", () => {
  const { root, externalRoot, context, manifestPath } = setup();
  const previous = process.env[MANIFEST_ENV];
  try {
    const linkPath = join(externalRoot, "manifest-link.json");
    symlinkSync(manifestPath, linkPath);
    process.env[MANIFEST_ENV] = linkPath;
    const result = runN2PitAuditExecutor(context);
    assert.equal(result.result, "BLOCKED");
    assert.match(result.blocks.join("\n"), /N2_DATASET_MANIFEST_SYMLINK/);
  } finally {
    restoreEnv(previous);
    rmSync(root, { recursive: true, force: true });
    rmSync(externalRoot, { recursive: true, force: true });
  }
});

test("external manifest PIT violation is rejected even when core digest is valid", () => {
  const { root, externalRoot, context, manifestPath } = setup();
  const previous = process.env[MANIFEST_ENV];
  try {
    writeManifest(manifestPath, { futureViolationCount: 1 });
    process.env[MANIFEST_ENV] = manifestPath;
    const result = runN2PitAuditExecutor(context);
    assert.equal(result.result, "BLOCKED");
    assert.match(result.blocks.join("\n"), /N2_DATASET_MANIFEST_PIT_FUTURE_VIOLATION/);
    assert.doesNotMatch(result.blocks.join("\n"), /OUTPUT_DIGEST_MISMATCH/);
  } finally {
    restoreEnv(previous);
    rmSync(root, { recursive: true, force: true });
    rmSync(externalRoot, { recursive: true, force: true });
  }
});

test("external manifest rejects unsafe integer inventory counts even when digest and PIT evidence agree", () => {
  const { root, externalRoot, context, manifestPath } = setup();
  const previous = process.env[MANIFEST_ENV];
  try {
    const unsafeCount = Number.MAX_SAFE_INTEGER + 1;
    writeManifest(manifestPath, {}, unsafeCount);
    process.env[MANIFEST_ENV] = manifestPath;
    const result = runN2PitAuditExecutor(context);
    assert.equal(result.result, "BLOCKED");
    assert.match(result.blocks.join("\n"), /N2_DATASET_MANIFEST_INVENTORY_CANDIDATES_INVALID/);
    assert.match(result.blocks.join("\n"), /N2_DATASET_MANIFEST_PIT_CHECKED_COUNT_INVALID/);
    assert.doesNotMatch(result.blocks.join("\n"), /OUTPUT_DIGEST_MISMATCH/);
  } finally {
    restoreEnv(previous);
    rmSync(root, { recursive: true, force: true });
    rmSync(externalRoot, { recursive: true, force: true });
  }
});
