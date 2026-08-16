import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalHash } from "../research-replay/canonical";
import { readN2HistoricalTestArtifact } from "./n2ConfounderAuditExecutor";

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-n2-confounder-lineage-"));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeDiscovery(root: string, revision: string): unknown {
  const reports = join(root, "reports/n2");
  mkdirSync(reports, { recursive: true });
  const discovery = {
    status: "PASS",
    scan: {
      status: "PASS",
      scanVersion: "n2-edge-hypothesis-scan-v2",
      signals: [],
    },
    outputDigest: canonicalHash({ revision }),
    revision,
  };
  writeFileSync(join(reports, "n2-edge-hypothesis-scan.json"), `${JSON.stringify(discovery, null, 2)}\n`, "utf8");
  return discovery;
}

function writeHistorical(root: string, discoveryArtifactDigest: string | undefined): void {
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
      currentBuyConnectionAuthorized: false,
      lineConnectionAuthorized: false,
      publicPublishAuthorized: false,
      automatedBettingAuthorized: false,
      productionApplyAuthorized: false,
    },
  };
  const summary = {
    status: "PASS",
    ...(discoveryArtifactDigest === undefined ? {} : { discoveryArtifactDigest }),
    confirmation: {
      ...confirmationCore,
      outputDigest: canonicalHash(confirmationCore),
    },
    authority: {
      automaticPromotionAuthorized: false,
      currentBuyConnectionAuthorized: false,
      lineConnectionAuthorized: false,
      publicPublishAuthorized: false,
      automatedBettingAuthorized: false,
      productionApplyAuthorized: false,
    },
  };
  const payload = {
    ...summary,
    generatedAt: "2026-08-06T12:00:00.000Z",
    outputDigest: canonicalHash(summary),
  };
  writeFileSync(join(reports, "n2-edge-historical-test.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

test("historical artifact accepts the current discovery artifact lineage", () => {
  withRoot((root) => {
    const discovery = writeDiscovery(root, "current");
    writeHistorical(root, canonicalHash(discovery));

    const result = readN2HistoricalTestArtifact(root);

    assert.notEqual(result.artifact, null, result.blockers.join("; "));
    assert.deepEqual(result.blockers, []);
  });
});

test("historical artifact rejects a stale discovery artifact digest", () => {
  withRoot((root) => {
    const original = writeDiscovery(root, "original");
    writeHistorical(root, canonicalHash(original));
    writeDiscovery(root, "replacement");

    const result = readN2HistoricalTestArtifact(root);

    assert.equal(result.artifact, null);
    assert.ok(result.blockers.includes("HISTORICAL_DISCOVERY_DIGEST_MISMATCH"), result.blockers.join("; "));
  });
});

test("historical artifact rejects missing discovery lineage when a current discovery artifact exists", () => {
  withRoot((root) => {
    writeDiscovery(root, "current");
    writeHistorical(root, undefined);

    const result = readN2HistoricalTestArtifact(root);

    assert.equal(result.artifact, null);
    assert.ok(result.blockers.includes("HISTORICAL_DISCOVERY_DIGEST_INVALID"), result.blockers.join("; "));
  });
});

test("confounder ingestion rejects lineage when the current discovery artifact is missing", () => {
  withRoot((root) => {
    const discovery = writeDiscovery(root, "current");
    writeHistorical(root, canonicalHash(discovery));
    rmSync(join(root, "reports/n2/n2-edge-hypothesis-scan.json"));

    const result = readN2HistoricalTestArtifact(root, { requireCurrentDiscovery: true });

    assert.equal(result.artifact, null);
    assert.ok(result.blockers.includes("DISCOVERY_REPORT_MISSING"), result.blockers.join("; "));
  });
});
