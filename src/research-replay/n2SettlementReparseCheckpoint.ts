import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { canonicalHash, canonicalUtcTimestamp } from "./canonical";

export const N2_SETTLEMENT_REPARSE_CHECKPOINT_VERSION = "n2-settlement-reparse-checkpoint-v3";

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
  const selectedFilesDigest = canonicalHash(input.selectedFiles.map((path) => ({
    name: basename(path),
    sha256: sha256File(path),
  })));
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
