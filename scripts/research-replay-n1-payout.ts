import {
  closeSync,
  fsyncSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  auditAllLocalKArchives,
  reconcileSanitizedKFixture,
} from "../src/research-replay/n1SettlementAudit";
import {
  initializeN1SettlementSchema,
  verifyN1SettlementSchema,
} from "../src/research-replay/settlement";
import { initializeSidecarSchema, openSidecarDatabase } from "../src/research-replay/schema";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const root = resolve(process.cwd());
const command = process.argv[2] ?? "readiness";
const writeReports = process.argv.includes("--write-reports");

function atomicPublish(path: string, content: string): void {
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let fd: number | null = null;
  try {
    fd = openSync(tempPath, "wx", 0o600);
    writeFileSync(fd, content, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    const verifiedTempPath = assertCanonicalSingleLinkRegularFile(
      tempPath,
      "N1_PAYOUT_REPORT_TEMP_IDENTITY_INVALID",
    );
    renameSync(verifiedTempPath, path);
  } catch (error) {
    if (fd !== null) closeSync(fd);
    rmSync(tempPath, { force: true });
    throw error;
  }
}

function tempMigration() {
  const temp = mkdtempSync(join(tmpdir(), "boat-pon-n1-migration-"));
  const db = openSidecarDatabase(join(temp, "research-replay.sqlite"));
  initializeSidecarSchema(db);
  initializeN1SettlementSchema(db);
  const report = {
    mode: "disposable_temp_db",
    permanentSidecarWrites: 0,
    primaryDbWrites: 0,
    schema: verifyN1SettlementSchema(db),
    foreignKeyViolations: db.prepare("PRAGMA foreign_key_check").all().length,
    integrityCheck: (db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check,
  };
  db.close();
  return report;
}

async function main(): Promise<void> {
  if (command === "migrate-temp") {
    console.log(JSON.stringify(tempMigration(), null, 2));
    return;
  }
  if (command === "archive-dry-run") {
    const report = await auditAllLocalKArchives(join(root, "data", "raw", "official", "results"));
    if (writeReports) {
      atomicPublish(
        join(root, "reports", "n1-all-bet-type-payout-archive-audit.json"),
        `${JSON.stringify(report, null, 2)}\n`,
      );
    }
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (command === "reconcile") {
    const report = reconcileSanitizedKFixture(
      join(root, "data", "boat.sqlite"),
      join(root, "tests", "fixtures", "K260520.TXT"),
    );
    if (writeReports) {
      atomicPublish(
        join(root, "reports", "n1-all-bet-type-payout-reconciliation.json"),
        `${JSON.stringify(report, null, 2)}\n`,
      );
    }
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (command === "readiness") {
    const reportPath = join(root, "reports", "n1-all-bet-type-payout-implementation.json");
    const verifiedReportPath = assertCanonicalSingleLinkRegularFile(
      reportPath,
      "N1_PAYOUT_IMPLEMENTATION_REPORT_IDENTITY_INVALID",
    );
    const canonical = JSON.parse(readFileSync(verifiedReportPath, "utf8")) as Record<string, unknown>;
    const report = {
      ...canonical,
      localVerification: {
        tempMigration: tempMigration(),
        commands: {
          fixtures: "npm run research:n1:payout:fixtures",
          migrateTemp: "npm run research:n1:payout:migrate-temp",
          archiveDryRun: "npm run research:n1:payout:archive-dry-run",
          reconcile: "npm run research:n1:payout:reconcile",
        },
      },
    };
    if (writeReports) atomicPublish(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  throw new Error(`unknown N1 payout command: ${command}`);
}

await main();
