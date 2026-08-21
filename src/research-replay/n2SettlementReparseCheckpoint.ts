import { canonicalHash, canonicalUtcTimestamp } from "./canonical";

export const N2_SETTLEMENT_REPARSE_CHECKPOINT_VERSION = "n2-settlement-reparse-checkpoint-v2";

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
    selectedFilesDigest: canonicalHash([...input.selectedFiles]),
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
