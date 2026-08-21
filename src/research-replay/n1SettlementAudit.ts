import { spawn } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseOfficialResultDetail } from "../domain/officialResultDetailParser";
import { canonicalRaceKey } from "./identity";

export type ArchiveAudit = {
  auditVersion: "n1-archive-audit-v1";
  scope: "all_local_k_archives";
  externalRequests: 0;
  filesDiscovered: number;
  filesParsed: number;
  filesFailed: number;
  firstArchive: string | null;
  lastArchive: string | null;
  raceRecords: number;
  payoutLines: number;
  linesByBetType: Record<string, number>;
  schemaFamilies: Record<string, number>;
  errorSamples: Array<{ file: string; error: string }>;
};

function walk(dir: string): string[] {
  const output: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) output.push(...walk(path));
    else if (entry.isFile() && /^k\d{6}\.lzh$/i.test(entry.name)) output.push(path);
  }
  return output;
}

function unpackToBuffer(path: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("unar", ["-q", "-o", "-", path], { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolve(Buffer.concat(chunks))
      : reject(new Error(Buffer.concat(errors).toString("utf8") || `unar exit ${code}`)));
  });
}

export function archiveFallbackDate(path: string): string {
  const match = path.match(/k(\d{2})(\d{2})(\d{2})\.lzh$/i);
  if (!match) return "1970-01-01";
  const year = Number(match[1]) >= 70 ? `19${match[1]}` : `20${match[1]}`;
  const date = `${year}-${match[2]}-${match[3]}`;
  canonicalRaceKey(date, "01", 1);
  return date;
}

export async function auditAllLocalKArchives(root: string, concurrency = 8): Promise<ArchiveAudit> {
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
    throw new Error(`N1_ARCHIVE_AUDIT_CONCURRENCY_INVALID:${concurrency}`);
  }
  if (!statSync(root).isDirectory()) throw new Error(`archive root is not a directory: ${root}`);
  const files = walk(root).sort((left, right) => left.localeCompare(right));
  const report: ArchiveAudit = {
    auditVersion: "n1-archive-audit-v1",
    scope: "all_local_k_archives",
    externalRequests: 0,
    filesDiscovered: files.length,
    filesParsed: 0,
    filesFailed: 0,
    firstArchive: files[0]?.split("/").at(-1) ?? null,
    lastArchive: files.at(-1)?.split("/").at(-1) ?? null,
    raceRecords: 0,
    payoutLines: 0,
    linesByBetType: {},
    schemaFamilies: {},
    errorSamples: [],
  };
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < files.length) {
      const file = files[cursor++];
      try {
        const raw = await unpackToBuffer(file);
        const text = new TextDecoder("shift_jis").decode(raw);
        const family = text.includes("３連単") && text.includes("単勝") ? "modern_seven_display"
          : text.includes("連単") ? "legacy_pre_trifecta" : "unknown";
        report.schemaFamilies[family] = (report.schemaFamilies[family] ?? 0) + 1;
        const parsed = parseOfficialResultDetail(text, {
          date: archiveFallbackDate(file),
          fetchedAt: "1970-01-01T00:00:00.000Z",
        });
        report.filesParsed += 1;
        report.raceRecords += parsed.conditions.length;
        report.payoutLines += parsed.payouts.length;
        for (const payout of parsed.payouts) {
          report.linesByBetType[payout.betType] = (report.linesByBetType[payout.betType] ?? 0) + 1;
        }
      } catch (error) {
        report.filesFailed += 1;
        if (report.errorSamples.length < 20) {
          report.errorSamples.push({ file: file.split("/").at(-1) ?? file, error: error instanceof Error ? error.message : String(error) });
        }
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return report;
}

export type ReconciliationReport = {
  reconciliationVersion: "n1-legacy-reconciliation-v1";
  scope: "local_sanitized_k_fixture_vs_read_only_legacy";
  legacyDbMode: "read_only";
  primaryWrites: 0;
  comparedLines: number;
  exactMatch: number;
  n1Only: number;
  legacyOnly: number;
  payoutMismatch: number;
  byBetType: Record<string, { parsed: number; exact: number; n1Only: number; payoutMismatch: number }>;
};

export function reconcileSanitizedKFixture(legacyDbPath: string, fixturePath: string): ReconciliationReport {
  const text = new TextDecoder("shift_jis").decode(readFileSync(fixturePath));
  const parsed = parseOfficialResultDetail(text, { date: "2026-05-20", fetchedAt: "1970-01-01T00:00:00.000Z" });
  const db = new DatabaseSync(legacyDbPath, { readOnly: true });
  const exact = db.prepare(`
    SELECT 1 found FROM race_payouts
    WHERE race_id=? AND bet_type=? AND combination=? AND payout_yen=? LIMIT 1
  `);
  const selection = db.prepare(`
    SELECT payout_yen FROM race_payouts
    WHERE race_id=? AND bet_type=? AND combination=? LIMIT 1
  `);
  const legacyByRace = db.prepare(`
    SELECT race_id, bet_type, combination, payout_yen FROM race_payouts
    WHERE race_id=?
  `);
  const report: ReconciliationReport = {
    reconciliationVersion: "n1-legacy-reconciliation-v1",
    scope: "local_sanitized_k_fixture_vs_read_only_legacy",
    legacyDbMode: "read_only",
    primaryWrites: 0,
    comparedLines: parsed.payouts.length,
    exactMatch: 0,
    n1Only: 0,
    legacyOnly: 0,
    payoutMismatch: 0,
    byBetType: {},
  };
  for (const line of parsed.payouts) {
    const bucket = report.byBetType[line.betType] ?? { parsed: 0, exact: 0, n1Only: 0, payoutMismatch: 0 };
    report.byBetType[line.betType] = bucket;
    bucket.parsed += 1;
    if (exact.get(line.raceId, line.betType, line.combination, line.payoutYen)) {
      report.exactMatch += 1;
      bucket.exact += 1;
    } else if (selection.get(line.raceId, line.betType, line.combination)) {
      report.payoutMismatch += 1;
      bucket.payoutMismatch += 1;
    } else {
      report.n1Only += 1;
      bucket.n1Only += 1;
    }
  }

  const parsedSelectionKeys = new Set(parsed.payouts.map((line) =>
    `${line.raceId}\u0000${line.betType}\u0000${line.combination}`));
  for (const raceId of new Set(parsed.conditions.map((condition) => condition.raceId))) {
    const legacyRows = legacyByRace.all(raceId) as Array<{
      race_id: string;
      bet_type: string;
      combination: string;
      payout_yen: number;
    }>;
    for (const row of legacyRows) {
      const key = `${row.race_id}\u0000${row.bet_type}\u0000${row.combination}`;
      if (!parsedSelectionKeys.has(key)) report.legacyOnly += 1;
    }
  }

  db.close();
  return report;
}