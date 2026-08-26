import { isAbsolute, relative, resolve } from "node:path";

function isWithin(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function assertN2TrifectaRealPlanPreflightReportOutputSafe(input: {
  root: string;
  primaryDbPath: string;
  outputPath: string;
}): void {
  const root = resolve(input.root);
  const validationDir = resolve(root, "reports/automation/validation");
  const primaryDbPath = resolve(input.primaryDbPath);
  const outputPath = resolve(input.outputPath);
  const protectedDatabasePaths = new Set([
    primaryDbPath,
    `${primaryDbPath}-wal`,
    `${primaryDbPath}-shm`,
  ]);

  if (protectedDatabasePaths.has(outputPath)) {
    throw new Error(`N2_TRIFECTA_REAL_PLAN_PREFLIGHT_OUTPUT_DATABASE_PATH_FORBIDDEN:${outputPath}`);
  }
  if (isWithin(root, outputPath) && !isWithin(validationDir, outputPath)) {
    throw new Error(`N2_TRIFECTA_REAL_PLAN_PREFLIGHT_OUTPUT_REPO_PATH_FORBIDDEN:${outputPath}`);
  }
}
