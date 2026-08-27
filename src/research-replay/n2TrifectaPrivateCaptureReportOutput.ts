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

export function assertN2TrifectaPrivateCaptureReportOutputSafe(input: {
  repoRoot: string;
  captureRoot: string;
  reportPath: string;
}): void {
  const repoRoot = resolve(input.repoRoot);
  const validationDir = resolve(repoRoot, "reports/automation/validation");
  const captureRoot = resolve(input.captureRoot);
  const captureDataDir = resolve(captureRoot, "data");
  const reportPath = resolve(input.reportPath);
  const canonicalOutput = canonicalTarget(reportPath);
  const canonicalRepo = realpathSync.native(repoRoot);
  const canonicalValidationDir = resolve(canonicalRepo, "reports/automation/validation");
  const canonicalCaptureRoot = existsSync(captureRoot)
    ? realpathSync.native(captureRoot)
    : captureRoot;
  const canonicalCaptureDataDir = resolve(canonicalCaptureRoot, "data");

  if (isWithin(captureDataDir, reportPath) || isWithin(canonicalCaptureDataDir, canonicalOutput)) {
    throw new Error(`N2_PRIVATE_CAPTURE_REPORT_DATA_PATH_FORBIDDEN:${reportPath}`);
  }
  if (isWithin(repoRoot, reportPath)) {
    if (!isWithin(validationDir, reportPath)) {
      throw new Error(`N2_PRIVATE_CAPTURE_REPORT_REPO_PATH_FORBIDDEN:${reportPath}`);
    }
    if (!isWithin(canonicalValidationDir, canonicalOutput)) {
      throw new Error(`N2_PRIVATE_CAPTURE_REPORT_PATH_ALIAS:${reportPath}`);
    }
  } else if (isWithin(canonicalRepo, canonicalOutput)) {
    throw new Error(`N2_PRIVATE_CAPTURE_REPORT_PATH_ALIAS:${reportPath}`);
  }
}
