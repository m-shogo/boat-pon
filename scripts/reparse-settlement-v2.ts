// N2 settlement reparse CLI（append-only, deterministic, resumable, temp-copy only）。
//
// 実 sidecar（source）を read-only で扱い、明示 temp copy（target）へだけ書き込む。
// v1 parser defect（V1_SPECIAL_PAYOUT_FALSE_REFUND）を v2 再parse で append-only supersession 訂正する。
// 既存 row を UPDATE/DELETE しない。source への write は 0。production apply は本 CLI では行わない。
// DB 実行層は src/research-replay/n2SettlementReparseEngine.ts（integration test 済み）。
//
// 実行例（canary）:
//   pnpm reparse:n2:settlement -- --source-sidecar=data/research-replay.sqlite \
//     --target-sidecar=data/tmp/reparse-canary.sqlite --make-copy --overwrite-temp --canary \
//     --second-run-check --as-of=2026-08-01T00:00:00.000Z --mode=simulated
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync,
  statfsSync, statSync, writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseOfficialResultDetail } from "../src/domain/officialResultDetailParser";
import { canonicalHash, canonicalUtcTimestamp } from "../src/research-replay/canonical";
import { listArchiveFiles } from "../src/research-replay/n1Backfill";
import { SettlementRepository } from "../src/research-replay/settlement";
import {
  assertN2SettlementReparseCheckpointIdentity,
  assertN2SettlementReparseCheckpointStateDigest,
  buildN2SettlementReparseCheckpointIdentity,
  buildN2SettlementReparseCheckpointStateDigest,
  type N2SettlementReparseCheckpointIdentity,
} from "../src/research-replay/n2SettlementReparseCheckpoint";
import { assertN2SettlementReparseProcessedArchiveLineage } from "../src/research-replay/n2SettlementReparseResumeLineage";
import { resolveN2SettlementReparseResult } from "../src/research-replay/n2SettlementReparseResult";
import {
  assertN2SettlementReparseTerminalDuplicateLineage,
  n2SettlementReparseDoneFiles,
  normalizeN2SettlementReparseTerminalDuplicateFiles,
} from "../src/research-replay/n2SettlementReparseTerminalDuplicates";
import {
  REPARSE_CANONICALIZATION_VERSION, REPARSE_PARSER_NAME, REPARSE_RACE_IDENTITY_VERSION,
  REPARSE_REPORT_SCHEMA_VERSION, REPARSE_SCHEMA_VERSION, REPARSE_SOURCE_PARSER_VERSION,
  REPARSE_TARGET_PARSER_VERSION, deriveSettlementCandidates,
} from "../src/research-replay/n2SettlementReparse";
import {
  REPARSE_DEFECT_CODE, appendOnlyEnforcement, applyReparseForDocument, computeAfter, ensureSupersedesIndex,
  fullIntegrity, lightIntegrity, loadActiveState, loadSourceDuplicateSet, newState, physicalRowCount,
  type ActiveState, type Delta, type RawMeta, type ReparseState,
} from "../src/research-replay/n2SettlementReparseEngine";

type CliReparseState = ReparseState & { terminalDuplicateFiles: string[] };
function newCliState(): CliReparseState {
  return Object.assign(newState(), { terminalDuplicateFiles: [] as string[] });
}

const root = resolve(process.cwd());
function argValue(name: string): string | null {
  const direct = process.argv.find((v) => v.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}
const hasFlag = (name: string): boolean => process.argv.includes(name);
function positiveInt(v: string | null, fallback: number | null): number | null {
  if (v == null) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`expected positive integer: ${v}`);
  return n;
}

const rawAsOf = argValue("--as-of");
if (!rawAsOf) throw new Error("--as-of=<ISO8601 UTC> は必須です");
let asOf: string;
try {
  asOf = canonicalUtcTimestamp(rawAsOf);
} catch {
  throw new Error("--as-of=<ISO8601 UTC> は必須です");
}
const mode = argValue("--mode") ?? "simulated";
if (mode !== "simulated" && mode !== "production") throw new Error("--mode は simulated|production");
if (mode === "production") {
  throw new Error("PRODUCTION_APPLY_BLOCKED: real-sidecar apply requires a separate approved gate; use --mode=simulated");
}
const sourcePath = resolve(argValue("--source-sidecar") ?? join(root, "data", "research-replay.sqlite"));
const targetPath = resolve(argValue("--target-sidecar") ?? join(root, "data", "tmp", "reparse-target.sqlite"));
const archiveRoot = resolve(argValue("--archive-root") ?? join(root, "data", "raw", "official", "results"));
const reportDir = resolve(argValue("--report-dir") ?? join(root, "reports", "n2"));
const reportName = argValue("--report-name") ?? "settlement-reparse-temp-copy";
const checkpointPath = resolve(argValue("--checkpoint") ?? join(root, "data", "tmp", "reparse-settlement.checkpoint.json"));
const filesLimit = positiveInt(argValue("--files-limit"), null);
const makeCopy = hasFlag("--make-copy");
const overwriteTemp = hasFlag("--overwrite-temp");
const canary = hasFlag("--canary");
const verify = hasFlag("--verify");
const secondRunCheck = hasFlag("--second-run-check");
const resume = hasFlag("--resume");
const nowIso = asOf;

function sha256File(path: string): string {
  const out = spawnSync("shasum", ["-a", "256", path], { encoding: "utf8", maxBuffer: 1024 * 1024 });
  if (out.status !== 0) throw new Error(`shasum failed for ${path}: ${out.stderr}`);
  const hex = out.stdout.trim().split(/\s+/)[0];
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error(`unexpected shasum output for ${path}`);
  return hex;
}
function unpack(path: string): Promise<Buffer> {
  return new Promise((res, rej) => {
    const child = spawn("unar", ["-q", "-o", "-", path], { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = []; const err: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => err.push(c));
    child.on("error", rej);
    child.on("close", (code) => code === 0 ? res(Buffer.concat(out))
      : rej(new Error(Buffer.concat(err).toString("utf8") || `unar exit ${code}`)));
  });
}

// ---- safety guards ----
function assertSafePaths(): void {
  if (!existsSync(sourcePath)) throw new Error(`source sidecar not found: ${sourcePath}`);
  const sourceReal = realpathSync(sourcePath);
  const targetReal = existsSync(targetPath) ? realpathSync(targetPath) : resolve(targetPath);
  if (sourceReal === targetReal) throw new Error("SOURCE_TARGET_SAME_PATH: target must differ from source");
  if (existsSync(targetPath) && lstatSync(targetPath).isSymbolicLink()) throw new Error("TARGET_IS_SYMLINK");
  for (const suffix of ["-wal", "-shm"]) {
    const s = `${sourcePath}${suffix}`;
    if (existsSync(s) && statSync(s).size > 0) throw new Error(`SOURCE_HAS_ACTIVE_${suffix.toUpperCase()}`);
  }
}
function ensureDiskFree(neededBytes: number): number {
  const st = statfsSync(dirname(targetPath));
  const free = Number(st.bavail) * Number(st.bsize);
  if (free < neededBytes) throw new Error(`INSUFFICIENT_DISK: need ${neededBytes}, free ${free}`);
  return free;
}
type CopyResult = { sourceSha256: string; targetInitialSha256: string; sourceBytes: number };
function makeTempCopy(): CopyResult {
  const sourceBytes = statSync(sourcePath).size;
  ensureDiskFree(sourceBytes + 2 * 1024 * 1024 * 1024);
  if (existsSync(targetPath)) {
    if (!overwriteTemp) throw new Error(`TARGET_EXISTS: ${targetPath} (use --overwrite-temp)`);
    for (const s of ["", "-wal", "-shm"]) if (existsSync(`${targetPath}${s}`)) rmSync(`${targetPath}${s}`);
  }
  mkdirSync(dirname(targetPath), { recursive: true });
  const sourceSha256 = sha256File(sourcePath);
  copyFileSync(sourcePath, targetPath);
  const targetInitialSha256 = sha256File(targetPath);
  if (targetInitialSha256 !== sourceSha256) throw new Error("COPY_HASH_MISMATCH");
  return { sourceSha256, targetInitialSha256, sourceBytes };
}
function openTarget(): DatabaseSync {
  const db = new DatabaseSync(targetPath);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec("PRAGMA busy_timeout=60000");
  return db;
}

function loadRawMaps(db: DatabaseSync): { byHash: Map<string, RawMeta>; sourceDup: Set<string> } {
  const sourceDup = loadSourceDuplicateSet(db);
  const dateByRaw = new Map<string, string>();
  for (const r of db.prepare("SELECT raw_document_id AS rid, MIN(canonical_race_key) AS k FROM domain_observations GROUP BY raw_document_id").all() as Array<{ rid: string; k: string }>) {
    if (r.k && /^\d{4}-\d{2}-\d{2}:/.test(r.k)) dateByRaw.set(r.rid, r.k.slice(0, 10));
  }
  const familyByRaw = new Map<string, string>();
  for (const r of db.prepare("SELECT raw_document_id AS rid, source_schema_version AS fam FROM settlement_candidates_v2 GROUP BY raw_document_id").all() as Array<{ rid: string; fam: string }>) {
    familyByRaw.set(r.rid, r.fam);
  }
  const byHash = new Map<string, RawMeta>();
  for (const r of db.prepare("SELECT raw_document_id AS rid, raw_sha256 AS h FROM raw_documents").all() as Array<{ rid: string; h: string }>) {
    const date = dateByRaw.get(r.rid);
    if (date) byHash.set(r.h, { rawDocumentId: r.rid, date, family: familyByRaw.get(r.rid) ?? "modern_seven_display" });
  }
  return { byHash, sourceDup };
}

const KNOWN_DUP_FILES = ["k080706.lzh", "k080713.lzh", "k090406.lzh", "k090408.lzh"];
function selectCanaryFiles(all: string[]): string[] {
  const chosen = new Set<number>();
  for (let i = 0; i < all.length; i += 200) chosen.add(i);
  chosen.add(0); chosen.add(all.length - 1);
  const set = new Set<string>();
  for (const i of chosen) set.add(all[i]);
  for (const f of all) if (KNOWN_DUP_FILES.includes(basename(f))) set.add(f);
  return all.filter((f) => set.has(f));
}

// archive file を1つ処理して engine の applyReparseForDocument へ渡す（file レベル count は CLI 側）。
async function reparseFile(db: DatabaseSync, repo: SettlementRepository, byHash: Map<string, RawMeta>, activeState: ActiveState, path: string, state: CliReparseState, processedRaw: Set<string>): Promise<void> {
  state.counts.files_scanned += 1;
  let bytes: Buffer;
  try { bytes = await unpack(path); } catch { state.counts.parse_errors += 1; return; }
  const hash = createHash("sha256").update(bytes).digest("hex");
  const meta = byHash.get(hash);
  if (!meta) { state.counts.files_not_ingested += 1; return; }
  if (processedRaw.has(meta.rawDocumentId)) {
    state.counts.files_duplicate_source += 1;
    state.terminalDuplicateFiles.push(basename(path));
    return;
  }
  processedRaw.add(meta.rawDocumentId);
  state.counts.files_ingested += 1;
  const text = new TextDecoder("shift_jis").decode(bytes);
  const parsed = parseOfficialResultDetail(text, { date: meta.date, fetchedAt: "1970-01-01T00:00:00.000Z" });
  applyReparseForDocument(db, repo, meta, deriveSettlementCandidates(parsed), activeState, state, nowIso);
  state.processedFiles.push(basename(path));
  state.processedRawDocs.push(meta.rawDocumentId);
}

function serializeState(s: CliReparseState, checkpointIdentity: N2SettlementReparseCheckpointIdentity): unknown {
  const state = {
    version: REPARSE_SCHEMA_VERSION, counts: s.counts, corrections: s.corrections,
    processedFiles: s.processedFiles, processedRawDocs: s.processedRawDocs,
    terminalDuplicateFiles: s.terminalDuplicateFiles,
    byYear: [...s.byYear.entries()].sort(), byBetType: [...s.byBetType.entries()].sort(),
  };
  return {
    checkpointIdentity,
    stateDigest: buildN2SettlementReparseCheckpointStateDigest(checkpointIdentity, state),
    state,
  };
}
function loadState(path: string, expectedIdentity: N2SettlementReparseCheckpointIdentity): CliReparseState | null {
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  assertN2SettlementReparseCheckpointIdentity(raw.checkpointIdentity, expectedIdentity);
  if (typeof raw.state !== "object" || raw.state === null || Array.isArray(raw.state)) {
    throw new Error("REPARSE_CHECKPOINT_STATE_MISSING");
  }
  assertN2SettlementReparseCheckpointStateDigest(raw.stateDigest, expectedIdentity, raw.state);
  const saved = raw.state as Record<string, unknown>;
  if (saved.version !== REPARSE_SCHEMA_VERSION) throw new Error("REPARSE_CHECKPOINT_STATE_VERSION_MISMATCH");
  const s = newCliState();
  Object.assign(s.counts, saved.counts);
  s.corrections = saved.corrections as ReparseState["corrections"];
  s.processedFiles = saved.processedFiles as string[];
  s.processedRawDocs = saved.processedRawDocs as string[];
  s.terminalDuplicateFiles = normalizeN2SettlementReparseTerminalDuplicateFiles({
    value: saved.terminalDuplicateFiles,
    selectedFileBasenames: expectedIdentity.selectedFileBasenames,
    processedFiles: s.processedFiles,
    expectedDuplicateCount: s.counts.files_duplicate_source,
  });
  for (const [k, v] of saved.byYear as Array<[string, Delta]>) s.byYear.set(k, v);
  for (const [k, v] of saved.byBetType as Array<[string, Delta]>) s.byBetType.set(k, v);
  return s;
}

async function assertResumeProcessedArchiveLineage(
  state: CliReparseState,
  files: string[],
  byHash: Map<string, RawMeta>,
): Promise<void> {
  const pathByBasename = new Map(files.map((path) => [basename(path), path]));
  const rawDocumentIdByArchive = new Map<string, string>();
  for (const archiveFile of [...state.processedFiles, ...state.terminalDuplicateFiles]) {
    const path = pathByBasename.get(archiveFile);
    if (!path) throw new Error(`REPARSE_CHECKPOINT_PROCESSED_ARCHIVE_RAW_UNRESOLVED:${archiveFile}`);
    let bytes: Buffer;
    try {
      bytes = await unpack(path);
    } catch {
      throw new Error(`REPARSE_CHECKPOINT_PROCESSED_ARCHIVE_RAW_UNRESOLVED:${archiveFile}`);
    }
    const hash = createHash("sha256").update(bytes).digest("hex");
    const meta = byHash.get(hash);
    if (!meta) throw new Error(`REPARSE_CHECKPOINT_PROCESSED_ARCHIVE_RAW_UNRESOLVED:${archiveFile}`);
    rawDocumentIdByArchive.set(archiveFile, meta.rawDocumentId);
  }
  assertN2SettlementReparseProcessedArchiveLineage(state, rawDocumentIdByArchive);
  assertN2SettlementReparseTerminalDuplicateLineage({
    terminalDuplicateFiles: state.terminalDuplicateFiles,
    processedRawDocs: state.processedRawDocs,
    rawDocumentIdByArchive,
  });
}

async function runPass(
  db: DatabaseSync,
  repo: SettlementRepository,
  byHash: Map<string, RawMeta>,
  activeState: ActiveState,
  files: string[],
  state: CliReparseState,
  label: string,
  checkpointIdentity: N2SettlementReparseCheckpointIdentity,
  persistCheckpoint = true,
): Promise<void> {
  const processedRaw = new Set<string>(state.processedRawDocs);
  const done = n2SettlementReparseDoneFiles(state.processedFiles, state.terminalDuplicateFiles);
  let processed = done.size;
  for (const path of files) {
    if (done.has(basename(path))) continue;
    await reparseFile(db, repo, byHash, activeState, path, state, processedRaw);
    processed += 1;
    if (persistCheckpoint && processed % 500 === 0) {
      writeFileSync(checkpointPath, `${JSON.stringify(serializeState(state, checkpointIdentity))}\n`);
      process.stderr.write(`[reparse:${label}] ${processed}/${files.length} files (ingested ${state.counts.files_ingested}, appended ${state.counts.appended_candidates})\n`);
    }
  }
  if (persistCheckpoint) {
    writeFileSync(checkpointPath, `${JSON.stringify(serializeState(state, checkpointIdentity))}\n`);
  }
}

function sortRec(r: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(r).sort());
}

async function main(): Promise<void> {
  if (!existsSync(archiveRoot)) throw new Error(`archive root not found: ${archiveRoot}`);
  assertSafePaths();
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  let copy: CopyResult | null = null;
  if (makeCopy) {
    process.stderr.write(`[reparse] copying ${sourcePath} -> ${targetPath} ...\n`);
    copy = makeTempCopy();
    process.stderr.write(`[reparse] copy ok. source sha256=${copy.sourceSha256}\n`);
  } else if (!existsSync(targetPath)) throw new Error("TARGET_MISSING: pass --make-copy to create the temp copy");
  assertSafePaths();

  const db = openTarget();
  const repo = new SettlementRepository(db, randomUUID);
  try {
    ensureSupersedesIndex(db);
    const { byHash, sourceDup } = loadRawMaps(db);
    process.stderr.write("[reparse] loading active state (one sequential scan) ...\n");
    const activeState = loadActiveState(db, sourceDup);
    const before = { ...activeState.before };
    const physicalBefore = activeState.physicalRows;
    const ambiguousActiveKeys = activeState.ambiguousKeys.size;
    process.stderr.write(`[reparse] active=${activeState.active.size} ambiguous=${ambiguousActiveKeys} superseded=${activeState.supersededCount} physical=${physicalBefore}\n`);

    const allFiles = listArchiveFiles(archiveRoot);
    let files = canary ? selectCanaryFiles(allFiles) : allFiles;
    if (filesLimit != null) files = files.slice(0, filesLimit);
    process.stderr.write(`[reparse] mode=${mode} canary=${canary} files=${files.length} (of ${allFiles.length})\n`);

    const sourceSidecarSha256 = copy?.sourceSha256 ?? sha256File(sourcePath);
    const checkpointIdentity = buildN2SettlementReparseCheckpointIdentity({
      reparseSchemaVersion: REPARSE_SCHEMA_VERSION,
      sourceParserVersion: REPARSE_SOURCE_PARSER_VERSION,
      targetParserVersion: REPARSE_TARGET_PARSER_VERSION,
      canonicalizationVersion: REPARSE_CANONICALIZATION_VERSION,
      raceIdentityVersion: REPARSE_RACE_IDENTITY_VERSION,
      asOf,
      mode: "simulated",
      canary,
      filesLimit,
      sourcePath,
      sourceSidecarSha256,
      targetPath,
      archiveRoot,
      selectedFiles: files.map((file) => basename(file)),
    });
    const resumedState = resume ? loadState(checkpointPath, checkpointIdentity) : null;
    if (resume && resumedState === null) throw new Error("REPARSE_CHECKPOINT_MISSING");
    if (resumedState !== null) await assertResumeProcessedArchiveLineage(resumedState, files, byHash);
    const state = resumedState ?? newCliState();
    await runPass(db, repo, byHash, activeState, files, state, canary ? "canary" : "full", checkpointIdentity);

    let secondRun: { appended: number; supersessions: number } | null = null;
    if (secondRunCheck) {
      process.stderr.write("[reparse] second-run idempotency check ...\n");
      activeState.active.clear();
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      const active2 = loadActiveState(db, sourceDup);
      const s2 = newCliState();
      await runPass(db, repo, byHash, active2, files, s2, "second", checkpointIdentity, false);
      secondRun = { appended: s2.counts.appended_candidates, supersessions: s2.counts.supersession_relations };
    }

    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const afterMeasured = verify ? loadActiveState(db, sourceDup).before : null;
    const afterDelta = computeAfter(before, state.counts);
    const physicalAfter = physicalRowCount(db);
    const light = lightIntegrity(db);
    const appendOnly = appendOnlyEnforcement(db);
    const full = verify ? fullIntegrity(db) : null;
    const afterConsistent = afterMeasured ? JSON.stringify(sortRec(afterMeasured)) === JSON.stringify(sortRec(afterDelta)) : null;

    const digestBody = {
      reportSchemaVersion: REPARSE_REPORT_SCHEMA_VERSION, reparseSchemaVersion: REPARSE_SCHEMA_VERSION,
      raceIdentityVersion: REPARSE_RACE_IDENTITY_VERSION, canonicalizationVersion: REPARSE_CANONICALIZATION_VERSION,
      sourceParser: REPARSE_SOURCE_PARSER_VERSION, targetParser: REPARSE_TARGET_PARSER_VERSION, defectCode: REPARSE_DEFECT_CODE,
      counts: state.counts, byYear: [...state.byYear.entries()].sort(), byBetType: [...state.byBetType.entries()].sort(), corrections: state.corrections,
    };
    const outputDigest = canonicalHash(digestBody);

    const result = resolveN2SettlementReparseResult({
      counts: state.counts,
      lightIntegrity: light,
      appendOnlyEnforcement: appendOnly,
      secondRun,
      afterConsistent,
      fullIntegrity: full,
      ambiguousActiveKeys,
    });
    const payload = {
      phase: "N2_SETTLEMENT_REPARSE_TEMP_COPY", reportSchemaVersion: REPARSE_REPORT_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(), startedAt, completedAt: new Date().toISOString(),
      elapsedMs: Date.now() - startedMs, gitSha: process.env.GIT_SHA ?? null, mode, canary, asOf,
      scope: "append-only v2 reparse into an explicit temp copy; source sidecar read-only; no production apply",
      contract: {
        reparseSchemaVersion: REPARSE_SCHEMA_VERSION, sourceParserVersion: REPARSE_SOURCE_PARSER_VERSION,
        targetParserVersion: REPARSE_TARGET_PARSER_VERSION, canonicalizationVersion: REPARSE_CANONICALIZATION_VERSION,
        raceIdentityVersion: REPARSE_RACE_IDENTITY_VERSION, defectCode: REPARSE_DEFECT_CODE, parserName: REPARSE_PARSER_NAME,
      },
      identity: copy ? {
        sourcePath, targetPath, sourceSha256: copy.sourceSha256, targetInitialSha256: copy.targetInitialSha256,
        sourceBytes: copy.sourceBytes, targetFinalSha256: sha256File(targetPath),
      } : { sourcePath, targetPath, targetFinalSha256: sha256File(targetPath) },
      input: { archiveRoot, filesSelected: files.length, filesDiscovered: allFiles.length, canaryCohort: canary },
      counts: state.counts, before, afterDelta, afterMeasured, afterConsistent,
      physicalRows: { before: physicalBefore, after: physicalAfter },
      logicalActive: { before: Object.values(before).reduce((a, b) => a + b, 0), after: Object.values(afterDelta).reduce((a, b) => a + b, 0) },
      byYear: [...state.byYear.entries()].sort().map(([year, v]) => ({ year, ...v })),
      byBetType: [...state.byBetType.entries()].sort().map(([betType, v]) => ({ betType, ...v })),
      secondRun, lightIntegrity: light, appendOnlyEnforcement: appendOnly, fullIntegrity: full, ambiguousActiveKeys,
      correctionSamples: state.corrections.slice(0, 100), outputDigest,
      result,
    };

    mkdirSync(reportDir, { recursive: true });
    writeFileSync(join(reportDir, `${reportName}.json`), `${JSON.stringify(payload, null, 2)}\n`);
    writeMarkdown(payload);
    console.log(JSON.stringify({
      canary, filesIngested: state.counts.files_ingested, appended: state.counts.appended_candidates,
      falseRefund: state.counts.false_refund_correction, resultKind: state.counts.result_kind_correction,
      specialAddition: state.counts.special_payout_addition, ambiguousNonDefect: state.counts.ambiguous_non_defect,
      unexpectedAddition: state.counts.unexpected_addition, secondRun, before, afterDelta, afterConsistent,
      physicalBefore, physicalAfter, result, outputDigest,
    }, null, 2));
  } finally { db.close(); }
}

function writeMarkdown(payload: Record<string, unknown>): void {
  const counts = payload.counts as Record<string, number>;
  const before = payload.before as Record<string, number>;
  const after = payload.afterDelta as Record<string, number>;
  const secondRun = payload.secondRun as { appended: number; supersessions: number } | null;
  const light = payload.lightIntegrity as Record<string, number>;
  const full = payload.fullIntegrity as Record<string, unknown> | null;
  const correctionSamples = payload.correctionSamples as Array<Record<string, unknown>>;
  const byYear = payload.byYear as Array<Record<string, unknown>>;
  const byBetType = payload.byBetType as Array<Record<string, unknown>>;
  const result = payload.result as string;
  const outputDigest = payload.outputDigest as string;
  const second = secondRun ? `appended ${secondRun.appended} / supersessions ${secondRun.supersessions}` : "not executed";
  const integrity = full ? `integrity=${full.integrityCheck}, FK=${full.foreignKeyViolations}, orphan payout=${full.orphanPayoutLines}, orphan refund=${full.orphanRefundLines}` : "full integrity not requested";
  const yearRows = byYear.map((r) => `| ${r.year} | ${r.false_refund} | ${r.result_kind} | ${r.special_addition} |`).join("\n");
  const betRows = byBetType.map((r) => `| ${r.betType} | ${r.false_refund} | ${r.result_kind} | ${r.special_addition} |`).join("\n");
  writeFileSync(join(reportDir, `${reportName}.md`), `# N2 Settlement Reparse ${canary ? "Canary" : "Full"}\n\n` +
`- result: **${result}**\n- mode: ${mode} (production apply: **blocked**)\n- asOf: ${asOf}\n- elapsed: ${payload.elapsedMs}ms\n- outputDigest: \`${outputDigest}\`\n\n` +
`## Counts\n\n- files scanned/ingested/not-ingested/duplicate-source: ${counts.files_scanned} / ${counts.files_ingested} / ${counts.files_not_ingested} / ${counts.files_duplicate_source}\n` +
`- parse errors: ${counts.parse_errors}\n- appended candidates: ${counts.appended_candidates}\n- false refund corrections: ${counts.false_refund_correction}\n- result-kind corrections: ${counts.result_kind_correction}\n- special-payout additions: ${counts.special_payout_addition}\n- ambiguous non-defect: ${counts.ambiguous_non_defect}\n- unexpected additions (not applied): ${counts.unexpected_addition}\n\n` +
`## Before → After (logical active)\n\n| status | before | after |\n|---|---:|---:|\n| refunded | ${before.refunded ?? 0} | ${after.refunded ?? 0} |\n| partially_refunded | ${before.partially_refunded ?? 0} | ${after.partially_refunded ?? 0} |\n| settled | ${before.settled ?? 0} | ${after.settled ?? 0} |\n\n` +
`## By Year\n\n| year | false refund | result-kind | special addition |\n|---|---:|---:|---:|\n${yearRows || "| — | 0 | 0 | 0 |"}\n\n` +
`## By Bet Type\n\n| bet type | false refund | result-kind | special addition |\n|---|---:|---:|---:|\n${betRows || "| — | 0 | 0 | 0 |"}\n\n` +
`## Integrity\n\n- light: multiple active successor=${light.multipleActiveSuccessors}, self-cycle=${light.selfSupersedingCycles}, dangling=${light.danglingSupersedes}\n` +
`- append-only trigger: updateBlocked=${(payload.appendOnlyEnforcement as {updateBlocked:boolean}).updateBlocked}, deleteBlocked=${(payload.appendOnlyEnforcement as {deleteBlocked:boolean}).deleteBlocked}\n` +
`- full: ${integrity}\n- second run: ${second}\n- afterConsistent: ${payload.afterConsistent ?? "not checked"}\n\n` +
`## Correction sample (first ${correctionSamples.length})\n\n` +
correctionSamples.map((s) => `- ${s.raceKey} / ${s.betType}: ${s.action} (${s.originalStatus ?? "none"}→${s.correctedStatus}, ${s.originalResultKind ?? "none"}→${s.correctedResultKind})`).join("\n") + "\n");
}

await main();
