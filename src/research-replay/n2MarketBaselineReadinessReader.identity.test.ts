import assert from "node:assert/strict";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalHash } from "./canonical";
import { buildBoatRaceOfficialSourceUrl } from "./n2ExternalSourceCaptureContract";
import { readN2MarketBaselineReadiness } from "./n2MarketBaselineReadinessReader";

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-market-readiness-identity-"));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeAcceptedT5(root: string): void {
  const date = "2026-08-07";
  const venue = "10";
  const raceNo = 1;
  const raceDir = "01";
  const raceIdentity = "20260807-10-01";
  const relativeDirectory = `data/raw/research/trifecta-market/${date}/${venue}/${raceDir}/T-5`;
  const directory = join(root, relativeDirectory);
  const rawRelativePath = `${relativeDirectory}/capture.html`;
  const envelopeRelativePath = `${relativeDirectory}/capture.envelope.json`;
  const manifestDigest = "c".repeat(64);
  const decisionCutoff = `${date}T03:30:00.000Z`;
  const targetCaptureAt = new Date(Date.parse(decisionCutoff) - 5 * 60_000).toISOString();
  const sourceUrl = buildBoatRaceOfficialSourceUrl(
    "boatrace_official_trifecta_odds_html",
    { date: date.replaceAll("-", ""), venueCode: venue, raceNo },
  );
  const checkpointKey = canonicalHash({
    manifestDigest,
    raceIdentity,
    checkpointLabel: "T-5",
    targetCaptureAt,
    sourceUrl,
  });

  mkdirSync(directory, { recursive: true });
  writeFileSync(join(root, rawRelativePath), "private raw fixture\n", "utf8");
  writeFileSync(join(root, envelopeRelativePath), `${JSON.stringify({
    envelopeVersion: "n2-trifecta-private-capture-envelope-v1",
    status: "PASS",
    blockers: [],
    manifestDigest,
    checkpointKey,
    entry: {
      raceIdentity,
      checkpointLabel: "T-5",
      decisionCutoff,
    },
    response: { fetchedAt: `${date}T03:25:30.000Z` },
    sourceDisplayedUpdate: { availableAt: `${date}T03:24:00.000Z` },
    databaseWriteAuthorized: false,
    currentBuyConnectionAuthorized: false,
    lineConnectionAuthorized: false,
    publicPublishAuthorized: false,
    productionApplyExecuted: false,
  }, null, 2)}\n`, "utf8");
  writeFileSync(join(directory, "accepted.json"), `${JSON.stringify({
    markerVersion: "n2-trifecta-private-capture-accepted-v1",
    manifestDigest,
    checkpointKey,
    raceIdentity,
    checkpointLabel: "T-5",
    rawDocumentId: "raw-2026-08-07-10-01",
    rawSha256: "b".repeat(64),
    rawRelativePath,
    envelopeRelativePath,
    acceptedAt: `${date}T03:00:00.000Z`,
    databaseWriteAuthorized: false,
    productionApplyExecuted: false,
  }, null, 2)}\n`, "utf8");
}

function assertIdentityBlocked(root: string, sidecarDbPath: string): void {
  const result = readN2MarketBaselineReadiness({ dataRoot: root, sidecarDbPath });
  assert.deepEqual(result.acceptedT5RaceKeys, ["2026-08-07:10:R1"]);
  assert.deepEqual(result.settledRaceKeys, []);
  assert.deepEqual(result.sourceBlockers, ["SIDECAR_IDENTITY_INVALID"]);
  assert.equal(result.databaseReadCount, 0);
  assert.equal(result.databaseWriteCount, 0);
  assert.equal(result.rawOddsValuesRead, false);
}

test("market readiness rejects a sidecar leaf symlink before SQLite open", () => {
  withRoot((root) => {
    writeAcceptedT5(root);
    const target = join(root, "target.sqlite");
    const sidecar = join(root, "sidecar.sqlite");
    writeFileSync(target, "not-sqlite");
    symlinkSync(target, sidecar);
    assertIdentityBlocked(root, sidecar);
  });
});

test("market readiness rejects a sidecar ancestor alias before SQLite open", () => {
  withRoot((root) => {
    writeAcceptedT5(root);
    const realDir = join(root, "real");
    const aliasDir = join(root, "alias");
    mkdirSync(realDir);
    symlinkSync(realDir, aliasDir, "dir");
    const sidecar = join(aliasDir, "sidecar.sqlite");
    writeFileSync(join(realDir, "sidecar.sqlite"), "not-sqlite");
    assertIdentityBlocked(root, sidecar);
  });
});

test("market readiness rejects a hardlinked sidecar before SQLite open", () => {
  withRoot((root) => {
    writeAcceptedT5(root);
    const target = join(root, "target.sqlite");
    const sidecar = join(root, "sidecar.sqlite");
    writeFileSync(target, "not-sqlite");
    linkSync(target, sidecar);
    assertIdentityBlocked(root, sidecar);
  });
});
