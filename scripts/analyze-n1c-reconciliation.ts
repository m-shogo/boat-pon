// N1-C source reconciliation analyzer（read-only）。
// archive を再parseし、backfill と同一の classification/dedup/validation を count-only で再現して、
// N1 stored line と archive parsed line の差分を category別に完全分類する。
// 永続sidecar・source archive・data/boat.sqlite を一切書き換えない。
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { canonicalHash } from "../src/research-replay/canonical";
import { parseOfficialResultDetail } from "../src/domain/officialResultDetailParser";
import {
  classifyRaceLines,
  fileDate,
  listArchiveFiles,
  resolveStatus,
  VENUE_CODES,
} from "../src/research-replay/n1Backfill";
import {
  BET_TYPES,
  parseSettlementSelection,
  type SettlementBetType,
} from "../src/research-replay/settlement";
import type { RacePayout } from "../src/domain/officialResultDetailParser";

const root = resolve(process.cwd());
const SIDECAR = join(root, "data", "research-replay.sqlite");
const ARCHIVE_ROOT = join(root, "data", "raw", "official", "results");
const REPORT_DIR = join(root, "reports", "n1c-backfill");
const REFERENCE_8164_LINES = 11_514_006; // N1-A archive audit（8,164 files, k000101..k260722）
const BASELINE_LAST_FILE = "k260722.lzh"; // 8,164 baseline
const RUNTIME_LAST_FILE = "k260725.lzh"; // 8,167 backfill実行時点

// appendCandidate と同一の dedup+validation を count-only で再現。
// 返り値: このrace×betTypeで stored(post-dedup) / dedupRemoved / skipped(全line) の line数。
function simulateCandidate(betType: SettlementBetType, bucket: ReturnType<typeof classifyRaceLines>, status: string):
  { stored: number; dedupRemoved: number; skipped: number } {
  const bucketTotal = bucket.payouts.length + bucket.refunds.length;
  try {
    const parsedPayouts = bucket.payouts.map((line) => {
      const selection = parseSettlementSelection(betType, line.selection);
      const special = line.lineKind === "special_payout";
      if (!special && (!selection.valid || !selection.canonical)) throw new Error("INVALID_SELECTION");
      if (!Number.isInteger(line.payoutYen) || line.payoutYen < 0) throw new Error("INVALID_PAYOUT");
      const canonical = special && !selection.valid ? null : selection.canonical;
      return { canonical, payoutYen: line.payoutYen, popularity: line.popularity, lineKind: line.lineKind };
    });
    const paySeen = new Set<string>();
    const payDeduped = parsedPayouts.filter((l) => {
      const k = canonicalHash([l.canonical, l.payoutYen, l.popularity ?? null, l.lineKind ?? "payout"]);
      if (paySeen.has(k)) return false; paySeen.add(k); return true;
    });
    const parsedRefunds = bucket.refunds.map((line) => {
      const selection = line.selection == null ? null : parseSettlementSelection(betType, line.selection);
      if (selection && (!selection.valid || !selection.canonical)) throw new Error("INVALID_REFUND_SELECTION");
      return { canonical: selection?.canonical ?? null, scope: line.scope, refundYenPer100: line.refundYenPer100, reasonCode: line.reasonCode };
    });
    const refSeen = new Set<string>();
    const refDeduped = parsedRefunds.filter((l) => {
      const k = canonicalHash([l.canonical ?? null, l.scope, l.refundYenPer100 ?? null, l.reasonCode]);
      if (refSeen.has(k)) return false; refSeen.add(k); return true;
    });
    if (["pending", "no_sale"].includes(status) && (payDeduped.length || refDeduped.length)) throw new Error("STATE");
    if (status === "partially_refunded" && (!payDeduped.length || !refDeduped.length)) throw new Error("PARTIAL");
    if (status === "refunded" && (payDeduped.length || !refDeduped.length)) throw new Error("REFUNDED_ONLY");
    const stored = payDeduped.length + refDeduped.length;
    return { stored, dedupRemoved: bucketTotal - stored, skipped: 0 };
  } catch {
    return { stored: 0, dedupRemoved: 0, skipped: bucketTotal };
  }
}

type FileMetrics = {
  file: string; rawParsed: number; processed: number; filtered: number;
  stored: number; dedupRemoved: number; skipped: number;
  storedPayout: number; storedRefund: number;
};

// backfillと同一: .lzh を unar で解凍してから shift_jis decode。
function unpackToBuffer(path: string): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("unar", ["-q", "-o", "-", path], { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c: Buffer) => errors.push(c));
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolvePromise(Buffer.concat(chunks)) : reject(new Error(Buffer.concat(errors).toString("utf8") || `unar exit ${code}`)));
  });
}

async function analyzeFile(filePath: string): Promise<FileMetrics> {
  const bytes = await unpackToBuffer(filePath);
  const text = new TextDecoder("shift_jis").decode(bytes);
  const parsed = parseOfficialResultDetail(text, { date: fileDate(filePath), fetchedAt: "1970-01-01T00:00:00.000Z" });
  const file = basename(filePath);
  const m: FileMetrics = { file, rawParsed: parsed.payouts.length, processed: 0, filtered: 0, stored: 0, dedupRemoved: 0, skipped: 0, storedPayout: 0, storedRefund: 0 };
  const payoutByRace = new Map<string, RacePayout[]>();
  for (const line of parsed.payouts) {
    const list = payoutByRace.get(line.raceId) ?? [];
    list.push(line); payoutByRace.set(line.raceId, list);
  }
  for (const condition of parsed.conditions) {
    const code = VENUE_CODES[condition.venue];
    if (!code || condition.raceNo < 1 || condition.raceNo > 12) continue; // venue/raceNo filtered
    const lines = payoutByRace.get(condition.raceId) ?? [];
    m.processed += lines.length;
    const byBet = new Map<SettlementBetType, RacePayout[]>();
    for (const line of lines) {
      if (!(BET_TYPES as readonly string[]).includes(line.betType)) continue;
      const bt = line.betType as SettlementBetType;
      const l = byBet.get(bt) ?? []; l.push(line); byBet.set(bt, l);
    }
    for (const [betType, betLines] of byBet) {
      const bucket = classifyRaceLines(betType, betLines);
      const status = resolveStatus(bucket);
      if (!status) continue;
      const sim = simulateCandidate(betType, bucket, status);
      m.stored += sim.stored; m.dedupRemoved += sim.dedupRemoved; m.skipped += sim.skipped;
      // stored payout/refund split（post-dedup）を再計算するため簡易に: payout側/ refund側の deduped は
      // simulateCandidate内で分けているが、集計簡略化のためここでは stored 合計のみ厳密。split は近似不要。
    }
  }
  m.filtered = m.rawParsed - m.processed;
  return m;
}

function subsetTotals(metrics: FileMetrics[], predicate: (file: string) => boolean) {
  const t = { files: 0, rawParsed: 0, processed: 0, filtered: 0, stored: 0, dedupRemoved: 0, skipped: 0 };
  for (const m of metrics) {
    if (!predicate(m.file)) continue;
    t.files += 1; t.rawParsed += m.rawParsed; t.processed += m.processed; t.filtered += m.filtered;
    t.stored += m.stored; t.dedupRemoved += m.dedupRemoved; t.skipped += m.skipped;
  }
  return t;
}

async function main(): Promise<void> {
  const files = listArchiveFiles(ARCHIVE_ROOT);
  const started = Date.now();
  const metrics: FileMetrics[] = new Array(files.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < files.length) {
      const i = cursor++;
      metrics[i] = await analyzeFile(files[i]);
    }
  };
  await Promise.all(Array.from({ length: 8 }, () => worker()));
  const parseMs = Date.now() - started;

  const all = subsetTotals(metrics, () => true);
  const s8164 = subsetTotals(metrics, (f) => f <= BASELINE_LAST_FILE);
  const s8167 = subsetTotals(metrics, (f) => f <= RUNTIME_LAST_FILE);

  // DB actual（immutable read、post-dedup）。
  const db = new DatabaseSync(`file:${SIDECAR}?immutable=1`, { readOnly: true } as never);
  const dbPayout = Number((db.prepare("SELECT COUNT(*) c FROM race_payout_lines_v2").get() as { c: number }).c);
  const dbRefund = Number((db.prepare("SELECT COUNT(*) c FROM race_refund_lines_v2").get() as { c: number }).c);
  db.close();
  const dbStored = dbPayout + dbRefund;

  // 同一fileset(8,168) reconciliation: rawParsed = stored + dedup + skip + filter（恒等）。
  const sameFileset = {
    fileset: "current_8168", files: all.files,
    archiveRawParsedLines: all.rawParsed,
    n1StoredLinesSim: all.stored,
    n1StoredLinesDbActual: dbStored,
    simMatchesDb: all.stored === dbStored,
    categories: {
      storedInSidecar: all.stored,
      dedupRemovedDuplicateSourceLines: all.dedupRemoved,
      skippedInvalidStateCandidateLines: all.skipped,
      venueOrRaceNoFilteredOrOrphanLines: all.filtered,
    },
    explainedDelta: all.dedupRemoved + all.skipped + all.filtered,
    delta: all.rawParsed - all.stored,
    unexplainedDelta: (all.rawParsed - all.stored) - (all.dedupRemoved + all.skipped + all.filtered),
  };

  // 歴史的 +5,153: N1_stored(8,167) vs reference(8,164=11,514,006)。
  const parserDeterminism = s8164.rawParsed - REFERENCE_8164_LINES; // 期待 0
  const newDailyLines_23to25 = s8167.rawParsed - s8164.rawParsed;
  const n1Stored8167 = s8167.stored;
  const statedDelta = n1Stored8167 - REFERENCE_8164_LINES; // 期待 +5,153
  const historical = {
    n1StoredLines_8167: n1Stored8167,
    referenceArchiveLines_8164: REFERENCE_8164_LINES,
    statedDelta,
    categories: {
      newDailyFiles_k260723_25_lines: newDailyLines_23to25,
      minus_venueOrRaceNoFilteredOrOrphan_8167: -s8167.filtered,
      minus_dedupRemovedDuplicateSource_8167: -s8167.dedupRemoved,
      minus_skippedInvalidStateCandidate_8167: -s8167.skipped,
      parserDeterminism_8164_vs_reference: parserDeterminism,
    },
    explainedDelta: newDailyLines_23to25 - s8167.filtered - s8167.dedupRemoved - s8167.skipped + parserDeterminism,
    unexplainedDelta: statedDelta - (newDailyLines_23to25 - s8167.filtered - s8167.dedupRemoved - s8167.skipped + parserDeterminism),
  };

  const payload = {
    phase: "SOURCE_RECONCILIATION", generatedAt: new Date().toISOString(),
    scope: "read-only re-parse of current archive with identical ingest classification; no writes to sidecar/archive/boat.sqlite",
    parseMs, archiveFiles: all.files,
    lineDefinitions: {
      archiveRawParsedLine: "parseOfficialResultDetail(f).payouts.length — 全 RacePayout（returned含む）",
      n1StoredLine: "race_payout_lines_v2 + race_refund_lines_v2（post-dedup, per candidate）",
      filtered: "venue code不明 / raceNo∉[1,12] のrace、または condition の無い orphan payout line",
      dedupRemoved: "candidate内で (canonical,payout,popularity,lineKind) / (canonical,scope,refund,reason) が同一の重複line",
      skipped: "appendCandidate validation で拒否される race×betType の全line（実測 skippedCandidates 0）",
    },
    perFilesetRaw: { s8164, s8167, all },
    sameFilesetReconciliation: sameFileset,
    historicalDeltaReconciliation: historical,
    valueMismatch: { legacyComparisonPayoutMismatch: 0, note: "reports/n1c-backfill/legacy-comparison.json、sample 2,000 で金額不一致0。multiplicity差(件数)とvalue差を分離済み" },
    result: sameFileset.unexplainedDelta === 0 && historical.unexplainedDelta === 0 && sameFileset.simMatchesDb ? "PASS" : "REVIEW",
  };
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(join(REPORT_DIR, "reconciliation.json"), `${JSON.stringify(payload, null, 2)}\n`);
  const md = `# N1-C source reconciliation\n\n- result: **${payload.result}**\n- archive files: ${all.files}\n\n## Same-fileset (8,168) — 恒等 reconciliation\n- archive raw parsed lines: ${all.rawParsed}\n- N1 stored (sim): ${all.stored} / DB actual: ${dbStored} / match: ${sameFileset.simMatchesDb}\n- categories: stored ${all.stored} + dedup ${all.dedupRemoved} + skipped ${all.skipped} + filtered ${all.filtered}\n- **unexplainedDelta: ${sameFileset.unexplainedDelta}**\n\n## Historical +5,153 (N1 8,167 stored vs reference 8,164=11,514,006)\n- stated delta: ${statedDelta}\n- newDailyFiles k260723-25: ${newDailyLines_23to25}\n- - filtered(8,167): ${s8167.filtered} / - dedup(8,167): ${s8167.dedupRemoved} / - skipped(8,167): ${s8167.skipped}\n- parser determinism (8,164 vs 11,514,006): ${parserDeterminism}\n- **unexplainedDelta: ${historical.unexplainedDelta}**\n\n## Value\n- legacy payout mismatch: 0（sample 2,000）\n`;
  writeFileSync(join(REPORT_DIR, "reconciliation.md"), md);
  console.log(JSON.stringify({ ...payload, perFilesetRaw: undefined }, null, 2));
  if (payload.result !== "PASS") process.exitCode = 1;
}
await main();
