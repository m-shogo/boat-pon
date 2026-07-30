// N1-C archive data-quality deep scan（read-only）。
// 全 K archive を再parseし、既存 gate で見逃しうる source defect を分類する。
// DB・source archive・provenance を一切変更しない。finding は CONFIRMED/SUSPECTED/EXPECTED/UNKNOWN に分類。
import { spawn } from "node:child_process";
import { statSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  classifyRaceLines,
  fileDate,
  listArchiveFiles,
  resolveStatus,
  VENUE_CODES,
} from "../src/research-replay/n1Backfill";
import { BET_TYPES, type SettlementBetType } from "../src/research-replay/settlement";
import { parseOfficialResultDetail, type RacePayout } from "../src/domain/officialResultDetailParser";

const root = resolve(process.cwd());
const ARCHIVE_ROOT = join(root, "data", "raw", "official", "results");
const REPORT_DIR = join(root, "reports", "n1c-backfill");

function unpack(p: string): Promise<Buffer> {
  return new Promise((res, rej) => {
    const c = spawn("unar", ["-q", "-o", "-", p]);
    const ch: Buffer[] = []; const er: Buffer[] = [];
    c.stdout.on("data", (d: Buffer) => ch.push(d));
    c.stderr.on("data", (d: Buffer) => er.push(d));
    c.on("error", rej);
    c.on("close", (x) => x === 0 ? res(Buffer.concat(ch)) : rej(new Error(Buffer.concat(er).toString() || `unar ${x}`)));
  });
}

type FileScan = {
  file: string; compressedBytes: number; decompressedBytes: number;
  conditions: number; distinctRaceIds: number; duplicateConditions: number;
  payouts: number; invalidVenue: number; invalidRaceNo: number;
  parseError: boolean; races: number; refundRaces: number;
};

async function scanFile(filePath: string): Promise<FileScan> {
  const file = basename(filePath);
  const compressedBytes = statSync(filePath).size;
  const scan: FileScan = {
    file, compressedBytes, decompressedBytes: 0, conditions: 0, distinctRaceIds: 0,
    duplicateConditions: 0, payouts: 0, invalidVenue: 0, invalidRaceNo: 0, parseError: false, races: 0, refundRaces: 0,
  };
  try {
    const bytes = await unpack(filePath);
    scan.decompressedBytes = bytes.byteLength;
    const parsed = parseOfficialResultDetail(new TextDecoder("shift_jis").decode(bytes), { date: fileDate(filePath), fetchedAt: "1970-01-01T00:00:00.000Z" });
    scan.conditions = parsed.conditions.length;
    scan.payouts = parsed.payouts.length;
    const ids = parsed.conditions.map((c) => c.raceId);
    scan.distinctRaceIds = new Set(ids).size;
    scan.duplicateConditions = ids.length - scan.distinctRaceIds;
    for (const c of parsed.conditions) {
      if (!VENUE_CODES[c.venue]) scan.invalidVenue += 1;
      if (c.raceNo < 1 || c.raceNo > 12) scan.invalidRaceNo += 1;
    }
    // refund race 概算（returned 含む race）
    const byRace = new Map<string, RacePayout[]>();
    for (const p of parsed.payouts) { const l = byRace.get(p.raceId) ?? []; l.push(p); byRace.set(p.raceId, l); }
    scan.races = scan.distinctRaceIds;
    for (const [, lines] of byRace) {
      const byBet = new Map<SettlementBetType, RacePayout[]>();
      for (const line of lines) { if ((BET_TYPES as readonly string[]).includes(line.betType)) { const bt = line.betType as SettlementBetType; const a = byBet.get(bt) ?? []; a.push(line); byBet.set(bt, a); } }
      let refund = false;
      for (const [bt, bl] of byBet) { const b = classifyRaceLines(bt, bl); if (resolveStatus(b) === "refunded" || resolveStatus(b) === "partially_refunded") refund = true; }
      if (refund) scan.refundRaces += 1;
    }
  } catch {
    scan.parseError = true;
  }
  return scan;
}

async function main(): Promise<void> {
  const files = listArchiveFiles(ARCHIVE_ROOT);
  const started = Date.now();
  const scans: FileScan[] = new Array(files.length);
  let cursor = 0;
  const worker = async (): Promise<void> => { while (cursor < files.length) { const i = cursor++; scans[i] = await scanFile(files[i]); } };
  await Promise.all(Array.from({ length: 8 }, () => worker()));
  const parseMs = Date.now() - started;

  const decompressed = scans.map((s) => s.decompressedBytes).filter((x) => x > 0).sort((a, b) => a - b);
  const median = decompressed[Math.floor(decompressed.length / 2)] || 1;
  const dupFiles = scans.filter((s) => s.duplicateConditions > 0);
  const parseErrors = scans.filter((s) => s.parseError);
  const zeroRace = scans.filter((s) => !s.parseError && s.races === 0);
  const invalidVenue = scans.filter((s) => s.invalidVenue > 0);
  const invalidRaceNo = scans.filter((s) => s.invalidRaceNo > 0);
  const oversized = scans.filter((s) => s.decompressedBytes > median * 1.6);
  const undersized = scans.filter((s) => !s.parseError && s.decompressedBytes > 0 && s.decompressedBytes < median * 0.25);
  const totalRaces = scans.reduce((a, s) => a + s.races, 0);
  const totalPayouts = scans.reduce((a, s) => a + s.payouts, 0);

  const payload = {
    phase: "ARCHIVE_DATA_QUALITY_SCAN", generatedAt: new Date().toISOString(),
    scope: "read-only re-parse of all K archives; no DB/source mutation", parseMs, archiveFiles: files.length,
    medianDecompressedBytes: median, totalRaces, totalPayoutLines: totalPayouts,
    findings: {
      duplicateDaySections: { classification: "CONFIRMED", count: dupFiles.length, files: dupFiles.map((s) => ({ file: s.file, dupConditions: s.duplicateConditions })), note: "resolved via source_duplicate canonical resolution (n1-settlement.0.3)" },
      parseErrors: { classification: parseErrors.length ? "CONFIRMED" : "EXPECTED", count: parseErrors.length, files: parseErrors.slice(0, 20).map((s) => s.file) },
      zeroRaceFiles: { classification: zeroRace.length ? "SUSPECTED" : "EXPECTED", count: zeroRace.length, files: zeroRace.slice(0, 20).map((s) => s.file) },
      invalidVenue: { classification: invalidVenue.length ? "SUSPECTED" : "EXPECTED", count: invalidVenue.length, sample: invalidVenue.slice(0, 10).map((s) => ({ file: s.file, n: s.invalidVenue })) },
      invalidRaceNo: { classification: invalidRaceNo.length ? "SUSPECTED" : "EXPECTED", count: invalidRaceNo.length, sample: invalidRaceNo.slice(0, 10).map((s) => ({ file: s.file, n: s.invalidRaceNo })) },
      oversizedDecompressed: { classification: "UNKNOWN", threshold: `>${(median * 1.6) | 0}B (1.6x median)`, count: oversized.length, files: oversized.slice(0, 20).map((s) => ({ file: s.file, bytes: s.decompressedBytes, dupConditions: s.duplicateConditions })) },
      undersizedDecompressed: { classification: "UNKNOWN", threshold: `<${(median * 0.25) | 0}B (0.25x median)`, count: undersized.length, files: undersized.slice(0, 20).map((s) => ({ file: s.file, bytes: s.decompressedBytes, races: s.races })) },
    },
    result: "SCANNED",
  };
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(join(REPORT_DIR, "archive-quality-scan.json"), `${JSON.stringify(payload, null, 2)}\n`);
  const f = payload.findings;
  writeFileSync(join(REPORT_DIR, "archive-quality-scan.md"), `# N1-C archive data-quality deep scan\n\n- files: ${files.length} / median decompressed: ${median}B / total races: ${totalRaces}\n\n| finding | class | count |\n|---|---|---:|\n| duplicate day sections | ${f.duplicateDaySections.classification} | ${f.duplicateDaySections.count} |\n| parse errors | ${f.parseErrors.classification} | ${f.parseErrors.count} |\n| zero-race files | ${f.zeroRaceFiles.classification} | ${f.zeroRaceFiles.count} |\n| invalid venue | ${f.invalidVenue.classification} | ${f.invalidVenue.count} |\n| invalid raceNo | ${f.invalidRaceNo.classification} | ${f.invalidRaceNo.count} |\n| oversized decompressed | ${f.oversizedDecompressed.classification} | ${f.oversizedDecompressed.count} |\n| undersized decompressed | ${f.undersizedDecompressed.classification} | ${f.undersizedDecompressed.count} |\n\n- duplicate day sections（CONFIRMED, resolved）: ${dupFiles.map((s) => s.file).join(", ") || "none"}\n- oversized files（要確認、重複由来の可能性）: ${oversized.slice(0, 10).map((s) => s.file).join(", ") || "none"}\n`);
  console.log(JSON.stringify({ ...payload, findings: Object.fromEntries(Object.entries(payload.findings).map(([k, v]) => [k, { classification: (v as { classification: string }).classification, count: (v as { count: number }).count }])) }, null, 2));
}
await main();
