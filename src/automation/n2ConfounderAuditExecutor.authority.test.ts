import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalHash } from "../research-replay/canonical";
import { readN2HistoricalTestArtifact } from "./n2ConfounderAuditExecutor";

const PRODUCTION_AUTHORITY = {
  automaticPromotionAuthorized: false,
  currentBuyConnectionAuthorized: false,
  lineConnectionAuthorized: false,
  publicPublishAuthorized: false,
  automatedBettingAuthorized: false,
  productionApplyAuthorized: false,
};

type ProductionAuthorityField = keyof typeof PRODUCTION_AUTHORITY;

function splitResult(split: "validation" | "test") {
  return {
    split,
    uniqueRaceCount: 220,
    meanResidual: 0.02,
    standardError: 0.002,
    zScore: 10,
    rawPValue: 1e-8,
    holmAdjustedPValue: 1e-8,
    supportSufficient: true,
    effectSufficient: true,
    directionMatchesDiscovery: true,
    statisticallyConfirmed: true,
  };
}

function confirmation(authorityOverrides: Record<string, boolean> = {}) {
  const core = {
    confirmationVersion: "n2-edge-historical-confirmation-v1",
    status: "PASS",
    blockers: [],
    lockedHypothesisCount: 1,
    validationRaceCount: 220,
    testRaceCount: 220,
    confirmationMethod: {
      rediscoveryAllowed: false,
      interactionSearchAllowed: false,
      raceLevelResidualRequired: true,
      minUniqueRacesPerSplit: 200,
      minAbsoluteResidual: 0.001,
      familyWiseAlpha: 0.05,
      multipleTesting: "Holm-Bonferroni separately within validation and test",
      bothHoldoutSplitsRequired: true,
      sameDirectionRequired: true,
      forwardShadowUsed: false,
    },
    confirmedCount: 1,
    rejectedCount: 0,
    insufficientCount: 0,
    results: [{
      hypothesisId: "N2EDGE-test",
      featureKey: "firstCourse",
      bucket: "1",
      discoveryDirection: "underpredicted",
      validation: splitResult("validation"),
      test: splitResult("test"),
      verdict: "HISTORICAL_CONFIRMED",
    }],
    authority: {
      roiUsedForConfirmation: false,
      payoutUsedForConfirmation: false,
      trainLabelsUsedForConfirmation: false,
      forwardLabelsUsedForConfirmation: false,
      ...PRODUCTION_AUTHORITY,
      ...authorityOverrides,
    },
  };
  return { ...core, outputDigest: canonicalHash(core) };
}

function distribution(authorityOverrides: Record<string, boolean> = {}) {
  const core = {
    evidenceVersion: "n2-edge-holdout-distribution-evidence-v1",
    status: "PASS",
    blockers: [],
    lockedHypothesisCount: 1,
    inputRaceCount: 0,
    validationInputRaceCount: 0,
    testInputRaceCount: 0,
    hypotheses: [],
    privacy: {
      raceKeysPersisted: false,
      venueCodesPersisted: false,
      yearsPersisted: false,
      perRaceResidualsPersisted: false,
    },
    authority: {
      confirmationVerdictChanged: false,
      rejectionRescueAuthorized: false,
      forwardLabelsUsed: false,
      ...PRODUCTION_AUTHORITY,
      ...authorityOverrides,
    },
  };
  return { ...core, outputDigest: canonicalHash(core) };
}

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-confounder-authority-"));
  try {
    mkdirSync(join(root, "reports/n2"), { recursive: true });
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeArtifact(root: string, input: {
  historicalAuthority?: Record<string, boolean>;
  historicalAuthorityOmit?: ProductionAuthorityField;
  confirmationAuthority?: Record<string, boolean>;
  distributionAuthority?: Record<string, boolean>;
}): void {
  const historicalAuthority: Record<string, boolean> = { ...PRODUCTION_AUTHORITY, ...input.historicalAuthority };
  if (input.historicalAuthorityOmit) delete historicalAuthority[input.historicalAuthorityOmit];
  const summary = {
    status: "PASS",
    confirmation: confirmation(input.confirmationAuthority),
    distributionEvidence: distribution(input.distributionAuthority),
    authority: historicalAuthority,
  };
  const payload = {
    ...summary,
    generatedAt: "2026-08-16T10:00:00.000Z",
    outputDigest: canonicalHash(summary),
  };
  writeFileSync(
    join(root, "reports/n2/n2-edge-historical-test.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
}

test("confounder artifact ingestion rejects widened historical production authorities", () => {
  const cases = [
    ["currentBuyConnectionAuthorized", "HISTORICAL_REPORT_BUY_AUTHORITY_INVALID"],
    ["lineConnectionAuthorized", "HISTORICAL_REPORT_LINE_AUTHORITY_INVALID"],
    ["publicPublishAuthorized", "HISTORICAL_REPORT_PUBLIC_AUTHORITY_INVALID"],
    ["automatedBettingAuthorized", "HISTORICAL_REPORT_AUTOMATED_BETTING_AUTHORITY_INVALID"],
  ] as const;
  for (const [field, blocker] of cases) {
    withRoot((root) => {
      writeArtifact(root, { historicalAuthority: { [field]: true } });
      const read = readN2HistoricalTestArtifact(root);
      assert.equal(read.artifact, null);
      assert.ok(read.blockers.includes(blocker), `${field} must fail closed at artifact ingestion`);
    });
  }
});

test("confounder artifact ingestion rejects missing historical production authority fields", () => {
  const cases: Array<[ProductionAuthorityField, string]> = [
    ["automaticPromotionAuthorized", "HISTORICAL_REPORT_PROMOTION_AUTHORITY_INVALID"],
    ["currentBuyConnectionAuthorized", "HISTORICAL_REPORT_BUY_AUTHORITY_INVALID"],
    ["lineConnectionAuthorized", "HISTORICAL_REPORT_LINE_AUTHORITY_INVALID"],
    ["publicPublishAuthorized", "HISTORICAL_REPORT_PUBLIC_AUTHORITY_INVALID"],
    ["automatedBettingAuthorized", "HISTORICAL_REPORT_AUTOMATED_BETTING_AUTHORITY_INVALID"],
    ["productionApplyAuthorized", "HISTORICAL_REPORT_PRODUCTION_AUTHORITY_INVALID"],
  ];
  for (const [field, blocker] of cases) {
    withRoot((root) => {
      writeArtifact(root, { historicalAuthorityOmit: field });
      const read = readN2HistoricalTestArtifact(root);
      assert.equal(read.artifact, null);
      assert.ok(read.blockers.includes(blocker), `${field} omission must fail closed at artifact ingestion`);
    });
  }
});

test("confounder artifact ingestion rejects widened confirmation production authorities", () => {
  for (const field of [
    "currentBuyConnectionAuthorized",
    "lineConnectionAuthorized",
    "publicPublishAuthorized",
    "automatedBettingAuthorized",
    "productionApplyAuthorized",
  ] as const) {
    withRoot((root) => {
      writeArtifact(root, { confirmationAuthority: { [field]: true } });
      const read = readN2HistoricalTestArtifact(root);
      assert.equal(read.artifact, null);
      assert.ok(read.blockers.includes("CONFIRMATION_PRODUCTION_AUTHORITY_INVALID"), `${field} must fail closed at confirmation ingestion`);
    });
  }
});

test("confounder artifact ingestion rejects widened distribution production authorities", () => {
  for (const field of [
    "currentBuyConnectionAuthorized",
    "lineConnectionAuthorized",
    "publicPublishAuthorized",
    "automatedBettingAuthorized",
    "productionApplyAuthorized",
  ] as const) {
    withRoot((root) => {
      writeArtifact(root, { distributionAuthority: { [field]: true } });
      const read = readN2HistoricalTestArtifact(root);
      assert.equal(read.artifact, null);
      assert.ok(read.blockers.includes("DISTRIBUTION_EVIDENCE_AUTHORITY_INVALID"), `${field} must fail closed at distribution ingestion`);
    });
  }
});

test("canonical read-only authority remains accepted", () => {
  withRoot((root) => {
    writeArtifact(root, {});
    const read = readN2HistoricalTestArtifact(root);
    assert.notEqual(read.artifact, null);
    assert.deepEqual(read.blockers, []);
  });
});