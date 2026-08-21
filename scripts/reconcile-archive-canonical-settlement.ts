// N2 archive↔canonical settlement reconciliation CLI（read-only, deterministic, resumable）。
//
// 実 K archive を現行 parser（v2）で再parseした settlement candidate を、永続 sidecar の
// canonical active candidate（v1 由来）と canonical race identity で突合する。
// DB / archive / sidecar へ一切書き込まない（immutable=1 / readOnly / query_only）。
//
// 実行:
//   pnpm reconcile:n2:archive-canonical -- --as-of=2026-08-01T00:00:00.000Z
//   （任意）--sidecar=<db> --archive-root=<dir> --limit=<n> --concurrency=<n>
//            --report-dir=<dir> --checkpoint=<path> --resume
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { parseOfficialResultDetail } from "../src/domain/officialResultDetailParser";
import { canonicalHash } from "../src/research-replay/canonical";
import { fileDate, listArchiveFiles } from "../src/research-replay/n1Backfill";
import {
  ARCHIVE_RECONCILE_CHECKPOINT_VERSION,
  ARCHIVE_RECONCILE_SELECTION_VERSION,
  archiveReconcileCheckpointContract,
  assertArchiveReconcileCheckpointContract,
  buildArchiveReconcileSelection,
  type ArchiveReconcileCheckpointContract,
} from "../src/research-replay/n2ArchiveReconcileInput";
import { BET_TYPES, type SettlementBetType, type SettlementStatus } from "../src/research-replay/settlement";
import {
  EVENT_CLASSIFICATION_VERSION,
  EXPECTED_SETTLEMENT_SCHEMA_VERSION,
  RACE_IDENTITY_VERSION,
  RECONCILE_INPUT_VERSION,
  REPORT_SCHEMA_VERSION,
  SETTLEMENT_CANONICALIZATION_VERSION,
  candidateKey,
  classifyPair,
  deriveArchiveCandidates,
  isFalseRefundDirection,
  venueNameFromCode,
  yearFromKey,
  venueCodeFromKey,
  type ArchiveCandidate,
  type CanonicalCandidate,
  type ReconcileClass,
  type ResultKind,
} from "../src/research-replay/n2ArchiveCanonicalReconcile";

const root = resolve(process.cwd());

function argValue(name: string): string | null {
  const direct = process.argv.find((value) => value.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}
function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}
function positiveInt(value: string | null, fallback: number | null): number | null {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`expected positive integer, got: ${value}`);
  return parsed;
}

const asOfInput = argValue("--as-of");
if (!asOfInput) {
  throw new Error("--as-of=<ISO8601 UTC> は必須です（archive cutoff の明示指定）");
}
const sidecarPath = resolve(argValue("--sidecar") ?? join(root, "data", "research-replay.sqlite"));
const archiveRoot = resolve(argValue("--archive-root") ?? join(root, "data", "raw", "official", "results"));
const reportDir = resolve(argValue("--report-dir") ?? join(root, "reports", "n2"));
const limit = positiveInt(argValue("--limit"), null);
const concurrency = positiveInt(argValue("--concurrency"), 8) ?? 8;
const checkpointPath = resolve(
  argValue("--checkpoint") ?? join(root, "data", "tmp", "n2-archive-canonical-reconcile.checkpoint.json"),
);
const resume = hasFlag("--resume");

const BET_TYPE_SET: ReadonlySet<string> = new Set(BET_TYPES);

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

// ---- 集計器（year × bet_type × venue × class）----
type Cell = Record<ReconcileClass, number> & { falseRefund: number };
const RECONCILE_CLASSES: ReconcileClass[] = [
  "exact_match", "status_mismatch", "result_kind_mismatch",
  "archive_only", "canonical_only", "ambiguous_canonical", "parse_failure",
];
function emptyCell(): Cell {
  const cell = { falseRefund: 0 } as Cell;
  for (const klass of RECONCILE_CLASSES) cell[klass] = 0;
  return cell;
}

type Aggregate = {
  // 集計 key: `${year}\u0000${betType}\u0000${venueName}` → Cell
  cells: Map<string, Cell>;
  // canonical_only を dbActive − paired で導出するための paired 数（同一 key 空間）
  paired: Map<string, number>;
  statusMatrix: Map<string, number>; // `${canonicalStatus}->${archiveStatus}` → count（status_mismatch のみ）
  samples: SampleRow[];
  processedFiles: string[];
  parseErrors: Array<{ file: string; error: string }>;
  ambiguousKeys: string[];
};

type SampleRow = {
  raceKey: string;
  betType: SettlementBetType;
  class: ReconcileClass;
  canonicalStatus: SettlementStatus | null;
  canonicalResultKind: ResultKind | null;
  archiveStatus: SettlementStatus | null;
  archiveResultKind: ResultKind | null;
};

function aggKey(year: string, betType: string, venueName: string): string {
  return `${year}\u0000${betType}\u0000${venueName}`;
}
function cellOf(agg: Aggregate, key: string): Cell {
  let cell = agg.cells.get(key);
  if (!cell) { cell = emptyCell(); agg.cells.set(key, cell); }
  return cell;
}

function newAggregate(): Aggregate {
  return {
    cells: new Map(), paired: new Map(), statusMatrix: new Map(),
    samples: [], processedFiles: [], parseErrors: [], ambiguousKeys: [],
  };
}

// checkpoint シリアライズ（Map → 配列、決定的順序）。
function serializeAggregate(agg: Aggregate, checkpointContract: ArchiveReconcileCheckpointContract): unknown {
  return {
    version: RECONCILE_INPUT_VERSION,
    checkpointContract,
    cells: [...agg.cells.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    paired: [...agg.paired.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    statusMatrix: [...agg.statusMatrix.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    samples: agg.samples,
    processedFiles: agg.processedFiles,
    parseErrors: agg.parseErrors,
    ambiguousKeys: agg.ambiguousKeys,
  };
}
function loadAggregate(path: string, expectedContract: ArchiveReconcileCheckpointContract): Aggregate | null {
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  if (raw.version !== RECONCILE_INPUT_VERSION) {
    throw new Error(`ARCHIVE_RECONCILE_CHECKPOINT_VERSION_MISMATCH:${String(raw.version ?? "missing")}`);
  }
  assertArchiveReconcileCheckpointContract(raw.checkpointContract, expectedContract);
  const agg = newAggregate();
  for (const [k, v] of raw.cells as [string, Cell][]) agg.cells.set(k, v);
  for (const [k, v] of raw.paired as [string, number][]) agg.paired.set(k, v);
  for (const [k, v] of raw.statusMatrix as [string, number][]) agg.statusMatrix.set(k, v);
  agg.samples = raw.samples as SampleRow[];
  agg.processedFiles = raw.processedFiles as string[];
  agg.parseErrors = raw.parseErrors as Array<{ file: string; error: string }>;
  agg.ambiguousKeys = raw.ambiguousKeys as string[];
  return agg;
}

// ---- canonical DB 側 active candidate を streaming で読み込み、in-memory map を構築 ----
type DbSide = {
  map: Map<string, { status: SettlementStatus; resultKind: ResultKind }>;
  dbActive: Map<string, number>;       // aggKey → active candidate 数
  ambiguousKeys: Set<string>;
  activeCandidateCount: number;
  totalCandidateCount: number;
  sourceDuplicateCount: number;
  supersededCount: number;
  schemaVersion: string;
};

function loadDbSide(): DbSide {
  const uri = `${pathToFileURL(sidecarPath).href}?immutable=1`;
  const db = new DatabaseSync(uri, { readOnly: true } as never);
  try {
    db.exec("PRAGMA query_only=ON");
    // schema version の fail-closed 検証
    const migrations = db.prepare(
      "SELECT migration_version FROM n1_schema_migrations WHERE status='applied' ORDER BY rowid",
    ).all() as Array<{ migration_version: string }>;
    const schemaVersion = migrations.at(-1)?.migration_version ?? "unknown";
    if (schemaVersion !== EXPECTED_SETTLEMENT_SCHEMA_VERSION) {
      throw new Error(
        `settlement schema mismatch: expected ${EXPECTED_SETTLEMENT_SCHEMA_VERSION}, got ${schemaVersion}`,
      );
    }
    // source-duplicate observation（active から除外する）
    const sourceDup = new Set<string>();
    for (const row of db.prepare(
      "SELECT duplicate_observation_id AS id FROM settlement_source_duplicate_resolutions_v2",
    ).all() as Array<{ id: string }>) {
      sourceDup.add(row.id);
    }
    // superseded candidate（active から除外する）
    const superseded = new Set<string>();
    for (const row of db.prepare(
      "SELECT DISTINCT supersedes_candidate_id AS id FROM settlement_candidates_v2 WHERE supersedes_candidate_id IS NOT NULL",
    ).all() as Array<{ id: string }>) {
      superseded.add(row.id);
    }

    const map = new Map<string, { status: SettlementStatus; resultKind: ResultKind }>();
    const dbActive = new Map<string, number>();
    const ambiguousKeys = new Set<string>();
    let activeCandidateCount = 0;
    let totalCandidateCount = 0;

    const stmt = db.prepare(
      "SELECT candidate_id, canonical_race_key, bet_type, settlement_status, result_kind, observation_id FROM settlement_candidates_v2",
    );
    for (const row of stmt.iterate() as IterableIterator<{
      candidate_id: string; canonical_race_key: string; bet_type: string;
      settlement_status: string; result_kind: string; observation_id: string;
    }>) {
      totalCandidateCount += 1;
      if (sourceDup.has(row.observation_id)) continue;
      if (superseded.has(row.candidate_id)) continue;
      if (!BET_TYPE_SET.has(row.bet_type)) continue;
      const betType = row.bet_type as SettlementBetType;
      const key = candidateKey(row.canonical_race_key, betType);
      const status = row.settlement_status as SettlementStatus;
      const resultKind = row.result_kind as ResultKind;
      activeCandidateCount += 1;
      const venueName = venueNameFromCode(venueCodeFromKey(row.canonical_race_key));
      const agg = aggKey(yearFromKey(row.canonical_race_key), betType, venueName);
      dbActive.set(agg, (dbActive.get(agg) ?? 0) + 1);
      if (map.has(key)) { ambiguousKeys.add(key); continue; }
      map.set(key, { status, resultKind });
    }

    return {
      map, dbActive, ambiguousKeys, activeCandidateCount, totalCandidateCount,
      sourceDuplicateCount: sourceDup.size, supersededCount: superseded.size, schemaVersion,
    };
  } finally {
    db.close();
  }
}

// ---- archive 側 1 file を parse して candidate を導出 ----
type FileParse = { file: string; candidates: ArchiveCandidate[]; error: string | null };
async function parseArchiveFile(path: string): Promise<FileParse> {
  const file = basename(path);
  try {
    const bytes = await unpack(path);
    const text = new TextDecoder("shift_jis").decode(bytes);
    const parsed = parseOfficialResultDetail(text, { date: fileDate(path), fetchedAt: "1970-01-01T00:00:00.000Z" });
    return { file, candidates: deriveArchiveCandidates(parsed), error: null };
  } catch (error) {
    return { file, candidates: [], error: error instanceof Error ? error.message : String(error) };
  }
}

function classifyArchiveCandidate(agg: Aggregate, db: DbSide, cand: ArchiveCandidate): void {
  const venueName = venueNameFromCode(venueCodeFromKey(cand.raceKey));
  const cell = cellOf(agg, aggKey(yearFromKey(cand.raceKey), cand.betType, venueName));
  const key = candidateKey(cand.raceKey, cand.betType);
  if (db.ambiguousKeys.has(key)) {
    cell.ambiguous_canonical += 1;
    if (!agg.ambiguousKeys.includes(key)) agg.ambiguousKeys.push(key);
    return;
  }
  const dbRow = db.map.get(key);
  if (!dbRow) { cell.archive_only += 1; return; }
  const canonical: CanonicalCandidate = {
    raceKey: cand.raceKey, betType: cand.betType, status: dbRow.status, resultKind: dbRow.resultKind,
  };
  const klass = classifyPair(cand, canonical);
  cell[klass] += 1;
  const pairKey = aggKey(yearFromKey(cand.raceKey), cand.betType, venueName);
  agg.paired.set(pairKey, (agg.paired.get(pairKey) ?? 0) + 1);
  if (klass === "status_mismatch") {
    const mk = `${canonical.status}->${cand.status}`;
    agg.statusMatrix.set(mk, (agg.statusMatrix.get(mk) ?? 0) + 1);
    if (isFalseRefundDirection(cand, canonical)) cell.falseRefund += 1;
  }
  if (klass !== "exact_match" && agg.samples.length < 200) {
    agg.samples.push({
      raceKey: cand.raceKey, betType: cand.betType, class: klass,
      canonicalStatus: canonical.status, canonicalResultKind: canonical.resultKind,
      archiveStatus: cand.status, archiveResultKind: cand.resultKind,
    });
  }
}

async function main(): Promise<void> {
  if (!existsSync(archiveRoot)) throw new Error(`archive root not found: ${archiveRoot}`);
  if (!existsSync(sidecarPath)) throw new Error(`sidecar not found: ${sidecarPath}`);

  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  process.stderr.write(`[reconcile] loading canonical DB side from ${sidecarPath} ...\n`);
  const db = loadDbSide();
  process.stderr.write(
    `[reconcile] canonical active=${db.activeCandidateCount} total=${db.totalCandidateCount} ` +
    `sourceDup=${db.sourceDuplicateCount} superseded=${db.supersededCount} ambiguousKeys=${db.ambiguousKeys.size} ` +
    `schema=${db.schemaVersion}\n`,
  );

  const discovered = listArchiveFiles(archiveRoot);
  const selection = buildArchiveReconcileSelection({ discoveredFiles: discovered, asOf: asOfInput, limit });
  const selected = selection.selectedFiles;
  const asOf = selection.asOf;
  const archiveInventoryDigest = selection.inventoryDigest;
  const checkpointContract = archiveReconcileCheckpointContract(selection);

  const agg = (resume ? loadAggregate(checkpointPath, checkpointContract) : null) ?? newAggregate();
  const done = new Set(agg.processedFiles);
  const pending = selected.filter((path) => !done.has(basename(path)));
  process.stderr.write(
    `[reconcile] files: discovered=${discovered.length} cutoffEligible=${selection.eligibleFiles.length} `
      + `selected=${selected.length} pending=${pending.length}\n`,
  );

  let cursor = 0;
  let processed = agg.processedFiles.length;
  const inFlight = Math.min(concurrency, Math.max(1, pending.length));
  const flushEvery = 500;

  const worker = async (): Promise<void> => {
    while (cursor < pending.length) {
      const index = cursor++;
      const result = await parseArchiveFile(pending[index]);
      if (result.error) {
        // parse 失敗は fail-closed: 成功扱いにせず parse_failure として明示記録。
        agg.parseErrors.push({ file: result.file, error: result.error.slice(0, 300) });
        const year = fileDate(pending[index]).slice(0, 4);
        cellOf(agg, aggKey(year, "-", "-")).parse_failure += 1;
      } else {
        for (const cand of result.candidates) classifyArchiveCandidate(agg, db, cand);
      }
      agg.processedFiles.push(result.file);
      processed += 1;
      if (processed % flushEvery === 0) {
        writeFileSync(checkpointPath, `${JSON.stringify(serializeAggregate(agg, checkpointContract))}\n`);
        process.stderr.write(`[reconcile] processed ${processed}/${selected.length} files\n`);
      }
    }
  };
  mkdirSync(join(root, "data", "tmp"), { recursive: true });
  await Promise.all(Array.from({ length: inFlight }, () => worker()));
  writeFileSync(checkpointPath, `${JSON.stringify(serializeAggregate(agg, checkpointContract))}\n`);

  // canonical_only を dbActive − paired で導出し、cell へ反映する。
  for (const [key, active] of db.dbActive) {
    const paired = agg.paired.get(key) ?? 0;
    const canonicalOnly = active - paired;
    if (canonicalOnly < 0) {
      throw new Error(`negative canonical_only for ${key}: active=${active} paired=${paired}`);
    }
    if (canonicalOnly > 0) cellOf(agg, key).canonical_only += canonicalOnly;
  }

  // ---- 集計 rollup ----
  const totals = emptyCell();
  const byYear = new Map<string, Cell>();
  const byBetType = new Map<string, Cell>();
  const byVenue = new Map<string, Cell>();
  const addTo = (map: Map<string, Cell>, k: string, src: Cell): void => {
    let dst = map.get(k);
    if (!dst) { dst = emptyCell(); map.set(k, dst); }
    for (const klass of RECONCILE_CLASSES) dst[klass] += src[klass];
    dst.falseRefund += src.falseRefund;
  };
  for (const [key, cell] of agg.cells) {
    const [year, betType, venueName] = key.split("\u0000");
    for (const klass of RECONCILE_CLASSES) totals[klass] += cell[klass];
    totals.falseRefund += cell.falseRefund;
    addTo(byYear, year, cell);
    addTo(byBetType, betType, cell);
    addTo(byVenue, venueName, cell);
  }

  const archiveCandidates = totals.exact_match + totals.status_mismatch + totals.result_kind_mismatch
    + totals.archive_only + totals.ambiguous_canonical;
  const canonicalCandidatesReconciled = totals.exact_match + totals.status_mismatch + totals.result_kind_mismatch
    + totals.canonical_only;

  const sortCells = (map: Map<string, Cell>): Array<{ key: string } & Cell> =>
    [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, cell]) => ({ key, ...cell }));

  const statusMatrixRows = [...agg.statusMatrix.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([transition, count]) => ({ transition, count }));

  // 決定的 digest（runtime timestamp を含めない）。
  const digestBody = {
    reportSchemaVersion: REPORT_SCHEMA_VERSION,
    reconcileInputVersion: RECONCILE_INPUT_VERSION,
    archiveSelectionVersion: ARCHIVE_RECONCILE_SELECTION_VERSION,
    raceIdentityVersion: RACE_IDENTITY_VERSION,
    eventClassificationVersion: EVENT_CLASSIFICATION_VERSION,
    settlementCanonicalizationVersion: SETTLEMENT_CANONICALIZATION_VERSION,
    settlementSchemaVersion: db.schemaVersion,
    asOf,
    archiveInventoryDigest,
    archiveFilesScanned: selected.length,
    parseErrors: agg.parseErrors.length,
    totals,
    byYear: sortCells(byYear),
    byBetType: sortCells(byBetType),
    byVenue: sortCells(byVenue),
    statusMatrix: statusMatrixRows,
    ambiguousKeys: [...agg.ambiguousKeys].sort(),
  };
  const outputDigest = canonicalHash(digestBody);

  const payload = {
    phase: "N2_ARCHIVE_CANONICAL_SETTLEMENT_RECONCILIATION",
    reportSchemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    startedAt,
    completedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedMs,
    gitSha: process.env.GIT_SHA ?? null,
    scope: "read-only reconciliation of v2-parsed K archive vs canonical active settlement candidates; no DB/archive/sidecar mutation",
    contract: {
      reconcileInputVersion: RECONCILE_INPUT_VERSION,
      archiveSelectionVersion: ARCHIVE_RECONCILE_SELECTION_VERSION,
      checkpointVersion: ARCHIVE_RECONCILE_CHECKPOINT_VERSION,
      raceIdentityVersion: RACE_IDENTITY_VERSION,
      eventClassificationVersion: EVENT_CLASSIFICATION_VERSION,
      settlementCanonicalizationVersion: SETTLEMENT_CANONICALIZATION_VERSION,
      parserVersion: "n1-settlement-parser-v2",
      settlementSchemaVersion: db.schemaVersion,
      asOf,
    },
    input: {
      sidecar: sidecarPath,
      archiveRoot,
      archiveFilesDiscovered: discovered.length,
      archiveFilesEligibleAtCutoff: selection.eligibleFiles.length,
      archiveFilesScanned: selected.length,
      limited: limit != null,
      archiveInventoryDigest,
    },
    canonical: {
      totalCandidates: db.totalCandidateCount,
      activeCandidates: db.activeCandidateCount,
      sourceDuplicateObservations: db.sourceDuplicateCount,
      supersededCandidates: db.supersededCount,
      ambiguousActiveKeys: db.ambiguousKeys.size,
    },
    totals: {
      ...totals,
      archiveDerivedCandidates: archiveCandidates,
      canonicalReconciledCandidates: canonicalCandidatesReconciled,
    },
    coverage: {
      exactMatchRate: archiveCandidates > 0 ? totals.exact_match / archiveCandidates : null,
      archiveCoveredByCanonical: archiveCandidates > 0
        ? (archiveCandidates - totals.archive_only) / archiveCandidates : null,
      canonicalCoveredByArchive: canonicalCandidatesReconciled > 0
        ? (canonicalCandidatesReconciled - totals.canonical_only) / canonicalCandidatesReconciled : null,
    },
    byYear: sortCells(byYear),
    byBetType: sortCells(byBetType),
    byVenue: sortCells(byVenue),
    statusMatrix: statusMatrixRows,
    ambiguousKeys: [...agg.ambiguousKeys].sort(),
    samples: agg.samples,
    parseErrorSamples: agg.parseErrors.slice(0, 100),
    outputDigest,
    result: agg.parseErrors.length === 0 ? "RECONCILED" : "PARTIAL",
  };

  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, "archive-canonical-reconcile.json"), `${JSON.stringify(payload, null, 2)}\n`);

  const yearRows = sortCells(byYear).map((r) =>
    `| ${r.key} | ${r.exact_match} | ${r.status_mismatch} | ${r.result_kind_mismatch} | ${r.archive_only} | ${r.canonical_only} | ${r.falseRefund} |`,
  ).join("\n");
  const betRows = sortCells(byBetType).map((r) =>
    `| ${r.key} | ${r.exact_match} | ${r.status_mismatch} | ${r.result_kind_mismatch} | ${r.archive_only} | ${r.canonical_only} | ${r.falseRefund} |`,
  ).join("\n");
  const matrixRows = statusMatrixRows.map((r) => `| ${r.transition} | ${r.count} |`).join("\n");

  writeFileSync(join(reportDir, "archive-canonical-reconcile.md"), `# Archive ↔ canonical settlement reconciliation

- generated: ${payload.generatedAt}
- scope: ${payload.scope}
- as-of (archive cutoff): ${asOf}
- settlement schema: ${db.schemaVersion}
- parser: n1-settlement-parser-v2
- output digest: ${outputDigest}
- result: ${payload.result}

## Canonical DB (active)

- total candidates: ${db.totalCandidateCount}
- active candidates: ${db.activeCandidateCount}
- source-duplicate observations: ${db.sourceDuplicateCount}
- superseded candidates: ${db.supersededCount}
- ambiguous active keys: ${db.ambiguousKeys.size}

## Totals

| class | count |
|---|---:|
| exact_match | ${totals.exact_match} |
| status_mismatch | ${totals.status_mismatch} |
| result_kind_mismatch | ${totals.result_kind_mismatch} |
| archive_only | ${totals.archive_only} |
| canonical_only | ${totals.canonical_only} |
| ambiguous_canonical | ${totals.ambiguous_canonical} |
| parse_failure (files) | ${totals.parse_failure} |
| — false_refund (subset of status_mismatch) | ${totals.falseRefund} |

- archive-derived candidates: ${archiveCandidates}
- canonical reconciled candidates: ${canonicalCandidatesReconciled}
- exact-match rate: ${payload.coverage.exactMatchRate}
- archive covered by canonical: ${payload.coverage.archiveCoveredByCanonical}
- canonical covered by archive: ${payload.coverage.canonicalCoveredByArchive}

## Status transition matrix (canonical → archive, status_mismatch)

| transition | count |
|---|---:|
${matrixRows || "| — | 0 |"}

## By year

| year | exact | status_mm | kind_mm | archive_only | canonical_only | false_refund |
|---|---:|---:|---:|---:|---:|---:|
${yearRows || "| — | 0 | 0 | 0 | 0 | 0 | 0 |"}

## By bet type

| bet_type | exact | status_mm | kind_mm | archive_only | canonical_only | false_refund |
|---|---:|---:|---:|---:|---:|---:|
${betRows || "| — | 0 | 0 | 0 | 0 | 0 | 0 |"}

> reconciliation は v2 再parse（archive）と v1 由来 canonical DB を突合する。status_mismatch の大半は
> canonical=refunded → archive=settled（特払い bug 由来の偽返還）である。DB / archive / sidecar 無変更。
`);

  console.log(JSON.stringify({
    archiveFilesScanned: selected.length,
    parseErrors: agg.parseErrors.length,
    canonicalActive: db.activeCandidateCount,
    totals,
    coverage: payload.coverage,
    outputDigest,
    result: payload.result,
  }, null, 2));
}

await main();