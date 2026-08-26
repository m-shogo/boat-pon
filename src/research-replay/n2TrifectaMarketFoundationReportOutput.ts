import { isAbsolute, relative, resolve } from "node:path";

function isWithin(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function assertN2TrifectaMarketFoundationReportOutputSafe(input: {
  root: string;
  dataRoot: string;
  outputPath: string;
}): void {
  const root = resolve(input.root);
  const dataDir = resolve(input.dataRoot, "data");
  const reportsDir = resolve(root, "reports/n2");
  const outputPath = resolve(input.outputPath);

  if (isWithin(dataDir, outputPath)) {
    throw new Error(`N2_TRIFECTA_FOUNDATION_REPORT_OUTPUT_DATA_PATH_FORBIDDEN:${outputPath}`);
  }
  if (isWithin(root, outputPath) && !isWithin(reportsDir, outputPath)) {
    throw new Error(`N2_TRIFECTA_FOUNDATION_REPORT_OUTPUT_REPO_PATH_FORBIDDEN:${outputPath}`);
  }
}
