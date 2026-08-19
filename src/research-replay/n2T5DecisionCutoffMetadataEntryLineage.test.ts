import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalHash } from "./canonical";
import { buildBoatRaceOfficialSourceUrl } from "./n2ExternalSourceCaptureContract";
import { readN2T5DecisionCutoffMetadata } from "./n2T5DecisionCutoffMetadata";

const raceKey = "2026-08-07:05:R1";
const raceIdentity = "20260807-05-01";
const manifestDigest = "a".repeat(64);
const decisionCutoff = "2026-08-07T03:30:00.000Z";
const targetCaptureAt = "2026-08-07T03:25:00.000Z";
const sourceUrl = buildBoatRaceOfficialSourceUrl(
  "boatrace_official_trifecta_odds_html",
  { date: "20260807", venueCode: "05", raceNo: 1 },
);
const checkpointKey = canonicalHash({
  manifestDigest,
  raceIdentity,
  checkpointLabel: "T-5",
  targetCaptureAt,
  sourceUrl,
});

function withFixture(
  mutateEntry: (entry: Record<string, unknown>) => void,
  run: (root: string) => void,
): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-t5-entry-lineage-"));
  try {
    const relativeDir = "data/raw/research/trifecta-market/2026-08-07/05/01/T-5";
    const dir = join(root, relativeDir);
    const envelopeRelativePath = `${relativeDir}/fixture.envelope.json`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "accepted.json"), `${JSON.stringify({
      markerVersion: "n2-trifecta-private-capture-accepted-v1",
      manifestDigest,
      checkpointKey,
      raceIdentity,
      checkpointLabel: "T-5",
      envelopeRelativePath,
      acceptedAt: "2026-08-07T03:25:30.000Z",
      databaseWriteAuthorized: false,
      productionApplyExecuted: false,
    }, null, 2)}\n`, "utf8");
    const entry: Record<string, unknown> = {
      date: "2026-08-07",
      venueCode: "05",
      raceNo: 1,
      raceIdentity,
      checkpointLabel: "T-5",
      targetCaptureAt,
      decisionCutoff,
      sourceUrl,
    };
    mutateEntry(entry);
    writeFileSync(join(root, envelopeRelativePath), `${JSON.stringify({
      envelopeVersion: "n2-trifecta-private-capture-envelope-v1",
      status: "PASS",
      blockers: [],
      manifestDigest,
      checkpointKey,
      entry,
      response: { fetchedAt: "2026-08-07T03:25:30.000Z" },
      sourceDisplayedUpdate: { availableAt: "2026-08-07T03:24:00.000Z" },
      databaseWriteAuthorized: false,
      currentBuyConnectionAuthorized: false,
      lineConnectionAuthorized: false,
      publicPublishAuthorized: false,
      productionApplyExecuted: false,
    }, null, 2)}\n`, "utf8");
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("T-5 metadata reader accepts producer-consistent envelope entry lineage", () => {
  withFixture(() => {}, (root) => {
    const result = readN2T5DecisionCutoffMetadata({ dataRoot: root, raceKeys: [raceKey] });
    assert.equal(result.status, "PASS");
    assert.deepEqual(result.blockers, []);
    assert.equal(result.decisionCutoffByRaceKey[raceKey], decisionCutoff);
    assert.equal(result.privateEnvelopeMetadataReadCount, 1);
    assert.equal(result.rawOddsValuesRead, false);
  });
});

test("T-5 metadata reader rejects envelope target capture drift before raw odds access", () => {
  withFixture((entry) => {
    entry.targetCaptureAt = "2026-08-07T03:24:59.000Z";
  }, (root) => {
    const result = readN2T5DecisionCutoffMetadata({ dataRoot: root, raceKeys: [raceKey] });
    assert.equal(result.status, "BLOCKED");
    assert.ok(result.blockers.includes(`${raceKey}:ENVELOPE_TARGET_CAPTURE_AT_INVALID`));
    assert.deepEqual(result.decisionCutoffByRaceKey, {});
    assert.equal(result.rawOddsValuesRead, false);
  });
});

test("T-5 metadata reader rejects envelope source URL drift before raw odds access", () => {
  withFixture((entry) => {
    entry.sourceUrl = "https://www.boatrace.jp/owpc/pc/race/odds3t?rno=2&jcd=05&hd=20260807";
  }, (root) => {
    const result = readN2T5DecisionCutoffMetadata({ dataRoot: root, raceKeys: [raceKey] });
    assert.equal(result.status, "BLOCKED");
    assert.ok(result.blockers.includes(`${raceKey}:ENVELOPE_SOURCE_URL_INVALID`));
    assert.deepEqual(result.decisionCutoffByRaceKey, {});
    assert.equal(result.rawOddsValuesRead, false);
  });
});
