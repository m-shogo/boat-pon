// N1 v1/v2 archive refund semantics diff scanner（read-only）。
// 同じraw archiveを旧分類と現分類でparseし、DB・archiveを変更せずyear×bet_typeで影響を集計する。
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  parseOfficialResultDetail,
  parseOfficialResultDetailLegacyV1ForAudit,
  type BetType,
} from "../src/domain/officialResultDetailParser";
import { fileDate, listArchiveFiles } from "../src/research-replay/n1Backfill";
import {
  compareRefundSemantics,
  type RefundSemanticsComparison,
  type RefundSemanticsEventKind,
} from "../src/research-replay/n1RefundSemanticsAudit";

const root = resolve(process.cwd());

function argValue(name: string): string | null {
  const direct = process.argv.find((value) => value.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function positiveInt(value: string | null, fallback: number | null): number | null {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`expected positive integer, got: ${value}`);
  return parsed;
}

const archiveRoot = resolve(argValue("--archive-root") ?? join(root, "data", "raw", "official", "results"));
const reportDir = resolve(argValue("--report-dir") ?? join(root, "reports", "n2"));
const limit = positiveInt(argValue("--limit"), null);
const concurrency = positiveInt(argValue("--concurrency"), 8) ?? 8;

function unpack(path: string): Promise<Buffer> {
  return new Promise((resolveBuffer, reject) => {
    const child = spawn("unar", ["-q", "-o", "-", path], { stdio: ["ignore", "pipe", "pipe"] });
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolveBuffer(Buffer.concat(output))
      : reject(new Error(Buffer.concat(errors).toString("utf8") || `unar exit ${code}`)));
  });
}

type FileResult = {
  file: string;
  year: string;
  comparison: RefundSemanticsComparison | null;
  error: string | null;
};

async function scanFile(path: string): Promise<FileResult> {
  const file = basename(path);
  try {
    const bytes = await unpack(path);
    const text = new TextDecoder("shift_jis").decode(bytes);
    const defaults = { date: fileDate(path), fetchedAt: "1970-01-01T00:00:00.000Z" };
    const legacy = parseOfficialResultDetailLegacyV1ForAudit(text, defaults);
    const current = parseOfficialResultDetail(text, defaults);
    return {
      file,
      year: defaults.date.slice(0, 4),
      comparison: compareRefundSemantics(legacy, current),
      error: null,
    };
  } catch (error) {
    return {
      file,
      year: fileDate(path).slice(0, 4),
      comparison: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

type AggregateRow = {
  year: string;
  betType: BetType;
  specialPayoutAdded: number;
  falseRefundReclassified: number;
  otherChange: number;
};

const aggregateKey = (year: string, betType: BetType): string => `${year}\u0000${betType}`;

function emptyAggregate(year: string, betType: BetType): AggregateRow {
  return { year, betType, specialPayoutAdded: 0, falseRefundReclassified: 0, otherChange: 0 };
}

async function main(): Promise<void> {
  if (!existsSync(archiveRoot)) throw new Error(`archive root not found: ${archiveRoot}`);
  const discovered = listArchiveFiles(archiveRoot);
  const selected = limit == null ? discovered : discovered.slice(0, limit);
  const results = new Array<FileResult>(selected.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < selected.length) {
      const index = cursor++;
      results[index] = await scanFile(selected[index]);
    }
  };
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, selected.length)) }, () => worker()));

  const byYearBet = new Map<string, AggregateRow>();
  const totals = {
    legacyCandidates: 0,
    currentCandidates: 0,
    legacyRefundCandidates: 0,
    currentRefundCandidates: 0,
    currentSpecialPayoutCandidates: 0,
    unchangedCandidates: 0,
    unchangedRefundCandidates: 0,
    specialPayoutAdded: 0,
    falseRefundReclassified: 0,
    otherChange: 0,
  };
  const samples: Array<{
    file: string;
    raceId: string;
    date: string;
    betType: BetType;
    eventKind: RefundSemanticsEventKind;
    legacyStatus: string | null;
    currentStatus: string | null;
  }> = [];

  for (const result of results) {
    const comparison = result.comparison;
    if (!comparison) continue;
    totals.legacyCandidates += comparison.legacyCandidateCount;
    totals.currentCandidates += comparison.currentCandidateCount;
    totals.legacyRefundCandidates += comparison.legacyRefundCandidates;
    totals.currentRefundCandidates += comparison.currentRefundCandidates;
    totals.currentSpecialPayoutCandidates += comparison.currentSpecialPayoutCandidates;
    totals.unchangedCandidates += comparison.unchangedCandidates;
    totals.unchangedRefundCandidates += comparison.unchangedRefundCandidates;
    for (const row of comparison.changedRows) {
      if (row.eventKind === "special_payout_added") totals.specialPayoutAdded += 1;
      else if (row.eventKind === "false_refund_reclassified") totals.falseRefundReclassified += 1;
      else totals.otherChange += 1;

      const key = aggregateKey(row.date.slice(0, 4), row.betType);
      const aggregate = byYearBet.get(key) ?? emptyAggregate(row.date.slice(0, 4), row.betType);
      if (row.eventKind === "special_payout_added") aggregate.specialPayoutAdded += 1;
      else if (row.eventKind === "false_refund_reclassified") aggregate.falseRefundReclassified += 1;
      else aggregate.otherChange += 1;
      byYearBet.set(key, aggregate);

      if (samples.length < 100) {
        samples.push({
          file: result.file,
          raceId: row.raceId,
          date: row.date,
          betType: row.betType,
          eventKind: row.eventKind,
          legacyStatus: row.legacyStatus,
          currentStatus: row.currentStatus,
        });
      }
    }
  }

  const errors = results.filter((result) => result.error).map((result) => ({
    file: result.file,
    error: result.error,
  }));
  const changedFiles = results.filter((result) => (result.comparison?.changedRows.length ?? 0) > 0).length;
  const byYearBetRows = [...byYearBet.values()].sort((left, right) =>
    left.year.localeCompare(right.year) || left.betType.localeCompare(right.betType));

  const payload = {
    phase: "ARCHIVE_REFUND_SEMANTICS_AUDIT",
    generatedAt: new Date().toISOString(),
    startedAt,
    elapsedMs: Date.now() - startedMs,
    scope: "read-only v1/v2 parse of immutable K archives; no DB/archive mutation",
    parser: {
      legacy: "n1-settlement-parser-v1 behavior (audit-only wrapper)",
      current: "n1-settlement-parser-v2",
    },
    archiveRoot,
    archiveFilesDiscovered: discovered.length,
    archiveFilesScanned: selected.length,
    limited: limit != null,
    changedFiles,
    parseErrors: errors.length,
    totals: {
      ...totals,
      refundCandidateReduction: totals.legacyRefundCandidates - totals.currentRefundCandidates,
    },
    byYearBetType: byYearBetRows,
    samples,
    errors: errors.slice(0, 100),
    reconciliationReference: {
      n2ProfileExcludedRefunded: 319301,
      note: "profile is canonical candidate-level; raw scanner totals require source-duplicate canonical reconciliation before exact equality is asserted",
    },
    result: errors.length === 0 ? "SCANNED" : "PARTIAL",
  };

  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, "archive-refund-semantics-diff.json"), `${JSON.stringify(payload, null, 2)}\n`);

  const tableRows = byYearBetRows.map((row) =>
    `| ${row.year} | ${row.betType} | ${row.specialPayoutAdded} | ${row.falseRefundReclassified} | ${row.otherChange} |`,
  ).join("\n");
  writeFileSync(join(reportDir, "archive-refund-semantics-diff.md"), `# Archive refund semantics v1/v2 diff

- generated: ${payload.generatedAt}
- scope: ${payload.scope}
- files: ${selected.length}/${discovered.length}
- changed files: ${changedFiles}
- parse errors: ${errors.length}
- legacy refund candidates: ${totals.legacyRefundCandidates}
- current refund candidates: ${totals.currentRefundCandidates}
- refund candidate reduction: ${payload.totals.refundCandidateReduction}
- special payout candidates added: ${totals.specialPayoutAdded}
- false refunds reclassified: ${totals.falseRefundReclassified}
- other changes: ${totals.otherChange}

| year | bet type | special added | false refund reclassified | other change |
|---:|---|---:|---:|---:|
${tableRows || "| — | — | 0 | 0 | 0 |"}

> The N2 profile reference (excluded_refunded=319,301) is canonical candidate-level. Do not assert exact reconciliation until source-duplicate resolution is applied to these raw-scan totals.
`);

  console.log(JSON.stringify({
    archiveFilesScanned: selected.length,
    changedFiles,
    parseErrors: errors.length,
    totals: payload.totals,
    result: payload.result,
  }, null, 2));
}

await main();
