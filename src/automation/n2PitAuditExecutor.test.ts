import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { canonicalHash } from "../research-replay/canonical";
import { PAYLOAD_SCHEMA_VERSION, semanticPayloadHash } from "../research-replay/domain";
import { runN2PitAuditExecutor } from "./n2PitAuditExecutor";
import type { ExecutorContext } from "./taskExecutors";

function createPrimary(path: string): void {
  const db = new DatabaseSync(path);
  try {
    db.exec(`CREATE TABLE official_programs (
      race_id TEXT PRIMARY KEY, date TEXT NOT NULL, venue TEXT NOT NULL,
      race_no INTEGER NOT NULL, close_at TEXT
    )`);
    db.prepare(`INSERT INTO official_programs VALUES(?,?,?,?,?)`)
      .run("20240601-桐生-01", "2024-06-01", "桐生", 1, "10:00");
  } finally { db.close(); }
}

function createSidecar(path: string, mode: "safe" | "future" | "empty"): void {
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
    if (mode === "empty") return;
    db.prepare(`INSERT INTO raw_documents VALUES(?,?,?,?)`).run("raw-1", "verified", "passed", 1);
    db.prepare(`INSERT INTO parse_runs VALUES(?,?,?)`).run("parse-1", "raw-1", "success");
    const publishedAt = mode === "future" ? "2024-06-01T01:00:00.001Z" : "2024-06-01T00:00:00.000Z";
    const observedAt = mode === "future" ? "2024-06-01T01:00:01.000Z" : "2024-06-01T00:01:00.000Z";
    const firstSeenAt = mode === "future" ? "2024-06-01T01:00:02.000Z" : "2024-06-01T00:02:00.000Z";
    const payload = {
      canonicalRaceKey: "2024-06-01:01:R1",
      observedAt,
      boats: [{
        course: 1, registrationNo: null, className: null,
        nationalWinRate: null, nationalTop2Rate: null, localWinRate: null, localTop2Rate: null,
        motorTop2Rate: null, boatTop2Rate: null,
      }],
    };
    const hash = semanticPayloadHash("official_program", payload);
    db.prepare(`INSERT INTO domain_observations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      "obs-1", "2024-06-01:01:R1", "official_program", "official_program", PAYLOAD_SCHEMA_VERSION, hash,
      "raw-1", "parse-1", publishedAt, observedAt, firstSeenAt, "source_exact", "official_public",
    );
    db.prepare(`INSERT INTO typed_observation_payloads VALUES(?,?,?,?,?)`).run(
      "obs-1", "official_program", PAYLOAD_SCHEMA_VERSION, JSON.stringify(payload), hash,
    );
  } finally { db.close(); }
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
  root: string,
  mutateCore: Record<string, unknown> = {},
  mutatePit: Record<string, unknown> = {},
): void {
  const core: Record<string, unknown> = {
    datasetManifestVersion: "n2-dataset-manifest-v2",
    datasetVersion: "n2-corrected-2014_2026",
    inventoryTotals: { candidates: 1, races: 1 },
    holdoutExcludedFromResearchCohort: true,
    readOnly: true,
    ...mutateCore,
  };
  const candidateCount = Number((core.inventoryTotals as Record<string, unknown>).candidates);
  mkdirSync(join(root, "reports/n2"), { recursive: true });
  writeFileSync(join(root, "reports/n2/n2-dataset-manifest.json"), `${JSON.stringify({
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

function setup(mode: "safe" | "future" | "empty" = "safe"): { root: string; context: ExecutorContext } {
  const root = mkdtempSync(join(tmpdir(), "n2-pit-executor-"));
  const data = join(root, "data");
  mkdirSync(data, { recursive: true });
  createPrimary(join(data, "boat.sqlite"));
  createSidecar(join(data, "research-replay.sqlite"), mode);
  writeManifest(root);
  return {
    root,
    context: {
      repoRoot: root,
      runId: "run-pit-1",
      requestId: "REQ-pit-1",
      taskId: "TASK-N2-011",
      sidecarPath: join(data, "research-replay.sqlite"),
      historyDir: join(root, "reports/automation/history"),
      reportsDir: join(root, "reports/n2"),
      dryRun: false,
      taskStatuses: { "TASK-N2-010": "PASS" },
    },
  };
}

test("safe real PIT evidence writes a verified PASS report", () => {
  const { root, context } = setup("safe");
  try {
    const result = runN2PitAuditExecutor(context);
    assert.equal(result.result, "PASS", result.blocks.join("; "));
    assert.deepEqual(result.outputs, ["reports/n2/n2-pit-audit.json"]);
    const reportPath = join(root, result.outputs[0]);
    assert.equal(existsSync(reportPath), true);
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as Record<string, any>;
    assert.equal(report.status, "PASS");
    assert.equal(report.auditedObservationCount, 1);
    assert.equal(report.executorContractVersion, "n2-pit-audit-executor-v3");
    assert.equal(report.datasetManifestPitValidatorId, "settlement-inventory-pit-applicability");
    assert.equal(report.datasetManifestPitCheckedRecordCount, 1);
    assert.equal(report.pitEvidence.status, "PASS");
    assert.equal(report.pitEvidence.futureViolationCount, 0);
    assert.equal(report.sidecarWriteCount, 0);
    assert.equal(report.primaryDbWriteCount, 0);
    assert.equal(report.productionApplyExecuted, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("empty real evidence is persisted as CONDITIONAL, never fabricated PASS", () => {
  const { root, context } = setup("empty");
  try {
    const result = runN2PitAuditExecutor(context);
    assert.equal(result.result, "CONDITIONAL", result.blocks.join("; "));
    const report = JSON.parse(readFileSync(join(root, "reports/n2/n2-pit-audit.json"), "utf8")) as Record<string, any>;
    assert.equal(report.dataStatus, "PENDING_REAL_DATA");
    assert.equal(report.status, "CONDITIONAL");
    assert.equal(report.auditedObservationCount, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("future leakage is BLOCKED before artifact PASS", () => {
  const { root, context } = setup("future");
  try {
    const result = runN2PitAuditExecutor(context);
    assert.equal(result.result, "BLOCKED");
    assert.match(result.blocks.join("\n"), /PIT_OR_LEAKAGE_VIOLATION/);
    assert.equal((result.summary.pitEvidence as Record<string, unknown>).futureViolationCount, 1);
    assert.equal(existsSync(join(root, "reports/n2/n2-pit-audit.json")), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("dependency must be PASS", () => {
  const { root, context } = setup("safe");
  try {
    context.taskStatuses["TASK-N2-010"] = "READY";
    const result = runN2PitAuditExecutor(context);
    assert.equal(result.result, "BLOCKED");
    assert.match(result.blocks.join("\n"), /DEPENDENCY_NOT_SATISFIED/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("active WAL blocks without checkpointing or deleting it", () => {
  const { root, context } = setup("safe");
  try {
    const wal = `${context.sidecarPath}-wal`;
    writeFileSync(wal, "active");
    const result = runN2PitAuditExecutor(context);
    assert.equal(result.result, "BLOCKED");
    assert.match(result.blocks.join("\n"), /SIDECAR_ACTIVE_WAL/);
    assert.equal(readFileSync(wal, "utf8"), "active");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("manifest core identity and digest are fail-closed", () => {
  const { root, context } = setup("safe");
  try {
    const path = join(root, "reports/n2/n2-dataset-manifest.json");
    const manifest = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    manifest.datasetVersion = "tampered";
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
    const result = runN2PitAuditExecutor(context);
    assert.equal(result.result, "BLOCKED");
    assert.match(result.blocks.join("\n"), /N2_DATASET_MANIFEST_OUTPUT_DIGEST_MISMATCH/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("manifest SDK PIT envelope is independently fail-closed", () => {
  const { root, context } = setup("safe");
  try {
    writeManifest(root, {}, { checkedRecordCount: 2 });
    const result = runN2PitAuditExecutor(context);
    assert.equal(result.result, "BLOCKED");
    assert.match(result.blocks.join("\n"), /N2_DATASET_MANIFEST_PIT_CHECKED_COUNT_MISMATCH/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("dry-run validates and audits but performs no write and never returns PASS", () => {
  const { root, context } = setup("safe");
  try {
    context.dryRun = true;
    const result = runN2PitAuditExecutor(context);
    assert.equal(result.result, "DRY_RUN_OK");
    assert.deepEqual(result.outputs, []);
    assert.equal(existsSync(join(root, "reports/n2/n2-pit-audit.json")), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
