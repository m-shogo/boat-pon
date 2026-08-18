import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import type { N2TrifectaMarketRaceFeatureSequence } from "./n2TrifectaMarketFeatureEngineering.js";
import type { N2TrifectaPrivateMarketFeatureLoadReport } from "./n2TrifectaPrivateMarketFeatureLoader.js";
import {
  N2_TRIFECTA_PRIVATE_MARKET_FEATURE_ARTIFACT_VERSION,
  privateMarketFeatureArtifactRelativePath,
  writeN2TrifectaPrivateMarketFeatureArtifact,
} from "./n2TrifectaPrivateMarketFeatureArtifact.js";

function sequence(status: "PASS" | "PARTIAL"): N2TrifectaMarketRaceFeatureSequence {
  return {
    status,
    availableCheckpoints: status === "PASS" ? ["T-30", "T-20", "T-10", "T-5"] : ["T-30", "T-20"],
    missingCheckpoints: status === "PASS" ? [] : ["T-10", "T-5"],
    snapshots: [],
    transitions: [],
  } as unknown as N2TrifectaMarketRaceFeatureSequence;
}

function report(input: {
  status: "PASS" | "PARTIAL" | "NO_DATA" | "BLOCKED";
  digest: string;
}): N2TrifectaPrivateMarketFeatureLoadReport {
  return {
    loaderVersion: "n2-trifecta-private-market-feature-loader-v1",
    status: input.status,
    blockers: input.status === "BLOCKED" ? ["FIXTURE_BLOCKER"] : [],
    date: "2026-08-07",
    venueCode: "10",
    raceNo: 4,
    raceIdentity: "20260807-10-04",
    acceptedMarkerCount: input.status === "PASS" ? 4 : input.status === "PARTIAL" ? 2 : 0,
    loadedSnapshotCount: input.status === "PASS" ? 4 : input.status === "PARTIAL" ? 2 : 0,
    sequence: sequence(input.status === "PASS" ? "PASS" : "PARTIAL"),
    networkRequestCount: 0,
    databaseReadCount: 0,
    databaseWriteCount: 0,
    rawValuesReadPrivately: input.status === "PASS" || input.status === "PARTIAL",
    rawValuesPublished: false,
    privateResearchOnly: true,
    publicPublishAuthorized: false,
    outputDigest: input.digest,
  };
}

function withRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-market-feature-artifact-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("a later source digest atomically replaces an earlier derived PARTIAL artifact", () => {
  withRoot((root) => {
    const partial = writeN2TrifectaPrivateMarketFeatureArtifact({
      rootDir: root,
      report: report({ status: "PARTIAL", digest: "a".repeat(64) }),
      generatedAt: "2026-08-07T02:00:00.000Z",
    });
    assert.equal(partial.changed, true);
    assert.equal(partial.replacedExisting, false);
    assert.equal(partial.fileMode, 0o600);

    const path = join(root, partial.relativePath);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    const first = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    assert.equal(first.featureArtifactVersion, N2_TRIFECTA_PRIVATE_MARKET_FEATURE_ARTIFACT_VERSION);
    assert.equal(first.status, "PARTIAL");
    assert.equal(first.sourceLoadDigest, "a".repeat(64));
    assert.equal(first.privateResearchOnly, true);
    assert.equal(first.publicPublishAuthorized, false);
    assert.equal(first.databaseWriteAuthorized, false);
    assert.equal(first.currentBuyConnectionAuthorized, false);
    assert.equal(first.lineConnectionAuthorized, false);
    assert.equal(first.automatedBettingAuthorized, false);

    const complete = writeN2TrifectaPrivateMarketFeatureArtifact({
      rootDir: root,
      report: report({ status: "PASS", digest: "b".repeat(64) }),
      generatedAt: "2026-08-07T02:10:00.000Z",
    });
    assert.equal(complete.changed, true);
    assert.equal(complete.replacedExisting, true);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    const second = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    assert.equal(second.status, "PASS");
    assert.equal(second.sourceLoadDigest, "b".repeat(64));
    assert.equal(second.generatedAt, "2026-08-07T02:10:00.000Z");
    assert.notEqual(second.artifactDigest, first.artifactDigest);
  });
});

test("artifact generatedAt rejects normalized timestamps and canonicalizes valid offsets", () => {
  withRoot((root) => {
    const source = report({ status: "PASS", digest: "1".repeat(64) });
    for (const generatedAt of [
      "2026-08-07T24:00:00.000Z",
      "2026-02-30T02:00:00.000Z",
      "2026-08-07T02:00:00",
    ]) {
      assert.throws(
        () => writeN2TrifectaPrivateMarketFeatureArtifact({ rootDir: root, report: source, generatedAt }),
        /PRIVATE_FEATURE_GENERATED_AT_INVALID/u,
        generatedAt,
      );
    }

    const write = writeN2TrifectaPrivateMarketFeatureArtifact({
      rootDir: root,
      report: source,
      generatedAt: "2026-08-07T11:00:00+09:00",
    });
    const value = JSON.parse(readFileSync(join(root, write.relativePath), "utf8")) as Record<string, unknown>;
    assert.equal(value.generatedAt, "2026-08-07T02:00:00.000Z");
  });
});

test("the same valid source digest is idempotent and does not rewrite the derived artifact", () => {
  withRoot((root) => {
    const first = writeN2TrifectaPrivateMarketFeatureArtifact({
      rootDir: root,
      report: report({ status: "PASS", digest: "c".repeat(64) }),
      generatedAt: "2026-08-07T02:00:00.000Z",
    });
    const path = join(root, first.relativePath);
    const before = readFileSync(path, "utf8");
    const second = writeN2TrifectaPrivateMarketFeatureArtifact({
      rootDir: root,
      report: report({ status: "PASS", digest: "c".repeat(64) }),
      generatedAt: "2026-08-07T03:00:00.000Z",
    });
    const after = readFileSync(path, "utf8");
    assert.equal(second.changed, false);
    assert.equal(second.replacedExisting, true);
    assert.equal(after, before);
  });
});

test("the same source digest rebuilds a non-canonical timestamp representation", () => {
  withRoot((root) => {
    const source = report({ status: "PASS", digest: "2".repeat(64) });
    const first = writeN2TrifectaPrivateMarketFeatureArtifact({
      rootDir: root,
      report: source,
      generatedAt: "2026-08-07T02:00:00.000Z",
    });
    const path = join(root, first.relativePath);
    const tampered = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    tampered.generatedAt = "2026-08-07T11:00:00+09:00";
    writeFileSync(path, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");

    const repaired = writeN2TrifectaPrivateMarketFeatureArtifact({
      rootDir: root,
      report: source,
      generatedAt: "2026-08-07T04:00:00.000Z",
    });
    assert.equal(repaired.changed, true);
    assert.equal(repaired.replacedExisting, true);
    const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    assert.equal(value.generatedAt, "2026-08-07T04:00:00.000Z");
  });
});

test("the same source digest rebuilds a tampered or overly permissive derived artifact", () => {
  withRoot((root) => {
    const source = report({ status: "PASS", digest: "d".repeat(64) });
    const first = writeN2TrifectaPrivateMarketFeatureArtifact({
      rootDir: root,
      report: source,
      generatedAt: "2026-08-07T02:00:00.000Z",
    });
    const path = join(root, first.relativePath);
    const tampered = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    tampered.publicPublishAuthorized = true;
    writeFileSync(path, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");
    chmodSync(path, 0o644);

    const repaired = writeN2TrifectaPrivateMarketFeatureArtifact({
      rootDir: root,
      report: source,
      generatedAt: "2026-08-07T02:30:00.000Z",
    });
    assert.equal(repaired.changed, true);
    assert.equal(repaired.replacedExisting, true);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    assert.equal(value.publicPublishAuthorized, false);
    assert.equal(value.generatedAt, "2026-08-07T02:30:00.000Z");
    assert.equal(value.sourceLoadDigest, source.outputDigest);
  });
});

test("writer rejects non-research statuses and unsafe existing targets", () => {
  withRoot((root) => {
    assert.throws(
      () => writeN2TrifectaPrivateMarketFeatureArtifact({
        rootDir: root,
        report: report({ status: "NO_DATA", digest: "e".repeat(64) }),
      }),
      /PRIVATE_FEATURE_ARTIFACT_REQUIRES_PASS_OR_PARTIAL/u,
    );
    assert.throws(
      () => writeN2TrifectaPrivateMarketFeatureArtifact({
        rootDir: root,
        report: report({ status: "BLOCKED", digest: "f".repeat(64) }),
      }),
      /PRIVATE_FEATURE_ARTIFACT_REQUIRES_PASS_OR_PARTIAL/u,
    );

    const relativePath = privateMarketFeatureArtifactRelativePath({
      date: "2026-08-07",
      venueCode: "10",
      raceNo: 4,
    });
    const target = join(root, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    const outside = join(root, "outside.json");
    writeFileSync(outside, "{}\n", "utf8");
    symlinkSync(outside, target);
    assert.throws(
      () => writeN2TrifectaPrivateMarketFeatureArtifact({
        rootDir: root,
        report: report({ status: "PASS", digest: "0".repeat(64) }),
      }),
      /PRIVATE_FEATURE_EXISTING_FILE_TYPE_INVALID/u,
    );
  });
});
