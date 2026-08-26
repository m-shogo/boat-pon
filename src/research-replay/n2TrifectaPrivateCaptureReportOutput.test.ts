import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { assertN2TrifectaPrivateCaptureReportOutputSafe } from "./n2TrifectaPrivateCaptureReportOutput";

function withRoots(fn: (repoRoot: string, captureRoot: string, scratchRoot: string) => void): void {
  const repoRoot = mkdtempSync(join(tmpdir(), "private-capture-repo-"));
  const captureRoot = mkdtempSync(join(tmpdir(), "private-capture-data-"));
  const scratchRoot = mkdtempSync(join(tmpdir(), "private-capture-scratch-"));
  try {
    fn(repoRoot, captureRoot, scratchRoot);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(captureRoot, { recursive: true, force: true });
    rmSync(scratchRoot, { recursive: true, force: true });
  }
}

test("private capture report allows validation output and external scratch", () => {
  withRoots((repoRoot, captureRoot, scratchRoot) => {
    assert.doesNotThrow(() => assertN2TrifectaPrivateCaptureReportOutputSafe({
      repoRoot,
      captureRoot,
      reportPath: join(repoRoot, "reports/automation/validation/private-capture.json"),
    }));
    assert.doesNotThrow(() => assertN2TrifectaPrivateCaptureReportOutputSafe({
      repoRoot,
      captureRoot,
      reportPath: join(scratchRoot, "private-capture.json"),
    }));
  });
});

test("private capture report rejects repository authority and source paths", () => {
  withRoots((repoRoot, captureRoot) => {
    for (const reportPath of [
      join(repoRoot, "config/private-capture.json"),
      join(repoRoot, "scripts/private-capture.json"),
      join(repoRoot, "automation/private-capture.json"),
      join(repoRoot, "reports/n2/private-capture.json"),
    ]) {
      assert.throws(
        () => assertN2TrifectaPrivateCaptureReportOutputSafe({ repoRoot, captureRoot, reportPath }),
        /N2_PRIVATE_CAPTURE_REPORT_REPO_PATH_FORBIDDEN/u,
      );
    }
  });
});

test("private capture report rejects canonical capture data paths", () => {
  withRoots((repoRoot, captureRoot) => {
    for (const reportPath of [
      join(captureRoot, "data/raw/research/trifecta-market/report.json"),
      join(captureRoot, "data/research-replay.sqlite"),
      join(captureRoot, "data/tmp/private-capture.json"),
    ]) {
      assert.throws(
        () => assertN2TrifectaPrivateCaptureReportOutputSafe({ repoRoot, captureRoot, reportPath }),
        /N2_PRIVATE_CAPTURE_REPORT_DATA_PATH_FORBIDDEN/u,
      );
    }
  });
});
