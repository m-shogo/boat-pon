import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

function isWithin(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function assertCanonicalParent(root: string, target: string): void {
  const lexicalRoot = resolve(root);
  const canonicalRoot = realpathSync.native(lexicalRoot);
  let probe = dirname(resolve(target));

  while (isWithin(lexicalRoot, probe)) {
    if (existsSync(probe)) {
      const rel = relative(lexicalRoot, probe);
      if (realpathSync.native(probe) !== resolve(canonicalRoot, rel)) {
        throw new Error(`N2_PRIVATE_CAPTURE_REPORT_PATH_ALIAS:${target}`);
      }
      return;
    }
    const parent = dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
}

export function assertN2TrifectaPrivateCaptureReportOutputSafe(input: {
  repoRoot: string;
  captureRoot: string;
  reportPath: string;
}): void {
  const repoRoot = resolve(input.repoRoot);
  const validationDir = resolve(repoRoot, "reports/automation/validation");
  const captureDataDir = resolve(input.captureRoot, "data");
  const reportPath = resolve(input.reportPath);

  if (isWithin(captureDataDir, reportPath)) {
    throw new Error(`N2_PRIVATE_CAPTURE_REPORT_DATA_PATH_FORBIDDEN:${reportPath}`);
  }
  if (isWithin(repoRoot, reportPath)) {
    assertCanonicalParent(repoRoot, reportPath);
    if (!isWithin(validationDir, reportPath)) {
      throw new Error(`N2_PRIVATE_CAPTURE_REPORT_REPO_PATH_FORBIDDEN:${reportPath}`);
    }
  }
}
