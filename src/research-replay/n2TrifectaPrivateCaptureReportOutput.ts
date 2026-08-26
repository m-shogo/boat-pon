import { isAbsolute, relative, resolve } from "node:path";

function isWithin(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
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
  if (isWithin(repoRoot, reportPath) && !isWithin(validationDir, reportPath)) {
    throw new Error(`N2_PRIVATE_CAPTURE_REPORT_REPO_PATH_FORBIDDEN:${reportPath}`);
  }
}
