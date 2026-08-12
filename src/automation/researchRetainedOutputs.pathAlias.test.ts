import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { retainExecutorOutputs } from "./researchRetainedOutputs";

const historyOutputDigest = "a".repeat(64);

test("retained output producer rejects noncanonical source path aliases", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "boat-pon-retained-source-alias-"));
  try {
    mkdirSync(join(repoRoot, "reports/n2"), { recursive: true });
    writeFileSync(join(repoRoot, "reports/n2/report.txt"), "durable source\n", "utf8");

    const canonical = retainExecutorOutputs({
      repoRoot,
      runId: "12345",
      outputPaths: ["reports/n2/report.txt"],
      historyOutputDigest,
    });
    assert.equal(canonical.historyOutputs.length, 1);

    for (const alias of [
      "reports/n2/./report.txt",
      "reports/n2//report.txt",
      "reports/n2/report.txt/",
    ]) {
      assert.throws(
        () => retainExecutorOutputs({
          repoRoot,
          runId: "12346",
          outputPaths: [alias],
          historyOutputDigest,
        }),
        /RETAINED_OUTPUT_PATH_UNSAFE/u,
      );
    }
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
