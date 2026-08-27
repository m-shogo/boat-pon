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

export function assertN2TrifectaPrivateCapturePlanOutputSafe(input: {
  repoRoot: string;
  primaryDbPath: string;
  outputPath: string;
}): void {
  const repoRoot = resolve(input.repoRoot);
  const validationDir = resolve(repoRoot, "reports/automation/validation");
  const primaryDbPath = resolve(input.primaryDbPath);
  const primaryDataDir = dirname(primaryDbPath);
  const outputPath = resolve(input.outputPath);
  const canonicalOutput = canonicalTarget(outputPath);
  const canonicalRepo = realpathSync.native(repoRoot);
  const canonicalValidationDir = resolve(canonicalRepo, "reports/automation/validation");
  const canonicalDataDir = existsSync(primaryDataDir)
    ? realpathSync.native(primaryDataDir)
    : primaryDataDir;

  if (isWithin(primaryDataDir, outputPath) || isWithin(canonicalDataDir, canonicalOutput)) {
    throw new Error(`N2_PRIVATE_CAPTURE_PLAN_OUTPUT_DATA_PATH_FORBIDDEN:${outputPath}`);
  }
  if (isWithin(repoRoot, outputPath)) {
    if (!isWithin(validationDir, outputPath) || !isWithin(canonicalValidationDir, canonicalOutput)) {
      throw new Error(`N2_PRIVATE_CAPTURE_PLAN_OUTPUT_REPO_PATH_FORBIDDEN:${outputPath}`);
    }
  } else if (isWithin(canonicalRepo, canonicalOutput)) {
    throw new Error(`N2_PRIVATE_CAPTURE_PLAN_OUTPUT_REPO_PATH_FORBIDDEN:${outputPath}`);
  }
}
