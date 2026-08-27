import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

function isWithin(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function canonicalTarget(target: string): string {
  const resolvedTarget = resolve(target);
  let probe = dirname(resolvedTarget);
  while (!existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) return resolvedTarget;
    probe = parent;
  }
  return resolve(realpathSync.native(probe), relative(probe, resolvedTarget));
}

export function assertN2N2011FinalPreflightEvidenceOutputSafe(input: {
  root: string;
  canonicalRepo: string;
  primaryDbPath: string;
  sidecarDbPath: string;
  evidencePath: string;
}): void {
  const root = resolve(input.root);
  const validationDir = resolve(root, "reports/automation/validation");
  const canonicalRepo = resolve(input.canonicalRepo);
  const canonicalDataDir = resolve(canonicalRepo, "data");
  const evidencePath = resolve(input.evidencePath);
  const canonicalEvidencePath = canonicalTarget(evidencePath);
  const canonicalRoot = realpathSync.native(root);
  const canonicalValidationDir = resolve(canonicalRoot, "reports/automation/validation");
  const canonicalCanonicalRepo = realpathSync.native(canonicalRepo);
  const canonicalCanonicalDataDir = resolve(canonicalCanonicalRepo, "data");
  const protectedDatabasePaths = [
    resolve(input.primaryDbPath),
    `${resolve(input.primaryDbPath)}-wal`,
    `${resolve(input.primaryDbPath)}-shm`,
    resolve(input.sidecarDbPath),
    `${resolve(input.sidecarDbPath)}-wal`,
    `${resolve(input.sidecarDbPath)}-shm`,
  ];
  const canonicalProtectedDatabasePaths = new Set(protectedDatabasePaths.map(canonicalTarget));

  if (protectedDatabasePaths.includes(evidencePath) || canonicalProtectedDatabasePaths.has(canonicalEvidencePath)) {
    throw new Error(`N2_011_PREFLIGHT_EVIDENCE_DATABASE_PATH_FORBIDDEN:${evidencePath}`);
  }
  if (isWithin(canonicalDataDir, evidencePath) || isWithin(canonicalCanonicalDataDir, canonicalEvidencePath)) {
    throw new Error(`N2_011_PREFLIGHT_EVIDENCE_DATA_PATH_FORBIDDEN:${evidencePath}`);
  }
  if (isWithin(canonicalRepo, evidencePath) || isWithin(canonicalCanonicalRepo, canonicalEvidencePath)) {
    throw new Error(`N2_011_PREFLIGHT_EVIDENCE_CANONICAL_REPO_PATH_FORBIDDEN:${evidencePath}`);
  }

  const lexicalInRoot = isWithin(root, evidencePath);
  const canonicalInRoot = isWithin(canonicalRoot, canonicalEvidencePath);
  if (lexicalInRoot || canonicalInRoot) {
    const lexicalInValidation = isWithin(validationDir, evidencePath);
    const canonicalInValidation = isWithin(canonicalValidationDir, canonicalEvidencePath);
    if (!lexicalInValidation || !canonicalInValidation) {
      throw new Error(`N2_011_PREFLIGHT_EVIDENCE_REPO_PATH_FORBIDDEN:${evidencePath}`);
    }
  }
}
