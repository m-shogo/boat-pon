import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalHash } from "../research-replay/canonical";
import { readN2HistoricalTestArtifact } from "./n2ConfounderAuditExecutor";

function writeArtifact(root: string, generatedAt: string): void {
  const reports = join(root, "reports/n2");
  mkdirSync(reports, { recursive: true });
  const confirmationCore = {
    status: "PASS",
    lockedHypothesisCount: 0,
    confirmedCount: 0,
    rejectedCount: 0,
    insufficientCount: 0,
    results: [],
    authority: {
      forwardLabelsUsedForConfirmation: false,
      automaticPromotionAuthorized: false,
    },
  };
  const summary = {
    status: "PASS",
    confirmation: {
      ...confirmationCore,
      outputDigest: canonicalHash(confirmationCore),
    },
    authority: {
      automaticPromotionAuthorized: false,
      productionApplyAuthorized: false,
    },
  };
  const payload = {
    ...summary,
    generatedAt,
    outputDigest: canonicalHash(summary),
  };
  writeFileSync(join(reports, "n2-edge-historical-test.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-n2-confounder-date-"));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("historical artifact accepts canonical leap-day and explicit-offset generatedAt values", () => {
  for (const generatedAt of [
    "2028-02-29T07:00:00.000Z",
    "2028-02-29T16:00:00+09:00",
  ]) {
    withRoot((root) => {
      writeArtifact(root, generatedAt);
      const result = readN2HistoricalTestArtifact(root);
      assert.notEqual(result.artifact, null, `${generatedAt}: ${result.blockers.join("; ")}`);
      assert.deepEqual(result.blockers, []);
    });
  }
});

test("historical artifact rejects normalized or timezone-ambiguous generatedAt values", () => {
  for (const generatedAt of [
    "2026-02-29T07:00:00.000Z",
    "2026-02-30T07:00:00.000Z",
    "2026-04-31T16:00:00+09:00",
    "2026-08-06T24:00:00.000Z",
    "2026-08-06T12:00:00.000",
  ]) {
    withRoot((root) => {
      writeArtifact(root, generatedAt);
      const result = readN2HistoricalTestArtifact(root);
      assert.equal(result.artifact, null, generatedAt);
      assert.ok(result.blockers.includes("HISTORICAL_TEST_GENERATED_AT_INVALID"), generatedAt);
    });
  }
});
