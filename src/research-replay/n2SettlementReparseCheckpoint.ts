import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";

import { canonicalHash, canonicalUtcTimestamp } from "./canonical";
import { parseCanonicalRaceKey } from "./identity";
import { fileDate } from "./n1Backfill";
import { REPARSE_ACTIONS } from "./n2SettlementReparse";
import { BET_TYPES } from "./settlement";

export const N2_SETTLEMENT_REPARSE_CHECKPOINT_VERSION = "n2-settlement-reparse-checkpoint-v5";
export const N2_SETTLEMENT_REPARSE_CHECKPOINT_STATE_DIGEST_VERSION = "n2-settlement-reparse-checkpoint-state-digest-v1";

export type N2SettlementReparseCheckpointIdentity = {
  checkpointVersion: typeof N2_SETTLEMENT_REPARSE_CHECKPOINT_VERSION;
  reparseSchemaVersion: string;
  sourceParserVersion: string;
  targetParserVersion: string;
  canonicalizationVersion: string;
  raceIdentityVersion: string;
  asOf: string;
  mode: "simulated";
  canary: boolean;
  filesLimit: number | null;
  sourcePath: string;
  sourceSidecarSha256: string;
  targetPath: string;
  archiveRoot: string;
  selectedFilesDigest: string;
  selectedFileBasenames: string[];
};

export function assertN2SettlementReparseResumeMode(input: {
  resume: boolean;
  makeCopy: boolean;
}): void {
  if (input.resume && input.makeCopy) {
    throw new Error("REPARSE_RESUME_MAKE_COPY_CONFLICT");
  }
}

// This module is imported by the reparse CLI before any filesystem mutation.
// Fail closed here so `--resume --make-copy` cannot recreate the target and then
// reuse a checkpoint whose processed-file state refers to the previous target.
const invokedByReparseCli = process.argv.some((value) => /(?:^|\/)reparse-settlement-v2\.(?:ts|js)$/.test(value));
if (invokedByReparseCli) {
  assertN2SettlementReparseResumeMode({
    resume: process.argv.includes("--resume"),
    makeCopy: process.argv.includes("--make-copy"),
  });
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function indexArchiveBasenames(rootDir: string): Map<string, string[]> {
  const byBasename = new Map<string, string[]>();
  const pending = [resolve(rootDir)];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
      } else if (entry.isFile()) {
        const matches = byBasename.get(entry.name) ?? [];
        matches.push(path);
        byBasename.set(entry.name, matches);
      }
    }
  }
  return byBasename;
}

function resolveSelectedArchivePaths(archiveRoot: string, selectedFiles: string[]): string[] {
  const needsRootLookup = selectedFiles.some((path) => !isAbsolute(path));
  const byBasename = needsRootLookup ? indexArchiveBasenames(archiveRoot) : new Map<string, string[]>();
  return selectedFiles.map((path) => {
    if (isAbsolute(path)) return path;
    const matches = byBasename.get(path) ?? [];
    if (matches.length === 0) throw new Error(`REPARSE_CHECKPOINT_ARCHIVE_NOT_FOUND:${path}`);
    if (matches.length > 1) throw new Error(`REPARSE_CHECKPOINT_ARCHIVE_BASENAME_AMBIGUOUS:${path}`);
    return matches[0];
  });
}

export function buildN2SettlementReparseCheckpointIdentity(input: {
  reparseSchemaVersion: string;
  sourceParserVersion: string;
  targetParserVersion: string;
  canonicalizationVersion: string;
  raceIdentityVersion: string;
  asOf: string;
  mode: "simulated";
  canary: boolean;
  filesLimit: number | null;
  sourcePath: string;
  sourceSidecarSha256: string;
  targetPath: string;
  archiveRoot: string;
  selectedFiles: string[];
}): N2SettlementReparseCheckpointIdentity {
  if (!/^[0-9a-f]{64}$/.test(input.sourceSidecarSha256)) {
    throw new Error("REPARSE_CHECKPOINT_SOURCE_SHA_INVALID");
  }
  const resolvedSelections = resolveSelectedArchivePaths(input.archiveRoot, input.selectedFiles);
  const selectedFiles = resolvedSelections.map((path) => ({
    name: basename(path),
    sha256: sha256File(path),
  }));
  const uniqueBasenames = new Set(selectedFiles.map((entry) => entry.name));
  if (uniqueBasenames.size !== selectedFiles.length) {
    throw new Error("REPARSE_CHECKPOINT_ARCHIVE_BASENAME_DUPLICATE");
  }
  const selectedFilesDigest = canonicalHash(selectedFiles);
  return {
    checkpointVersion: N2_SETTLEMENT_REPARSE_CHECKPOINT_VERSION,
    reparseSchemaVersion: input.reparseSchemaVersion,
    sourceParserVersion: input.sourceParserVersion,
    targetParserVersion: input.targetParserVersion,
    canonicalizationVersion: input.canonicalizationVersion,
    raceIdentityVersion: input.raceIdentityVersion,
    asOf: canonicalUtcTimestamp(input.asOf),
    mode: input.mode,
    canary: input.canary,
    filesLimit: input.filesLimit,
    sourcePath: input.sourcePath,
    sourceSidecarSha256: input.sourceSidecarSha256,
    targetPath: input.targetPath,
    archiveRoot: input.archiveRoot,
    selectedFilesDigest,
    selectedFileBasenames: selectedFiles.map((entry) => entry.name),
  };
}

export function assertN2SettlementReparseCheckpointIdentity(
  actual: unknown,
  expected: N2SettlementReparseCheckpointIdentity,
): asserts actual is N2SettlementReparseCheckpointIdentity {
  if (typeof actual !== "object" || actual === null || Array.isArray(actual)) {
    throw new Error("REPARSE_CHECKPOINT_IDENTITY_MISSING");
  }
  if (canonicalHash(actual) !== canonicalHash(expected)) {
    throw new Error("REPARSE_CHECKPOINT_IDENTITY_MISMATCH");
  }
}

export function buildN2SettlementReparseCheckpointStateDigest(
  checkpointIdentity: N2SettlementReparseCheckpointIdentity,
  state: unknown,
): string {
  return canonicalHash({
    digestVersion: N2_SETTLEMENT_REPARSE_CHECKPOINT_STATE_DIGEST_VERSION,
    checkpointIdentity,
    state,
  });
}

function requireNonNegativeSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`REPARSE_CHECKPOINT_COUNT_INVALID:${label}`);
  }
  return value as number;
}

type ReparseDelta = { false_refund: number; result_kind: number; special_addition: number };

function assertDeltaEntries(
  value: unknown,
  label: string,
  allowedKeys: ReadonlySet<string>,
): { total: number; entries: Map<string, ReparseDelta> } {
  if (!Array.isArray(value)) {
    throw new Error(`REPARSE_CHECKPOINT_REPORT_TABLE_INVALID:${label}`);
  }
  const entries = new Map<string, ReparseDelta>();
  let total = 0;
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || entry[0].trim() !== entry[0] || entry[0].length === 0) {
      throw new Error(`REPARSE_CHECKPOINT_REPORT_ENTRY_INVALID:${label}`);
    }
    if (!allowedKeys.has(entry[0])) {
      throw new Error(`REPARSE_CHECKPOINT_REPORT_KEY_INVALID:${label}:${entry[0]}`);
    }
    if (entries.has(entry[0])) {
      throw new Error(`REPARSE_CHECKPOINT_REPORT_KEY_DUPLICATE:${label}:${entry[0]}`);
    }
    if (typeof entry[1] !== "object" || entry[1] === null || Array.isArray(entry[1])) {
      throw new Error(`REPARSE_CHECKPOINT_REPORT_ENTRY_INVALID:${label}:${entry[0]}`);
    }
    const delta = entry[1] as Record<string, unknown>;
    if (Object.keys(delta).sort().join(",") !== "false_refund,result_kind,special_addition") {
      throw new Error(`REPARSE_CHECKPOINT_REPORT_ENTRY_INVALID:${label}:${entry[0]}`);
    }
    const parsed: ReparseDelta = {
      false_refund: requireNonNegativeSafeInteger(delta.false_refund, `${label}:${entry[0]}:false_refund`),
      result_kind: requireNonNegativeSafeInteger(delta.result_kind, `${label}:${entry[0]}:result_kind`),
      special_addition: requireNonNegativeSafeInteger(delta.special_addition, `${label}:${entry[0]}:special_addition`),
    };
    total += parsed.false_refund + parsed.result_kind + parsed.special_addition;
    entries.set(entry[0], parsed);
  }
  if (!Number.isSafeInteger(total)) {
    throw new Error(`REPARSE_CHECKPOINT_REPORT_TOTAL_INVALID:${label}`);
  }
  return { total, entries };
}

const CORRECTION_ACTION_FIELD = {
  false_refund_correction: "false_refund",
  result_kind_correction: "result_kind",
  special_payout_addition: "special_addition",
} as const;
const BET_TYPE_SET = new Set<string>(BET_TYPES);
const REPARSE_COUNT_KEYS = [
  "files_scanned",
  "files_ingested",
  "files_not_ingested",
  "files_duplicate_source",
  "parse_errors",
  "appended_candidates",
  "appended_parse_runs",
  "appended_observations",
  "supersession_relations",
  "ambiguous_active",
  "fr_from_refunded",
  "fr_from_partial",
  ...REPARSE_ACTIONS,
] as const;
const SORTED_REPARSE_COUNT_KEYS = [...REPARSE_COUNT_KEYS].sort();

function requireCorrectionSampleSemantics(sample: Record<string, unknown>, index: number): void {
  const raceKey = sample.raceKey;
  const betType = sample.betType;
  const action = sample.action;
  if (typeof raceKey !== "string") throw new Error(`REPARSE_CHECKPOINT_CORRECTION_INVALID:${index}:raceKey`);
  parseCanonicalRaceKey(raceKey);
  if (typeof betType !== "string" || !BET_TYPE_SET.has(betType)) throw new Error(`REPARSE_CHECKPOINT_CORRECTION_INVALID:${index}:betType`);
  if (typeof action !== "string" || !(action in CORRECTION_ACTION_FIELD)) throw new Error(`REPARSE_CHECKPOINT_CORRECTION_INVALID:${index}:action`);
  if (sample.defectCode !== "V1_SPECIAL_PAYOUT_FALSE_REFUND") throw new Error(`REPARSE_CHECKPOINT_CORRECTION_INVALID:${index}:defectCode`);

  if (action === "false_refund_correction") {
    if ((sample.originalStatus !== "refunded" && sample.originalStatus !== "partially_refunded") || sample.correctedStatus !== "settled") {
      throw new Error(`REPARSE_CHECKPOINT_CORRECTION_INVALID:${index}:status`);
    }
  } else if (action === "result_kind_correction") {
    if (typeof sample.originalStatus !== "string" || sample.originalStatus !== sample.correctedStatus || sample.originalResultKind === "special_payout" || sample.correctedResultKind !== "special_payout") {
      throw new Error(`REPARSE_CHECKPOINT_CORRECTION_INVALID:${index}:resultKind`);
    }
  } else {
    if (sample.originalStatus !== null || sample.originalResultKind !== null || sample.correctedResultKind !== "special_payout") {
      throw new Error(`REPARSE_CHECKPOINT_CORRECTION_INVALID:${index}:addition`);
    }
  }
}

function consumeCorrectionAggregate(
  table: Map<string, ReparseDelta>,
  key: string,
  action: keyof typeof CORRECTION_ACTION_FIELD,
  label: string,
  index: number,
): void {
  const entry = table.get(key);
  const field = CORRECTION_ACTION_FIELD[action];
  if (!entry || entry[field] <= 0) {
    throw new Error(`REPARSE_CHECKPOINT_CORRECTION_AGGREGATE_MISMATCH:${label}:${key}:${field}:${index}`);
  }
  entry[field] -= 1;
}

function assertCorrectionSamples(
  corrections: unknown,
  appendedCandidates: number,
  byYear: Map<string, ReparseDelta>,
  byBetType: Map<string, ReparseDelta>,
): void {
  if (!Array.isArray(corrections) || corrections.length !== Math.min(appendedCandidates, 400)) {
    throw new Error("REPARSE_CHECKPOINT_CORRECTION_COUNT_MISMATCH");
  }
  for (let index = 0; index < corrections.length; index += 1) {
    const sample = corrections[index];
    if (typeof sample !== "object" || sample === null || Array.isArray(sample)) {
      throw new Error(`REPARSE_CHECKPOINT_CORRECTION_INVALID:${index}:shape`);
    }
    const record = sample as Record<string, unknown>;
    requireCorrectionSampleSemantics(record, index);
    const race = parseCanonicalRaceKey(record.raceKey as string);
    const action = record.action as keyof typeof CORRECTION_ACTION_FIELD;
    consumeCorrectionAggregate(byYear, race.raceDateJst.slice(0, 4), action, "byYear", index);
    consumeCorrectionAggregate(byBetType, record.betType as string, action, "byBetType", index);
  }
  if (appendedCandidates <= 400) {
    const remaining = [...byYear.values(), ...byBetType.values()].reduce(
      (sum, delta) => sum + delta.false_refund + delta.result_kind + delta.special_addition,
      0,
    );
    if (remaining !== 0) throw new Error("REPARSE_CHECKPOINT_CORRECTION_AGGREGATE_MISMATCH:remaining");
  }
}

function assertN2SettlementReparseStateAggregates(state: Record<string, unknown>): void {
  const counts = state.counts;
  if (typeof counts !== "object" || counts === null || Array.isArray(counts)) {
    throw new Error("REPARSE_CHECKPOINT_COUNTS_INVALID");
  }
  const countRecord = counts as Record<string, unknown>;
  const actualCountKeys = Object.keys(countRecord).sort();
  if (actualCountKeys.join(",") !== SORTED_REPARSE_COUNT_KEYS.join(",")) {
    throw new Error("REPARSE_CHECKPOINT_COUNTS_SHAPE_INVALID");
  }
  for (const key of REPARSE_COUNT_KEYS) {
    requireNonNegativeSafeInteger(countRecord[key], key);
  }

  const filesScanned = requireNonNegativeSafeInteger(countRecord.files_scanned, "files_scanned");
  const filesIngested = requireNonNegativeSafeInteger(countRecord.files_ingested, "files_ingested");
  const filesNotIngested = requireNonNegativeSafeInteger(countRecord.files_not_ingested, "files_not_ingested");
  const duplicateSource = requireNonNegativeSafeInteger(countRecord.files_duplicate_source, "files_duplicate_source");
  const parseErrors = requireNonNegativeSafeInteger(countRecord.parse_errors, "parse_errors");
  if (filesScanned !== filesIngested + filesNotIngested + duplicateSource + parseErrors) {
    throw new Error("REPARSE_CHECKPOINT_FILE_COUNTS_INCONSISTENT");
  }

  const processedFiles = state.processedFiles;
  const processedRawDocs = state.processedRawDocs;
  if (!Array.isArray(processedFiles) || !Array.isArray(processedRawDocs)) {
    throw new Error("REPARSE_CHECKPOINT_PROCESSED_LINEAGE_INVALID");
  }
  if (filesIngested !== processedFiles.length || filesIngested !== processedRawDocs.length) {
    throw new Error("REPARSE_CHECKPOINT_PROCESSED_LINEAGE_COUNT_MISMATCH");
  }

  const seenRawDocs = new Set<string>();
  for (const rawDocumentId of processedRawDocs) {
    if (typeof rawDocumentId !== "string" || rawDocumentId.trim() !== rawDocumentId || rawDocumentId.length === 0) {
      throw new Error(`REPARSE_CHECKPOINT_PROCESSED_RAW_INVALID:${String(rawDocumentId)}`);
    }
    if (seenRawDocs.has(rawDocumentId)) {
      throw new Error(`REPARSE_CHECKPOINT_PROCESSED_RAW_DUPLICATE:${rawDocumentId}`);
    }
    seenRawDocs.add(rawDocumentId);
  }

  const processedYears = new Set((processedFiles as string[]).map((file) => fileDate(file).slice(0, 4)));
  const appendedCandidates = requireNonNegativeSafeInteger(countRecord.appended_candidates, "appended_candidates");
  const yearAggregate = assertDeltaEntries(state.byYear, "byYear", processedYears);
  const betAggregate = assertDeltaEntries(state.byBetType, "byBetType", BET_TYPE_SET);
  if (yearAggregate.total !== appendedCandidates || betAggregate.total !== appendedCandidates) {
    throw new Error("REPARSE_CHECKPOINT_REPORT_TOTAL_MISMATCH");
  }
  assertCorrectionSamples(state.corrections, appendedCandidates, yearAggregate.entries, betAggregate.entries);
}

function assertN2SettlementReparseProcessedFiles(
  checkpointIdentity: N2SettlementReparseCheckpointIdentity,
  state: unknown,
): void {
  if (typeof state !== "object" || state === null || Array.isArray(state)) {
    throw new Error("REPARSE_CHECKPOINT_STATE_INVALID");
  }
  const stateRecord = state as Record<string, unknown>;
  const processedFiles = stateRecord.processedFiles;
  if (!Array.isArray(processedFiles)) {
    throw new Error("REPARSE_CHECKPOINT_PROCESSED_FILES_INVALID");
  }
  const allowed = new Set(checkpointIdentity.selectedFileBasenames);
  const seen = new Set<string>();
  for (const file of processedFiles) {
    if (typeof file !== "string" || basename(file) !== file || !allowed.has(file)) {
      throw new Error(`REPARSE_CHECKPOINT_PROCESSED_FILE_OUT_OF_SELECTION:${String(file)}`);
    }
    if (seen.has(file)) {
      throw new Error(`REPARSE_CHECKPOINT_PROCESSED_FILE_DUPLICATE:${file}`);
    }
    seen.add(file);
  }
  assertN2SettlementReparseStateAggregates(stateRecord);
}

export function assertN2SettlementReparseCheckpointStateDigest(
  actualDigest: unknown,
  checkpointIdentity: N2SettlementReparseCheckpointIdentity,
  state: unknown,
): asserts actualDigest is string {
  if (typeof actualDigest !== "string" || !/^[0-9a-f]{64}$/.test(actualDigest)) {
    throw new Error("REPARSE_CHECKPOINT_STATE_DIGEST_MISSING");
  }
  const expectedDigest = buildN2SettlementReparseCheckpointStateDigest(checkpointIdentity, state);
  if (actualDigest !== expectedDigest) {
    throw new Error("REPARSE_CHECKPOINT_STATE_DIGEST_MISMATCH");
  }
  assertN2SettlementReparseProcessedFiles(checkpointIdentity, state);
}
