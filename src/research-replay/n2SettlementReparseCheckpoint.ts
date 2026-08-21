import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";

import { canonicalHash, canonicalUtcTimestamp } from "./canonical";

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

function assertN2SettlementReparseProcessedFiles(
  checkpointIdentity: N2SettlementReparseCheckpointIdentity,
  state: unknown,
): void {
  if (typeof state !== "object" || state === null || Array.isArray(state)) {
    throw new Error("REPARSE_CHECKPOINT_STATE_INVALID");
  }
  const processedFiles = (state as Record<string, unknown>).processedFiles;
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
