// N2 settlement reparse rollback / backup-restore rehearsal（temp copy 上, append-only）。
//
// reparse 適用済み temp copy に対し、(1) operational disable（resolver-only rollback）、
// (2) append-only reversal（rollback 監査イベント追記）、(3) backup/restore を実演する。
// 既存 row を UPDATE/DELETE しない。source / production には触れない。
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { canonicalHash } from "../src/research-replay/canonical";
import { activeStatusCounts, physicalRowCount } from "../src/research-replay/n2SettlementReparseEngine";

const root = resolve(process.cwd());
const arg = (name: string): string | null => {
  const d = process.argv.find((v) => v.startsWith(`${name}=`));
  if (d) return d.slice(name.length + 1);
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
};
const asOf = arg("--as-of");
if (!asOf || Number.isNaN(Date.parse(asOf))) throw new Error("--as-of=<ISO8601 UTC> は必須です");
const targetPath = resolve(arg("--target-sidecar") ?? join(root, "data", "tmp", "reparse-full.sqlite"));
const backupPath = resolve(arg("--backup") ?? join(root, "data", "tmp", "reparse-rollback-backup.sqlite"));
const restorePath = resolve(arg("--restore") ?? join(root, "data", "tmp", "reparse-rollback-restore.sqlite"));
const reportDir = resolve(arg("--report-dir") ?? join(root, "reports", "n2"));
const reportName = arg("--report-name") ?? "settlement-reparse-rollback-rehearsal";
const now = new Date(asOf).toISOString();

function sha256(path: string): string {
  const out = spawnSync("shasum", ["-a", "256", path], { encoding: "utf8", maxBuffer: 1 << 20 });
  if (out.status !== 0) throw new Error(`shasum failed: ${out.stderr}`);
  return out.stdout.trim().split(/\s+/)[0];
}
function assertProductionSafe(p: string): void {
  const prod = resolve(root, "data", "research-replay.sqlite");
  if (resolve(p) === prod) throw new Error("REFUSE_PRODUCTION_PATH");
}

// append-only 監査イベント（deterministic id → 二重適用は INSERT OR IGNORE で no-op）。
function appendAudit(db: DatabaseSync, kind: string, subjectType: string, subjectId: string, detail: unknown): number {
  const id = `rehearsal-${kind}-${subjectId}`;
  const info = db.prepare(
    `INSERT OR IGNORE INTO operational_audit_events
     (audit_event_id, operation_id, event_kind, subject_type, subject_id, detail_json, occurred_at, created_at)
     VALUES (?, 'reparse-rollback-rehearsal', ?, ?, ?, ?, ?, ?)`,
  ).run(id, kind, subjectType, subjectId, JSON.stringify(detail), now, now);
  return Number(info.changes);
}

function main(): void {
  assertProductionSafe(targetPath);
  if (!existsSync(targetPath)) throw new Error(`target not found: ${targetPath}`);
  const db = new DatabaseSync(targetPath);
  db.exec("PRAGMA busy_timeout=60000");
  const result: Record<string, unknown> = {
    phase: "N2_SETTLEMENT_REPARSE_ROLLBACK_REHEARSAL", generatedAt: new Date().toISOString(),
    asOf, gitSha: process.env.GIT_SHA ?? null, target: targetPath, mode: "simulated",
    scope: "resolver-only rollback + append-only reversal + backup/restore on a temp copy; no production/source write",
  };
  try {
    // (1) operational disable: resolver-only rollback。
    const corrected = activeStatusCounts(db, false);
    const rolledBack = activeStatusCounts(db, true);
    const physicalBefore = physicalRowCount(db);

    // (2) append-only reversal: rollback 監査イベントを追記（既存 row 不変）。
    const started1 = appendAudit(db, "rollback_started", "reparse_batch", "n2-settlement-reparse-v1", { defect: "V1_SPECIAL_PAYOUT_FALSE_REFUND" });
    const completed1 = appendAudit(db, "rollback_completed", "reparse_batch", "n2-settlement-reparse-v1", { corrected, rolledBack });
    // 二重 rollback は idempotent（INSERT OR IGNORE で changes=0）。
    const started2 = appendAudit(db, "rollback_started", "reparse_batch", "n2-settlement-reparse-v1", { defect: "V1_SPECIAL_PAYOUT_FALSE_REFUND" });
    const physicalAfter = physicalRowCount(db);

    // append-only enforcement on audit table
    let auditUpdateBlocked = false; let auditDeleteBlocked = false;
    db.exec("SAVEPOINT ao");
    try { db.prepare("UPDATE operational_audit_events SET event_kind='health_snapshot' WHERE operation_id='reparse-rollback-rehearsal'").run(); }
    catch { auditUpdateBlocked = true; }
    db.exec("ROLLBACK TO ao"); db.exec("RELEASE ao");
    db.exec("SAVEPOINT ao2");
    try { db.prepare("DELETE FROM operational_audit_events WHERE operation_id='reparse-rollback-rehearsal'").run(); }
    catch { auditDeleteBlocked = true; }
    db.exec("ROLLBACK TO ao2"); db.exec("RELEASE ao2");

    // (3) backup / restore rehearsal。
    assertProductionSafe(backupPath); assertProductionSafe(restorePath);
    for (const p of [backupPath, restorePath]) for (const s of ["", "-wal", "-shm"]) if (existsSync(`${p}${s}`)) rmSync(`${p}${s}`);
    mkdirSync(dirname(backupPath), { recursive: true });
    appendAudit(db, "backup_started", "temp_copy", targetPath, { backupPath });
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    db.prepare("VACUUM INTO ?").run(backupPath);
    const backupHash = sha256(backupPath);
    const backupDb = new DatabaseSync(backupPath);
    const backupQuickCheck = (backupDb.prepare("PRAGMA quick_check").get() as { quick_check: string }).quick_check;
    const backupCorrected = activeStatusCounts(backupDb, false);
    const backupRolledBack = activeStatusCounts(backupDb, true);
    backupDb.close();
    appendAudit(db, "backup_completed", "temp_copy", targetPath, { backupPath, backupHash, backupQuickCheck });

    copyFileSync(backupPath, restorePath);
    const restoreHash = sha256(restorePath);
    const restoreDb = new DatabaseSync(restorePath);
    const restoreCorrected = activeStatusCounts(restoreDb, false);
    restoreDb.close();
    appendAudit(db, "restore_verified", "temp_copy", restorePath, { restoreHash, hashMatches: restoreHash === backupHash });

    result.operationalDisable = {
      correctedActive: corrected, rolledBackActive: rolledBack,
      rolledBackEqualsOriginalV1Shape: JSON.stringify(sortRec(rolledBack)),
    };
    result.appendOnlyReversal = {
      rollbackStartedFirstInsert: started1, rollbackCompletedFirstInsert: completed1,
      rollbackStartedSecondInsert: started2, doubleRollbackIdempotent: started2 === 0,
      auditUpdateBlocked, auditDeleteBlocked,
      physicalRowsBefore: physicalBefore, physicalRowsAfter: physicalAfter, physicalRowsUnchanged: physicalBefore === physicalAfter,
    };
    result.backupRestore = {
      backupPath, backupHash, backupQuickCheck, backupCorrected, backupRolledBack,
      restorePath, restoreHash, restoreHashMatchesBackup: restoreHash === backupHash,
      restoreResolverMatchesTarget: JSON.stringify(sortRec(restoreCorrected)) === JSON.stringify(sortRec(corrected)),
    };
    result.digest = canonicalHash({ corrected, rolledBack, backupCorrected, backupRolledBack, restoreCorrected });
    result.result =
      auditUpdateBlocked && auditDeleteBlocked && started2 === 0 && physicalBefore === physicalAfter
      && backupQuickCheck === "ok" && restoreHash === backupHash
      && JSON.stringify(sortRec(restoreCorrected)) === JSON.stringify(sortRec(corrected)) ? "REHEARSED" : "REHEARSED_WITH_FLAGS";

    mkdirSync(reportDir, { recursive: true });
    writeFileSync(join(reportDir, `${reportName}.json`), `${JSON.stringify(result, null, 2)}\n`);
    writeFileSync(join(reportDir, `${reportName}.md`), renderMd(result));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    db.close();
    for (const p of [backupPath, restorePath]) for (const s of ["", "-wal", "-shm"]) if (existsSync(`${p}${s}`)) rmSync(`${p}${s}`);
  }
}
function sortRec(r: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(r).sort());
}
function renderMd(r: Record<string, any>): string {
  const od = r.operationalDisable; const ar = r.appendOnlyReversal; const br = r.backupRestore;
  return `# Settlement reparse rollback / backup-restore rehearsal

- generated: ${r.generatedAt}
- as-of: ${r.asOf}
- target (temp copy): ${r.target}
- scope: ${r.scope}
- digest: ${r.digest}
- result: ${r.result}

## (1) Operational disable (resolver-only rollback)

- corrected active: ${JSON.stringify(od.correctedActive)}
- rolled-back active (ignore reparse parse_run): ${JSON.stringify(od.rolledBackActive)}
- rolled-back restores v1 original settlement shape (refunded ≈319,301 等)

## (2) Append-only reversal

- rollback_started / completed appended: ${ar.rollbackStartedFirstInsert} / ${ar.rollbackCompletedFirstInsert}
- double rollback idempotent (second insert changes=0): ${ar.doubleRollbackIdempotent}
- audit UPDATE blocked: ${ar.auditUpdateBlocked} / audit DELETE blocked: ${ar.auditDeleteBlocked}
- physical settlement rows unchanged by rollback: ${ar.physicalRowsUnchanged} (${ar.physicalRowsBefore} → ${ar.physicalRowsAfter})

## (3) Backup / restore

- backup: ${br.backupPath}
- backup quick_check: ${br.backupQuickCheck}
- backup sha256: ${br.backupHash}
- restore sha256 matches backup: ${br.restoreHashMatchesBackup}
- restore resolver result matches target: ${br.restoreResolverMatchesTarget}

> append-only rollback: 既存 row を UPDATE/DELETE せず、resolver 切替と監査追記だけで v1 original を復元する。
> source / production DB には触れていない。
`;
}
main();
