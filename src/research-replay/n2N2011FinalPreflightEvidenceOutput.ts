import { isAbsolute, relative, resolve } from "node:path";

function isWithin(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
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
  const canonicalDataDir = resolve(input.canonicalRepo, "data");
  const evidencePath = resolve(input.evidencePath);
  const protectedDatabasePaths = new Set([
    resolve(input.primaryDbPath),
    `${resolve(input.primaryDbPath)}-wal`,
    `${resolve(input.primaryDbPath)}-shm`,
    resolve(input.sidecarDbPath),
    `${resolve(input.sidecarDbPath)}-wal`,
    `${resolve(input.sidecarDbPath)}-shm`,
  ]);

  if (protectedDatabasePaths.has(evidencePath)) {
    throw new Error(`N2_011_PREFLIGHT_EVIDENCE_DATABASE_PATH_FORBIDDEN:${evidencePath}`);
  }
  if (isWithin(canonicalDataDir, evidencePath)) {
    throw new Error(`N2_011_PREFLIGHT_EVIDENCE_DATA_PATH_FORBIDDEN:${evidencePath}`);
  }
  if (isWithin(root, evidencePath) && !isWithin(validationDir, evidencePath)) {
    throw new Error(`N2_011_PREFLIGHT_EVIDENCE_REPO_PATH_FORBIDDEN:${evidencePath}`);
  }
}
