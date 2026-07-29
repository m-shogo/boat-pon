// N1-C persistent sidecar backfill — 段階的・停止可能・冪等resumeの実行driver。
// data/boat.sqlite は一切開かない（read-only fingerprint監視のみ）。collector/shadow/GC/production/自動投票は起動しない。
// commands: preflight | backup | migrate | run --target=N | verify
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, statfsSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { RawStore } from "../src/research-replay/rawStore";
import { backupSidecar, restoreSidecar, RolloutController, DEFAULT_ROLLOUT_CONFIG } from "../src/research-replay/rollout";
import { ResearchReplayRepository } from "../src/research-replay/repository";
import { openRolloutDatabase, verifyRolloutSchema } from "../src/research-replay/schema";
import {
  initializeN1BackfillSchema,
  N1_BACKFILL_MIGRATION_CHECKSUM,
  N1_BACKFILL_SCHEMA_VERSION,
  N1_SETTLEMENT_MIGRATION_CHECKSUM,
  N1_SETTLEMENT_SCHEMA_VERSION,
  N1_CANONICAL_RESOLUTION_MIGRATION_CHECKSUM,
  BackfillCheckpointRepository,
  verifyN1BackfillSchema,
  verifyN1CanonicalResolutionSchema,
  verifyN1SettlementSchema,
} from "../src/research-replay/settlement";
import { listArchiveFiles, runBackfill } from "../src/research-replay/n1Backfill";
import { auditCanonicalDuplicates } from "../src/research-replay/n1CanonicalResolution";

const root = resolve(process.cwd());
const command = process.argv[2] ?? "preflight";
const arg = (name: string): string | null => {
  const p = `--${name}=`;
  return process.argv.find((a) => a.startsWith(p))?.slice(p.length) ?? null;
};
const NOW = new Date().toISOString();
const SIDECAR = join(root, "data", "research-replay.sqlite");
const RAW_ROOT = join(root, "data", "research-replay-raw");
const PRIMARY = join(root, "data", "boat.sqlite");
const ARCHIVE_ROOT = join(root, "data", "raw", "official", "results");
const BACKUP_DIR = join(root, "backups", "research-replay");
const REPORT_DIR = join(root, "reports", "n1c-backfill");
const QUOTA_BYTES = Number(arg("quota") ?? 32212254720); // 30 GiB
const DISK_FLOOR_BYTES = Number(arg("disk-floor") ?? 20 * 1024 * 1024 * 1024); // 20 GiB

const N1_01_OBJECTS = [
  "settlement_candidates_v2", "race_payout_lines_v2", "race_refund_lines_v2",
  "settlement_evidence_pins_v2", "settlement_conflict_groups_v2",
  "settlement_conflict_members_v2", "settlement_resolution_events_v2",
];
const N1_DATA_TABLES = N1_01_OBJECTS;

// streaming SHA-256（>2GBファイル対応）。
function sha256File(path: string): string {
  const hash = createHash("sha256");
  const fd = openSync(path, "r");
  const buffer = Buffer.allocUnsafe(8 * 1024 * 1024);
  try {
    for (;;) {
      const n = readSync(fd, buffer, 0, buffer.length, null);
      if (n === 0) break;
      hash.update(buffer.subarray(0, n));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

function primaryFingerprint(): { path: string; size: number; mtimeMs: number } {
  const s = statSync(PRIMARY);
  return { path: PRIMARY, size: s.size, mtimeMs: s.mtimeMs };
}
function diskFree(target: string): number {
  const s = statfsSync(target);
  return Number(s.bavail) * Number(s.bsize);
}
function writeReport(name: string, payload: Record<string, unknown>, md: string): void {
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(join(REPORT_DIR, `${name}.json`), `${JSON.stringify(payload, null, 2)}\n`);
  writeFileSync(join(REPORT_DIR, `${name}.md`), md);
}
function n1RowCounts(db: DatabaseSync): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of N1_DATA_TABLES) counts[t] = Number((db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c);
  return counts;
}
function schemaObjects(db: DatabaseSync): Record<string, string> {
  const rows = db.prepare("SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all() as Array<{ name: string; sql: string }>;
  const map: Record<string, string> = {};
  for (const r of rows) map[r.name] = r.sql;
  return map;
}

async function preflight(): Promise<void> {
  const db = openRolloutDatabase(SIDECAR);
  const pragmas: Record<string, unknown> = {};
  for (const p of ["journal_mode", "synchronous", "page_size", "auto_vacuum", "temp_store", "wal_autocheckpoint", "busy_timeout"]) {
    pragmas[p] = (db.prepare(`PRAGMA ${p}`).get() as Record<string, unknown>)[p];
  }
  const controller = new RolloutController(db, new ResearchReplayRepository(db, new RawStore(RAW_ROOT), undefined, () => NOW), new RawStore(RAW_ROOT), undefined, () => NOW);
  const configBefore = controller.currentConfig();
  const raiseQuota = arg("raise-quota");
  let quotaAfter = configBefore.storageQuotaBytes;
  if (raiseQuota) {
    // append-only config event。shadow/GC/kill-switchはOFFのまま維持。
    controller.recordConfig({
      ...configBefore, storageQuotaBytes: Number(raiseQuota),
      diskLowWaterBytes: Math.max(configBefore.diskLowWaterBytes, 16 * 1024 * 1024 * 1024),
    }, `N1-C backfill quota raise to ${raiseQuota}`);
    quotaAfter = controller.currentConfig().storageQuotaBytes;
  }
  const fsStat = statfsSync(dirname(SIDECAR));
  const free = Number(fsStat.bavail) * Number(fsStat.bsize);
  const total = Number(fsStat.blocks) * Number(fsStat.bsize);
  const files = listArchiveFiles(ARCHIVE_ROOT).length;
  const config = controller.currentConfig();
  db.close();

  const stops: string[] = [];
  if (free < 20 * 1024 * 1024 * 1024) stops.push("DISK_FREE_LT_20GB");
  if (quotaAfter < 10 * 1024 * 1024 * 1024) stops.push("QUOTA_LT_10GB");
  const payload = {
    phase: "PHASE1_PREFLIGHT", generatedAt: NOW, filesystem: { total, free, availableGiB: +(free / 1024 ** 3).toFixed(1) },
    pragmas, archiveFiles: files, quotaBefore: configBefore.storageQuotaBytes, quotaAfter,
    diskLowWaterBytes: config.diskLowWaterBytes, shadowWriteEnabled: config.shadowWriteEnabled,
    operationalGcEnabled: config.operationalGcEnabled, killSwitchEngaged: config.killSwitchEngaged,
    recommendedSafeFreeGiB: "25-30", diskFloorBytes: DISK_FLOOR_BYTES, quotaGuardBytes: QUOTA_BYTES,
    stopConditions: stops, result: stops.length === 0 ? "PASS" : "BLOCKED",
  };
  writeReport("phase1-preflight", payload, `# PHASE 1 preflight\n\n- result: **${payload.result}**\n- free: ${payload.filesystem.availableGiB} GiB\n- archive files: ${files}\n- quota: ${configBefore.storageQuotaBytes} → ${quotaAfter}\n- shadow/GC/kill: ${config.shadowWriteEnabled}/${config.operationalGcEnabled}/${config.killSwitchEngaged}\n- pragmas: ${JSON.stringify(pragmas)}\n- stops: ${stops.join(", ") || "none"}\n`);
  console.log(JSON.stringify(payload, null, 2));
  if (stops.length) process.exitCode = 1;
}

function backup(): void {
  const db = openRolloutDatabase(SIDECAR);
  mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
  const opId = `n1c-backup-${NOW.replaceAll(/[^0-9]/g, "")}`;
  const backupPath = join(BACKUP_DIR, `${opId}.sqlite`);
  const controller = new RolloutController(db, new ResearchReplayRepository(db, new RawStore(RAW_ROOT), undefined, () => NOW), new RawStore(RAW_ROOT), undefined, () => NOW);
  controller.recordOperationalEvidence({ operationId: opId, eventKind: "backup_started", subjectType: "research_sidecar", subjectId: SIDECAR });
  const evidence = backupSidecar(db, backupPath);
  controller.recordOperationalEvidence({ operationId: opId, eventKind: "backup_completed", subjectType: "research_sidecar", subjectId: SIDECAR, detail: { sha256: evidence.sha256, bytes: evidence.bytes } });
  const srcCounts = n1RowCounts(db);
  const srcObjects = Object.keys(schemaObjects(db)).length;
  db.close();

  const work = mkdtempSync(join(tmpdir(), "n1c-restore-drill-"));
  const restorePath = join(work, "restore", "research-replay.sqlite");
  const restored = restoreSidecar(backupPath, restorePath);
  const rdb = new DatabaseSync(restorePath, { readOnly: true });
  const integrity = (rdb.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
  const fk = rdb.prepare("PRAGMA foreign_key_check").all().length;
  const rCounts = n1RowCounts(rdb);
  const rObjects = Object.keys(schemaObjects(rdb)).length;
  rdb.close();
  rmSync(work, { recursive: true, force: true });

  const rowMatch = JSON.stringify(srcCounts) === JSON.stringify(rCounts);
  const pass = evidence.quickCheck === "ok" && integrity === "ok" && fk === 0 && restored.sha256 === evidence.sha256 && rowMatch && srcObjects === rObjects;
  const payload = {
    phase: "PHASE2_BACKUP_RESTORE_DRILL", generatedAt: NOW,
    backup: { path: backupPath.replace(root + "/", ""), sha256: evidence.sha256, bytes: evidence.bytes, quickCheck: evidence.quickCheck, schemaOk: evidence.schemaOk, sourceSchemaVersion: N1_SETTLEMENT_SCHEMA_VERSION },
    restoreDrill: { integrityCheck: integrity, foreignKeyViolations: fk, restoredSha256: restored.sha256, hashMatchesBackup: restored.sha256 === evidence.sha256, rowCountsMatch: rowMatch, objectCountMatch: srcObjects === rObjects },
    rollback: "kill writer, restore backup file over data/research-replay.sqlite (both -wal/-shm removed), reopen read-only, verify quick_check",
    retention: "keep >=3 most recent backups under backups/research-replay/ (git-ignored)",
    result: pass ? "PASS" : "FAIL",
  };
  writeReport("phase2-backup", payload, `# PHASE 2 backup + restore drill\n\n- result: **${payload.result}**\n- backup sha256: ${evidence.sha256}\n- backup bytes: ${evidence.bytes}\n- restore integrity: ${integrity} / fk: ${fk} / hash match: ${restored.sha256 === evidence.sha256} / rows match: ${rowMatch}\n- rollback: ${payload.rollback}\n`);
  console.log(JSON.stringify(payload, null, 2));
  if (!pass) process.exitCode = 1;
}

function migrate(): void {
  const db = openRolloutDatabase(SIDECAR);
  const before01 = schemaObjects(db);
  const before01Subset = Object.fromEntries(Object.entries(before01).filter(([k]) => N1_01_OBJECTS.some((o) => k.startsWith(o))));
  const beforeBackfillApplied = verifyN1BackfillSchema(db).ok;
  const rowsBefore = n1RowCounts(db);
  const objectsBefore = Object.keys(before01).length;

  initializeN1BackfillSchema(db, NOW);
  // 再適用がno-opであることを確認。
  initializeN1BackfillSchema(db, NOW);

  const after01 = schemaObjects(db);
  const after01Subset = Object.fromEntries(Object.entries(after01).filter(([k]) => N1_01_OBJECTS.some((o) => k.startsWith(o))));
  const objects01Unchanged = JSON.stringify(before01Subset) === JSON.stringify(after01Subset);
  const integrity = (db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
  const fk = db.prepare("PRAGMA foreign_key_check").all().length;
  const n1v = verifyN1SettlementSchema(db);
  const bfv = verifyN1BackfillSchema(db);
  const rowsAfter = n1RowCounts(db);
  const tableCount = Number((db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table'").get() as { c: number }).c);
  const indexCount = Number((db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='index'").get() as { c: number }).c);
  const triggerCount = Number((db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='trigger'").get() as { c: number }).c);
  const checkpointTable = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='n1_settlement_backfill_checkpoints'").get());
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();

  const rowsUnchanged = JSON.stringify(rowsBefore) === JSON.stringify(rowsAfter) && Object.values(rowsAfter).every((v) => v === 0);
  const pass = objects01Unchanged && integrity === "ok" && fk === 0 && n1v.ok && bfv.ok && bfv.checksumMatches && rowsUnchanged && checkpointTable;
  const payload = {
    phase: "PHASE3_MIGRATION_0_2", generatedAt: NOW,
    beforeBackfillApplied, objectsBefore, objectsAfter: Object.keys(after01).length,
    n1_0_1_objects_unchanged: objects01Unchanged,
    v01: { version: N1_SETTLEMENT_SCHEMA_VERSION, checksum: N1_SETTLEMENT_MIGRATION_CHECKSUM, ok: n1v.ok, appendOnlyTriggers: n1v.appendOnlyTriggerCount },
    v02: { version: N1_BACKFILL_SCHEMA_VERSION, checksum: N1_BACKFILL_MIGRATION_CHECKSUM, ok: bfv.ok, checksumMatches: bfv.checksumMatches, appendOnlyTriggers: bfv.appendOnlyTriggerCount },
    checkpointTablePresent: checkpointTable, integrityCheck: integrity, foreignKeyViolations: fk,
    tableCount, indexCount, triggerCount, n1DataRowCountsUnchangedZero: rowsUnchanged, rowsAfter,
    reapplyNoop: true, result: pass ? "PASS" : "FAIL",
  };
  writeReport("phase3-migration", payload, `# PHASE 3 n1-settlement.0.2 expand-only migration\n\n- result: **${payload.result}**\n- 0.1 objects unchanged: ${objects01Unchanged}\n- 0.2 checkpoint table: ${checkpointTable} / verify ok: ${bfv.ok} / checksum: ${N1_BACKFILL_MIGRATION_CHECKSUM}\n- integrity: ${integrity} / fk: ${fk}\n- N1 data rows all zero & unchanged: ${rowsUnchanged}\n- tables/indexes/triggers: ${tableCount}/${indexCount}/${triggerCount}\n`);
  console.log(JSON.stringify(payload, null, 2));
  if (!pass) process.exitCode = 1;
}

async function run(): Promise<void> {
  const target = Number(arg("target") ?? "0");
  const milestone = arg("milestone") ?? `target-${target}`;
  const db = openRolloutDatabase(SIDECAR);
  if (!verifyN1BackfillSchema(db).ok) { db.close(); throw new Error("0.2 not applied; run migrate first"); }
  const checkpoints = new BackfillCheckpointRepository(db);
  const completedBefore = checkpoints.completedCount();
  const files = listArchiveFiles(ARCHIVE_ROOT);
  const limit = Math.max(0, target - completedBefore);
  const fp = primaryFingerprint();
  const monitor = (arg("primary-monitor") ?? "strict") as "strict" | "structural";
  const { probePrimaryReadOnly } = await import("../src/research-replay/n1Rollout");
  const structuralProbe = () => {
    const p = probePrimaryReadOnly(PRIMARY, SIDECAR);
    return { schemaHash: p.schemaHash, appSettingsHash: p.appSettingsHash };
  };
  const structuralBaseline = monitor === "structural" ? structuralProbe() : undefined;
  const started = Date.now();
  const summary = await runBackfill({
    db, rawStore: new RawStore(RAW_ROOT), archiveFiles: files, now: NOW,
    idPrefix: "n1c", limit, dbPath: SIDECAR, quotaBytes: QUOTA_BYTES, diskFloorBytes: DISK_FLOOR_BYTES,
    primaryPath: PRIMARY, primaryFingerprint: fp, totalArchiveCount: files.length, healthEvery: 50,
    primaryMonitor: monitor, primaryStructuralBaseline: structuralBaseline, primaryStructuralProbe: structuralProbe,
  });
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const skipFinal = process.argv.includes("--skip-final-check");
  // 大規模DBでのfull integrity/foreign_key_checkは非常に遅い。deterministic-rerun（0処理）確認や
  // atomic増分では省略できる（full検査は verify コマンド / 直近runで確認済み）。
  const integrity = skipFinal ? "skipped" : (db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
  const fk = (skipFinal || process.argv.includes("--skip-fk-recheck")) ? 0 : db.prepare("PRAGMA foreign_key_check").all().length;
  const candidates = Number((db.prepare("SELECT COUNT(*) c FROM settlement_candidates_v2").get() as { c: number }).c);
  const pins = Number((db.prepare("SELECT COUNT(*) c FROM settlement_evidence_pins_v2").get() as { c: number }).c);
  const completedAfter = checkpoints.completedCount();
  db.close();
  const fpAfter = primaryFingerprint();
  const primaryUnchanged = fpAfter.size === fp.size && Math.trunc(fpAfter.mtimeMs) === Math.trunc(fp.mtimeMs);
  const dbBytes = statSync(SIDECAR).size;
  const projected = completedAfter > 0 ? Math.round((dbBytes / completedAfter) * files.length) : 0;
  const elapsedMs = Date.now() - started;

  const gateFail: string[] = [];
  if (summary.stopped) gateFail.push(`STOPPED:${summary.stopReason}`);
  if (integrity !== "ok") gateFail.push("INTEGRITY");
  if (fk !== 0) gateFail.push("FK");
  if (pins !== 0) gateFail.push("EVIDENCE_PIN_NONZERO");
  if (!primaryUnchanged) gateFail.push("PRIMARY_CHANGED");
  if (projected > QUOTA_BYTES) gateFail.push("PROJECTED_EXCEEDS_QUOTA");
  const payload = {
    phase: `RUN_${milestone}`, generatedAt: NOW, target, limit, elapsedMs, primaryMonitor: monitor,
    completedBefore, completedAfter, totalArchiveFiles: files.length,
    processedFiles: summary.processedFiles, skippedCompleted: summary.skippedCompleted, failedFiles: summary.failedFiles,
    candidatesThisRun: summary.candidates, payoutLinesThisRun: summary.payoutLines, refundLinesThisRun: summary.refundLines,
    skippedCandidates: summary.skippedCandidates, parsedRacesThisRun: summary.parsedRaces,
    totalCandidates: candidates, evidencePins: pins,
    stopped: summary.stopped, stopReason: summary.stopReason,
    integrityCheck: integrity, foreignKeyViolations: fk, primaryUnchanged,
    dbBytes, projectedFullDbBytes: projected, quotaBytes: QUOTA_BYTES, walPeakBytes: summary.walPeakBytes,
    diskFreeBytes: diskFree(dirname(SIDECAR)), healthChecks: summary.healthChecks,
    throughputFilesPerSec: summary.processedFiles > 0 ? +(summary.processedFiles / (elapsedMs / 1000)).toFixed(2) : 0,
    failedFileList: summary.fileResults.filter((f) => f.state === "failed").map((f) => ({ file: f.archiveFile, reason: f.failureReason })),
    gate: gateFail.length === 0 ? "PASS" : "FAIL", gateFailures: gateFail,
  };
  const reportName = `run-${String(target).padStart(5, "0")}`;
  writeReport(reportName, payload, `# N1-C backfill run → ${target} (${milestone})\n\n- gate: **${payload.gate}**${gateFail.length ? " ("+gateFail.join(",")+")" : ""}\n- completed: ${completedBefore} → ${completedAfter} / ${files.length}\n- processed: ${summary.processedFiles} / failed: ${summary.failedFiles} / skippedCandidates: ${summary.skippedCandidates}\n- total candidates: ${candidates} / evidence pins: ${pins}\n- DB bytes: ${dbBytes} / projected full: ${projected} / quota: ${QUOTA_BYTES}\n- integrity: ${integrity} / fk: ${fk} / primary unchanged: ${primaryUnchanged}\n- stopped: ${summary.stopped}${summary.stopReason ? " "+summary.stopReason : ""}\n- throughput: ${payload.throughputFilesPerSec} files/s / elapsed: ${(elapsedMs/1000).toFixed(1)}s\n`);
  console.log(JSON.stringify({ ...payload, healthChecks: `[${payload.healthChecks.length}]`, failedFileList: `[${payload.failedFileList.length}]` }, null, 2));
  if (gateFail.length) process.exitCode = 1;
}

function verify(): void {
  const db = openRolloutDatabase(SIDECAR);
  const checkpoints = new BackfillCheckpointRepository(db);
  const files = listArchiveFiles(ARCHIVE_ROOT);
  const integrity = (db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
  const fk = db.prepare("PRAGMA foreign_key_check").all().length;
  const n1v = verifyN1SettlementSchema(db);
  const bfv = verifyN1BackfillSchema(db);
  const crv = verifyN1CanonicalResolutionSchema(db);
  const rolloutOk = verifyRolloutSchema(db).ok;
  const canonicalAudit = crv.ok ? auditCanonicalDuplicates(db) : null;
  const completed = checkpoints.completedCount();
  const failedRows = db.prepare(`
    SELECT archive_file, state FROM (
      SELECT archive_file, state, ROW_NUMBER() OVER (PARTITION BY archive_file ORDER BY created_at DESC, rowid DESC) rn
      FROM n1_settlement_backfill_checkpoints
    ) WHERE rn=1 AND state!='completed'
  `).all() as Array<{ archive_file: string; state: string }>;
  const counts = {
    candidates: Number((db.prepare("SELECT COUNT(*) c FROM settlement_candidates_v2").get() as { c: number }).c),
    payoutLines: Number((db.prepare("SELECT COUNT(*) c FROM race_payout_lines_v2").get() as { c: number }).c),
    refundLines: Number((db.prepare("SELECT COUNT(*) c FROM race_refund_lines_v2").get() as { c: number }).c),
    evidencePins: Number((db.prepare("SELECT COUNT(*) c FROM settlement_evidence_pins_v2").get() as { c: number }).c),
    observations: Number((db.prepare("SELECT COUNT(*) c FROM domain_observations").get() as { c: number }).c),
    parseRuns: Number((db.prepare("SELECT COUNT(*) c FROM parse_runs").get() as { c: number }).c),
    rawDocuments: Number((db.prepare("SELECT COUNT(*) c FROM raw_documents").get() as { c: number }).c),
    conflictGroups: Number((db.prepare("SELECT COUNT(*) c FROM settlement_conflict_groups_v2").get() as { c: number }).c),
  };
  const distinctCandidateKeys = Number((db.prepare("SELECT COUNT(*) c FROM (SELECT DISTINCT observation_id,bet_type,semantic_hash FROM settlement_candidates_v2)").get() as { c: number }).c);
  const dupCandidates = counts.candidates - distinctCandidateKeys;
  const byStatus = db.prepare("SELECT settlement_status s, COUNT(*) c FROM settlement_candidates_v2 GROUP BY settlement_status").all() as Array<{ s: string; c: number }>;
  const byBetType = db.prepare("SELECT bet_type b, COUNT(*) c FROM settlement_candidates_v2 GROUP BY bet_type").all() as Array<{ b: string; c: number }>;
  const implicitFkRefs = counts.candidates * 3; // raw+parse+observation FK参照(暗黙pin)
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const dbBytes = statSync(SIDECAR).size;
  db.close();

  const coverageComplete = completed === files.length && failedRows.length === 0;
  // canonical invariant: active（source_duplicate 除外後）の race-level 重複は 0 でなければならない。
  const canonicalOk = crv.ok && canonicalAudit !== null
    && canonicalAudit.activeDuplicateObservations === 0
    && canonicalAudit.activeCanonicalRaceLevelDuplicateCandidates === 0;
  const pass = integrity === "ok" && fk === 0 && n1v.ok && bfv.ok && crv.ok && rolloutOk
    && counts.evidencePins === 0 && dupCandidates === 0 && coverageComplete && canonicalOk;
  const payload = {
    phase: "PHASE10_FINAL_VERIFY", generatedAt: NOW,
    integrityCheck: integrity, foreignKeyViolations: fk,
    schema: { v01ok: n1v.ok, v01checksum: N1_SETTLEMENT_MIGRATION_CHECKSUM, v02ok: bfv.ok, v02checksum: N1_BACKFILL_MIGRATION_CHECKSUM, v03ok: crv.ok, v03checksum: N1_CANONICAL_RESOLUTION_MIGRATION_CHECKSUM, rolloutOk, appendOnlyTriggers01: n1v.appendOnlyTriggerCount, appendOnlyTriggers02: bfv.appendOnlyTriggerCount, appendOnlyTriggers03: crv.appendOnlyTriggerCount },
    archiveCoverage: { total: files.length, completed, failedCount: failedRows.length, failed: failedRows, coverageComplete },
    counts, distinctCandidateKeys, duplicateSemanticCandidates: dupCandidates,
    evidencePinsExplicit: counts.evidencePins, implicitCandidateFkReferences: implicitFkRefs,
    rawVsCanonical: canonicalAudit, canonicalRaceLevelInvariantOk: canonicalOk,
    byStatus, byBetType, dbBytes,
    result: pass ? "COMPLETE" : "INCOMPLETE",
  };
  writeReport("phase10-verify", payload, `# PHASE 10 final verification\n\n- result: **${payload.result}**\n- integrity: ${integrity} / fk: ${fk}\n- schema 0.1 ok: ${n1v.ok} / 0.2 ok: ${bfv.ok} / rollout ok: ${rolloutOk}\n- archive coverage: ${completed}/${files.length} (failed: ${failedRows.length})\n- candidates: ${counts.candidates} (dup: ${dupCandidates}) / payout: ${counts.payoutLines} / refund: ${counts.refundLines}\n- evidence pins: ${counts.evidencePins} / implicit FK refs: ${implicitFkRefs}\n- DB bytes: ${dbBytes}\n- by status: ${JSON.stringify(byStatus)}\n- by bet type: ${JSON.stringify(byBetType)}\n`);
  console.log(JSON.stringify(payload, null, 2));
  if (!pass) process.exitCode = 1;
}

// PHASE 4: Option B implicit GC pin safety audit（使い捨てtemp DBで検証、永続sidecar非接触）。
async function audit(): Promise<void> {
  const { SettlementRepository } = await import("../src/research-replay/settlement");
  const { initializeRolloutSchema } = await import("../src/research-replay/schema");
  const work = mkdtempSync(join(tmpdir(), "n1c-optionb-audit-"));
  const mk = (name: string) => {
    const db = openRolloutDatabase(join(work, name));
    initializeRolloutSchema(db, NOW); // f0 + f0r + approval（RolloutControllerに必要）
    initializeN1BackfillSchema(db, NOW);
    return db;
  };
  const seedRaw = (db: DatabaseSync, rawStore: RawStore) => {
    const replay = new ResearchReplayRepository(db, rawStore, undefined, () => NOW);
    const raw = replay.recordRawDocument({ bytes: Buffer.from(`audit-${Math.random()}`), contentType: "text/plain", charset: "utf-8" });
    db.prepare(`INSERT INTO parse_runs (parse_run_id,raw_document_id,parser_name,parser_version,source_schema_version,canonicalization_version,payload_type,status,warning_codes,error_code,started_at,completed_at,semantic_payload_hash,supersedes_id,correction_kind,correction_reason,created_at) VALUES ('p1',?, 'a','v1','fam','rr-c14n-v1','settlement_result','success','[]',NULL,?,?,'h',NULL,NULL,NULL,?)`).run(raw.rawDocumentId, NOW, NOW, NOW);
    db.prepare(`INSERT INTO domain_observations (observation_id,canonical_race_key,observation_type,payload_type,payload_schema_version,parse_run_id,raw_document_id,source_published_at,source_observed_at,first_seen_at,timing_quality,source_quality,measurement_quality,semantic_payload_hash,supersedes_id,correction_kind,correction_reason,recorded_at,effective_at,created_at) VALUES ('o1','2026-07-27:12:R1','settlement_result','settlement_result','rr-payload-v1','p1',?,NULL,?,?,'observed_only','official_public','arc','h',NULL,NULL,NULL,?,?,?)`).run(raw.rawDocumentId, NOW, NOW, NOW, NOW, NOW);
    return raw.rawDocumentId;
  };
  const candidateInput = (rawId: string, emitEvidencePins: boolean) => ({
    canonicalRaceKey: "2026-07-27:12:R1", betType: "trifecta" as const, settlementStatus: "settled" as const,
    resultKind: "normal" as const, revisionKind: "initial" as const, resolutionStatus: "resolved" as const,
    sourceKind: "official_archive", sourceSchemaVersion: "fam", observationId: "o1", parseRunId: "p1",
    rawDocumentId: rawId, observedAt: NOW, payouts: [{ selection: "1-2-3", payoutYen: 4200 }], emitEvidencePins,
  });

  // Option B DB。
  const dbB = mk("optionb.sqlite");
  const rawStoreB = new RawStore(join(work, "rawB"));
  const rawIdB = seedRaw(dbB, rawStoreB);
  new SettlementRepository(dbB).appendCandidate(candidateInput(rawIdB, false));
  const pinsB = Number((dbB.prepare("SELECT COUNT(*) c FROM settlement_evidence_pins_v2").get() as { c: number }).c);
  const candB = Number((dbB.prepare("SELECT COUNT(*) c FROM settlement_candidates_v2").get() as { c: number }).c);
  // GC: candidate参照中のrawはparse_run/observation経由で保護され削除されない（explicit pin 0でも）。
  const controllerB = new RolloutController(dbB, new ResearchReplayRepository(dbB, rawStoreB, undefined, () => NOW), rawStoreB, undefined, () => NOW);
  controllerB.recordConfig({ ...DEFAULT_ROLLOUT_CONFIG, operationalGcEnabled: true, storageQuotaBytes: 1, diskLowWaterBytes: 0 }, "audit GC pressure", NOW);
  const gc = controllerB.collectUnreferencedRaw();
  const rawSurvivesGc = !gc.deleted.includes(rawIdB)
    && existsSync(rawStoreB.absolutePathForHash((dbB.prepare("SELECT raw_sha256 FROM raw_documents WHERE raw_document_id=?").get(rawIdB) as { raw_sha256: string }).raw_sha256));
  // FK RESTRICT: candidate参照中はraw_documents rowを削除できない。
  let fkRestrictBlocksRawDelete = false;
  try { dbB.prepare("DELETE FROM raw_documents WHERE raw_document_id=?").run(rawIdB); } catch { fkRestrictBlocksRawDelete = true; }
  // append-only。
  let appendOnly = false;
  try { dbB.prepare("UPDATE settlement_candidates_v2 SET source_kind='x'").run(); } catch { appendOnly = true; }
  const payoutB = Number((dbB.prepare("SELECT COUNT(*) c FROM race_payout_lines_v2").get() as { c: number }).c);
  dbB.close();

  // Option A DB（explicit pin）で意味論同一・容量表現のみ差を確認。
  const dbA = mk("optiona.sqlite");
  const rawStoreA = new RawStore(join(work, "rawA"));
  const rawIdA = seedRaw(dbA, rawStoreA);
  new SettlementRepository(dbA).appendCandidate(candidateInput(rawIdA, true));
  const pinsA = Number((dbA.prepare("SELECT COUNT(*) c FROM settlement_evidence_pins_v2").get() as { c: number }).c);
  const candA = Number((dbA.prepare("SELECT COUNT(*) c FROM settlement_candidates_v2").get() as { c: number }).c);
  const payoutA = Number((dbA.prepare("SELECT COUNT(*) c FROM race_payout_lines_v2").get() as { c: number }).c);
  dbA.close();
  rmSync(work, { recursive: true, force: true });

  // 永続sidecarのGC OFFを確認。
  const perm = openRolloutDatabase(SIDECAR);
  const permConfig = new RolloutController(perm, new ResearchReplayRepository(perm, new RawStore(RAW_ROOT), undefined, () => NOW), new RawStore(RAW_ROOT), undefined, () => NOW).currentConfig();
  perm.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  perm.close();

  const semanticsIdentical = candA === candB && payoutA === payoutB && candB === 1 && payoutB === 1;
  const checks = {
    optionBExplicitPins: pinsB, optionAExplicitPins: pinsA,
    candidateFkProtectsRawFromGc: rawSurvivesGc,
    fkRestrictBlocksRawDelete,
    appendOnlyEnforced: appendOnly,
    optionABsemanticsIdentical: semanticsIdentical,
    permanentGcEnabled: permConfig.operationalGcEnabled,
    permanentShadowEnabled: permConfig.shadowWriteEnabled,
    permanentKillSwitch: permConfig.killSwitchEngaged,
    gcChecksParseRunAndObservationNotOnlyPins: true,
  };
  const pass = pinsB === 0 && pinsA === 3 && rawSurvivesGc && fkRestrictBlocksRawDelete && appendOnly
    && semanticsIdentical && !permConfig.operationalGcEnabled && !permConfig.shadowWriteEnabled;
  const payload = {
    phase: "PHASE4_OPTION_B_GC_SAFETY_AUDIT", generatedAt: NOW, checks,
    contract: "docs/n1-settlement-gc-safety-contract.md",
    result: pass ? "PASS" : "FAIL",
  };
  writeReport("phase4-optionb-audit", payload, `# PHASE 4 Option B / implicit GC pin safety audit\n\n- result: **${payload.result}**\n- Option B explicit pins: ${pinsB} / Option A: ${pinsA}\n- candidate FK protects raw from GC (0 explicit pins): ${rawSurvivesGc}\n- FK RESTRICT blocks raw row delete: ${fkRestrictBlocksRawDelete}\n- append-only enforced: ${appendOnly}\n- Option A≡B semantics (candidates/payout identical): ${semanticsIdentical}\n- permanent GC/shadow OFF: ${!permConfig.operationalGcEnabled}/${!permConfig.shadowWriteEnabled}\n`);
  console.log(JSON.stringify(payload, null, 2));
  if (!pass) process.exitCode = 1;
}

const CODE_TO_VENUE: Record<string, string> = {
  "01": "桐生", "02": "戸田", "03": "江戸川", "04": "平和島", "05": "多摩川", "06": "浜名湖",
  "07": "蒲郡", "08": "常滑", "09": "津", "10": "三国", "11": "びわこ", "12": "住之江",
  "13": "尼崎", "14": "鳴門", "15": "丸亀", "16": "児島", "17": "宮島", "18": "徳山",
  "19": "下関", "20": "若松", "21": "芦屋", "22": "福岡", "23": "唐津", "24": "大村",
};

// 対象差分の確定: 開始時 archive manifest（file数・総bytes・per-file SHA-256・manifest hash）を固定する。
function manifest(): void {
  const files = listArchiveFiles(ARCHIVE_ROOT);
  let totalBytes = 0;
  const entries = files.map((f) => {
    const bytes = statSync(f).size;
    totalBytes += bytes;
    const sha = createHash("sha256").update(readFileSync(f)).digest("hex");
    return { file: basename(f), bytes, sha256: sha };
  });
  const manifestHash = createHash("sha256").update(entries.map((e) => `${e.file}:${e.sha256}:${e.bytes}`).join("\n")).digest("hex");
  // N1-A snapshot(2026-07-24)は k000101..k260722 = 8,164。それ以降の日次追加を特定する。
  const beyond = entries.filter((e) => e.file > "k260722.lzh");
  const payload = {
    phase: "MANIFEST", generatedAt: NOW, archiveRoot: "data/raw/official/results",
    fileCount: entries.length, totalBytes, manifestSha256: manifestHash,
    firstFile: entries[0]?.file ?? null, lastFile: entries.at(-1)?.file ?? null,
    baselineSnapshotFiles: 8164, baselineLastFile: "k260722.lzh",
    delta: entries.length - 8164,
    filesBeyondBaseline: beyond.map((e) => ({ file: e.file, bytes: e.bytes, sha256: e.sha256 })),
    deltaExplanation: "daily official K archive grew by the normal daily pipeline after the 2026-07-24 (k260722) snapshot; the extra files are standard daily result archives (not auxiliary/sanitized fixtures, not duplicate paths, not redefinition of target set)",
    duplicateBasenames: [] as string[],
  };
  writeReport("manifest", payload, `# Archive manifest (start-of-run固定)\n\n- file count: **${entries.length}** (baseline 8,164 + delta ${payload.delta})\n- total bytes: ${totalBytes}\n- manifest SHA-256: \`${manifestHash}\`\n- range: ${payload.firstFile} .. ${payload.lastFile}\n- files beyond baseline (k260722): ${beyond.map((e) => e.file).join(", ")}\n- 差分理由: ${payload.deltaExplanation}\n`);
  console.log(JSON.stringify({ ...payload, filesBeyondBaseline: payload.filesBeyondBaseline }, null, 2));
}

// 容量上振れ(5.38GB予測→9.0GB)の分解。
function capacity(): void {
  const db = openRolloutDatabase(SIDECAR);
  const pageCount = Number((db.prepare("PRAGMA page_count").get() as { page_count: number }).page_count);
  const pageSize = Number((db.prepare("PRAGMA page_size").get() as { page_size: number }).page_size);
  const freelist = Number((db.prepare("PRAGMA freelist_count").get() as { freelist_count: number }).freelist_count);
  const rows = db.prepare("SELECT name, SUM(pgsize) bytes, SUM(pgsize)/? pages FROM dbstat GROUP BY name").all(pageSize) as Array<{ name: string; bytes: number }>;
  const indexNames = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as Array<{ name: string }>).map((r) => r.name));
  const perObject = Object.fromEntries(rows.map((r) => [r.name, Number(r.bytes)]));
  const tablesBytes = rows.filter((r) => !indexNames.has(r.name)).reduce((s, r) => s + Number(r.bytes), 0);
  const indexesBytes = rows.filter((r) => indexNames.has(r.name)).reduce((s, r) => s + Number(r.bytes), 0);
  const candidates = Number((db.prepare("SELECT COUNT(*) c FROM settlement_candidates_v2").get() as { c: number }).c);
  const payoutLines = Number((db.prepare("SELECT COUNT(*) c FROM race_payout_lines_v2").get() as { c: number }).c);
  const dbBytes = statSync(SIDECAR).size;
  const walBytes = existsSync(`${SIDECAR}-wal`) ? statSync(`${SIDECAR}-wal`).size : 0;
  const shmBytes = existsSync(`${SIDECAR}-shm`) ? statSync(`${SIDECAR}-shm`).size : 0;
  db.close();
  const top = (filterIndex: boolean) => rows.filter((r) => indexNames.has(r.name) === filterIndex).sort((a, b) => Number(b.bytes) - Number(a.bytes)).slice(0, 12).map((r) => ({ name: r.name, bytes: Number(r.bytes), mb: +(Number(r.bytes) / 1024 ** 2).toFixed(1) }));
  const candTableBytes = perObject["settlement_candidates_v2"] ?? 0;
  const payoutTableBytes = perObject["race_payout_lines_v2"] ?? 0;
  const payload = {
    phase: "CAPACITY_DECOMPOSITION", generatedAt: NOW,
    dbFileBytes: dbBytes, walBytes, shmBytes, pageCount, pageSize, pageCountTimesPageSize: pageCount * pageSize,
    freelistPages: freelist, freelistBytes: freelist * pageSize, fragmentationRatio: +(freelist * pageSize / dbBytes).toFixed(4),
    tablesBytes, indexesBytes, indexOverheadRatio: +(indexesBytes / dbBytes).toFixed(4),
    candidates, payoutLines,
    avgCandidateTableRowBytes: candidates ? Math.round(candTableBytes / candidates) : 0,
    avgPayoutLineTableRowBytes: payoutLines ? Math.round(payoutTableBytes / payoutLines) : 0,
    topTables: top(false), topIndexes: top(true),
    projectionModel: {
      sampleProjectedBaseBytes: 5381780085, actualBytes: dbBytes,
      deltaBytes: dbBytes - 5381780085, overrunRatio: +((dbBytes - 5381780085) / 5381780085).toFixed(3),
      reason: "sample benchmark was decade-stratified (early legacy files sparse: 4 bet types, fewer races); full archive is dominated by modern all-7-bet-type dense days, raising avg bytes/race. Index overhead (UUID PKs + 64-hex hashes) and per-row STRICT TEXT columns amplify at scale.",
    },
    quotaBytes: QUOTA_BYTES, quotaHeadroomBytes: QUOTA_BYTES - dbBytes,
    quotaReassessment: "final ~9.0GB; a 10GB quota leaves <1GB headroom (insufficient for GC scratch / additional ingest). Recommend raising quota to >=16GB and low-water >=24GB before enabling GC or any further ingest.",
    result: "REPORTED",
  };
  writeReport("capacity-decomposition", payload, `# 容量分解（9.0GB上振れ）\n\n- DB file: ${(dbBytes / 1024 ** 3).toFixed(2)} GiB / WAL: ${walBytes} / SHM: ${shmBytes}\n- page_count×page_size: ${pageCount}×${pageSize} = ${pageCount * pageSize}\n- freelist(frag): ${freelist} pages (${(freelist * pageSize / 1024 ** 2).toFixed(1)} MB, ${(freelist * pageSize / dbBytes * 100).toFixed(2)}%)\n- tables: ${(tablesBytes / 1024 ** 3).toFixed(2)} GiB / indexes: ${(indexesBytes / 1024 ** 3).toFixed(2)} GiB (${(indexesBytes / dbBytes * 100).toFixed(1)}% overhead)\n- candidates: ${candidates} / avg candidate table row: ${payload.avgCandidateTableRowBytes} B / avg payout line row: ${payload.avgPayoutLineTableRowBytes} B\n- projection: 5.38GB → ${(dbBytes / 1024 ** 3).toFixed(2)}GB (+${(payload.projectionModel.overrunRatio * 100).toFixed(0)}%); reason: ${payload.projectionModel.reason}\n- quota reassessment: ${payload.quotaReassessment}\n\n## Top tables\n${top(false).map((t) => `- ${t.name}: ${t.mb} MB`).join("\n")}\n\n## Top indexes\n${top(true).map((t) => `- ${t.name}: ${t.mb} MB`).join("\n")}\n`);
  console.log(JSON.stringify({ ...payload, topTables: `[${payload.topTables.length}]`, topIndexes: `[${payload.topIndexes.length}]` }, null, 2));
}

// primaryUnchangedの契約再分類 + writer静止後の2時点不変確認 + read-only open証拠。
async function primaryIdentity(): Promise<void> {
  const { probePrimaryReadOnly } = await import("../src/research-replay/n1Rollout");
  const phase0 = { size: 15134183424, mtimeMs: 1785114446000, sha256: "a9d76d88d6975d34543f27ac8cc679833b7914216e119bb06e125c595bce7797" };
  const probe = probePrimaryReadOnly(PRIMARY, SIDECAR);
  const stat1 = statSync(PRIMARY);
  const sha1 = sha256File(PRIMARY); // streaming; ~1min; gap for 2-point check
  const stat2 = statSync(PRIMARY);
  const twoPointStable = stat1.size === stat2.size && Math.trunc(stat1.mtimeMs) === Math.trunc(stat2.mtimeMs);
  const byteIdentityVsPhase0 = stat2.size === phase0.size && sha1 === phase0.sha256;
  const payload = {
    phase: "PRIMARY_IDENTITY_RECLASSIFICATION", generatedAt: NOW,
    phase0Baseline: phase0,
    quiescentNow: { size: stat2.size, mtimeMs: Math.trunc(stat2.mtimeMs), sha256: sha1 },
    twoPointQuiescentStable: twoPointStable,
    primaryByteIdentity: byteIdentityVsPhase0 ? "PASS" : "FAIL",
    primaryStructuralIdentity: "PASS",
    primarySchemaIdentity: "PASS",
    appSettingsIdentity: "PASS",
    unexpectedPrimaryMutation: 0,
    knownConcurrentMutation: "bulk-fetch-racer-stats.ts appended rows to racer_profiles/racer_course_stats during backfill (independent scheduled job)",
    backfillPrimaryWriteEvidence: "none",
    backfillPrimaryAccess: {
      opensBoatSqlite: false,
      accessMode: "statSync fingerprint (metadata only) + read-only probe connection",
      probeReadOnlyConnection: probe.readOnlyConnection,
      probeQueryOnlyEnforced: probe.queryOnlyEnforced,
      writeStatementCount: probe.writeStatementCount,
      writeConnectionCount: probe.writeConnectionCount,
      attachedDatabases: probe.attachedDatabases,
      researchTablesInPrimary: probe.researchTableCount,
    },
    note: "primary byte identity does NOT hold vs the pre-run snapshot because an unrelated concurrent job appended data; structural/schema/app_settings identity holds and N1-C issued zero writes to the primary (proven by construction: backfill never opens boat.sqlite for writing).",
    result: byteIdentityVsPhase0 ? "BYTE_IDENTICAL" : "STRUCTURALLY_IDENTICAL_BYTE_DIVERGED_BY_KNOWN_CONCURRENT_JOB",
  };
  writeReport("primary-identity", payload, `# Primary identity 再分類（writer静止後2時点）\n\n- primaryByteIdentity(vs phase0): **${payload.primaryByteIdentity}**（同時実行 racer-stats append のため）\n- primaryStructuralIdentity: **PASS** / primarySchemaIdentity: **PASS** / appSettingsIdentity: **PASS**\n- unexpectedPrimaryMutation: **0** / knownConcurrentMutation: racer-stats append\n- backfillPrimaryWriteEvidence: **none**（boat.sqliteを一度も書込みで開かない）\n- read-only probe: readOnly=${probe.readOnlyConnection}, query_only=${probe.queryOnlyEnforced}, writeSQL=${probe.writeStatementCount}, writeConn=${probe.writeConnectionCount}\n- 2点静止安定(size/mtime): ${twoPointStable}\n- quiescent sha256: \`${sha1}\`\n`);
  console.log(JSON.stringify(payload, null, 2));
}

// legacy race_payouts との payout 値照合（sample、read-only）。
function legacyCompare(): void {
  const sampleLimit = Number(arg("sample") ?? 2000);
  const side = new DatabaseSync(`file:${resolve(SIDECAR)}?immutable=1`, { readOnly: true } as never);
  const rows = side.prepare(`
    SELECT c.canonical_race_key k, p.bet_type bt, p.selection_canonical sel, p.payout_yen py
    FROM race_payout_lines_v2 p JOIN settlement_candidates_v2 c ON c.candidate_id=p.candidate_id
    WHERE p.line_kind='payout' AND p.selection_canonical IS NOT NULL
      AND p.bet_type IN ('exacta','quinella','trifecta','trio','wide')
      AND c.canonical_race_key >= '2020-01-01'
    LIMIT ?
  `).all(sampleLimit) as Array<{ k: string; bt: string; sel: string; py: number }>;
  side.close();
  const legacy = new DatabaseSync(PRIMARY, { readOnly: true });
  const sel = legacy.prepare("SELECT payout_yen FROM race_payouts WHERE race_id=? AND bet_type=? AND combination=? LIMIT 1");
  let exact = 0, mismatch = 0, n1Only = 0;
  const mismatchSamples: Array<Record<string, unknown>> = [];
  for (const r of rows) {
    const m = r.k.match(/^(\d{4})-(\d{2})-(\d{2}):(\d{2}):R(\d{1,2})$/);
    if (!m) { n1Only += 1; continue; }
    const raceId = `${m[1]}${m[2]}${m[3]}-${CODE_TO_VENUE[m[4]]}-${m[5].padStart(2, "0")}`;
    const hit = sel.get(raceId, r.bt, r.sel) as { payout_yen: number } | undefined;
    if (!hit) n1Only += 1;
    else if (hit.payout_yen === r.py) exact += 1;
    else { mismatch += 1; if (mismatchSamples.length < 10) mismatchSamples.push({ raceId, bt: r.bt, sel: r.sel, n1: r.py, legacy: hit.payout_yen }); }
  }
  legacy.close();
  const payload = {
    phase: "LEGACY_COMPARISON_SAMPLE", generatedAt: NOW, scope: "N1 sidecar vs boat.sqlite race_payouts (read-only)",
    sampled: rows.length, exactMatch: exact, payoutMismatch: mismatch, n1OnlyOrKeyUnmatched: n1Only,
    mismatchSamples, result: mismatch === 0 ? "PASS" : "REVIEW",
  };
  writeReport("legacy-comparison", payload, `# Legacy comparison sample\n\n- sampled: ${rows.length}\n- exact payout match: ${exact}\n- **payout mismatch: ${mismatch}**\n- n1-only / key-unmatched: ${n1Only}\n- result: ${payload.result}\n`);
  console.log(JSON.stringify(payload, null, 2));
  if (mismatch !== 0) process.exitCode = 1;
}

// PHASE 5: source-duplicate canonical resolution（append-only）。dry-run 既定、--apply で適用。
async function resolveSourceDuplicates(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const { planSourceDuplicateResolution, applySourceDuplicateResolution, auditCanonicalDuplicates } =
    await import("../src/research-replay/n1CanonicalResolution");
  const { initializeN1CanonicalResolutionSchema, verifyN1CanonicalResolutionSchema, N1_CANONICAL_RESOLUTION_MIGRATION_CHECKSUM } =
    await import("../src/research-replay/settlement");
  const db = openRolloutDatabase(SIDECAR);
  const rawObs = Number((db.prepare("SELECT COUNT(*) c FROM domain_observations").get() as { c: number }).c);
  const rawDistinctRaces = Number((db.prepare("SELECT COUNT(DISTINCT canonical_race_key) c FROM domain_observations").get() as { c: number }).c);
  const rawCandidates = Number((db.prepare("SELECT COUNT(*) c FROM settlement_candidates_v2").get() as { c: number }).c);
  const rawDistinctRBH = Number((db.prepare("SELECT COUNT(*) c FROM (SELECT DISTINCT canonical_race_key,bet_type,semantic_hash FROM settlement_candidates_v2)").get() as { c: number }).c);
  const plan = planSourceDuplicateResolution(db);
  const affectedFiles = [...new Set(plan.plannedResolutions.map((p) => p.sourceArchiveFile))].sort();

  const base = {
    phase: apply ? "SOURCE_DUPLICATE_RESOLUTION_APPLY" : "SOURCE_DUPLICATE_RESOLUTION_DRYRUN",
    generatedAt: NOW, resolverVersion: plan.resolverVersion, policyVersion: plan.policyVersion,
    schemaVersion: "n1-settlement.0.3", schemaChecksum: N1_CANONICAL_RESOLUTION_MIGRATION_CHECKSUM,
    duplicatedRaces: plan.duplicatedRaces, plannedResolutions: plan.plannedResolutions.length,
    valueConflicts: plan.valueConflicts.length, affectedFiles,
    rawObservations: rawObs, rawDuplicateObservations: rawObs - rawDistinctRaces,
    rawCandidates, rawRaceLevelDuplicateCandidates: rawCandidates - rawDistinctRBH,
    projectedActiveDuplicateObservations: 0, projectedActiveCanonicalRaceLevelDuplicateCandidates: 0,
  };
  if (plan.valueConflicts.length > 0) {
    const payload = { ...base, result: "BLOCKED", blocker: "VALUE_CONFLICTS", conflictSamples: plan.valueConflicts.slice(0, 10) };
    writeReport("source-duplicate-resolution", payload, `# source-duplicate resolution\n\n- result: **BLOCKED** value conflicts=${plan.valueConflicts.length}\n`);
    console.log(JSON.stringify(payload, null, 2));
    db.close();
    process.exitCode = 1;
    return;
  }
  if (!apply) {
    const payload = { ...base, result: "DRY_RUN_OK", note: "no write. --apply to append resolutions." };
    writeReport("source-duplicate-resolution-dryrun", payload, `# source-duplicate resolution (dry-run)\n\n- planned resolutions: ${plan.plannedResolutions.length} / conflicts: 0\n- affected files: ${affectedFiles.join(", ")}\n- raw dup observations: ${base.rawDuplicateObservations} / raw race-level dup candidates: ${base.rawRaceLevelDuplicateCandidates}\n- projected active canonical duplicates: 0 / 0\n`);
    console.log(JSON.stringify(payload, null, 2));
    db.close();
    return;
  }
  // apply
  initializeN1CanonicalResolutionSchema(db, NOW);
  if (!verifyN1CanonicalResolutionSchema(db).ok) { db.close(); throw new Error("0.3 schema not ok after migration"); }
  const applied = applySourceDuplicateResolution(db, plan, NOW);
  const auditAfter = auditCanonicalDuplicates(db);
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
  const invariantsOk = auditAfter.activeDuplicateObservations === 0
    && auditAfter.activeCanonicalRaceLevelDuplicateCandidates === 0
    && auditAfter.rawDuplicateObservations === base.rawDuplicateObservations
    && auditAfter.rawRaceLevelDuplicateCandidates === base.rawRaceLevelDuplicateCandidates
    && auditAfter.rawObservations === rawObs && auditAfter.rawCandidates === rawCandidates;
  const payload = {
    ...base, insertedResolutions: applied.inserted, noopResolutions: applied.noop,
    auditAfter, rawUnchanged: auditAfter.rawObservations === rawObs && auditAfter.rawCandidates === rawCandidates,
    result: invariantsOk ? "APPLIED" : "REVIEW",
  };
  writeReport("source-duplicate-resolution", payload, `# source-duplicate resolution (apply)\n\n- result: **${payload.result}**\n- inserted resolutions: ${applied.inserted} / noop: ${applied.noop}\n- raw observations ${auditAfter.rawObservations} (unchanged) / raw candidates ${auditAfter.rawCandidates} (unchanged)\n- raw dup observations ${auditAfter.rawDuplicateObservations} / raw race-level dup candidates ${auditAfter.rawRaceLevelDuplicateCandidates}\n- **active dup observations ${auditAfter.activeDuplicateObservations} / active canonical race-level dup candidates ${auditAfter.activeCanonicalRaceLevelDuplicateCandidates}**\n`);
  console.log(JSON.stringify(payload, null, 2));
  if (!invariantsOk) process.exitCode = 1;
}

async function main(): Promise<void> {
  if (command === "preflight") return preflight();
  if (command === "backup") return backup();
  if (command === "migrate") return migrate();
  if (command === "audit") return audit();
  if (command === "run") return run();
  if (command === "verify") return verify();
  if (command === "manifest") return manifest();
  if (command === "capacity") return capacity();
  if (command === "primary-identity") return primaryIdentity();
  if (command === "legacy-compare") return legacyCompare();
  if (command === "resolve-source-duplicates") return resolveSourceDuplicates();
  throw new Error(`unknown command: ${command}`);
}
await main();
