import assert from "node:assert/strict";
import test from "node:test";
import { buildN2FeatureDatasetRows } from "./n2FeatureDatasetBuilder";
import { adaptLiveOddsRows, adaptOfficialProgramFeatures, type OddsTimeseriesSourceRow } from "./n2FeatureSourceAdapter";
import { verifyN2FeatureLineage, type N2FeatureLineageEvidenceRow } from "./n2FeatureLineage";

const PROGRAM_RAW = JSON.stringify({ boats: [{
  course: 1,
  registrationNo: "1234",
  className: "A1",
  nationalWinRate: 7.1,
  nationalTop2Rate: 55.2,
  localWinRate: 6.8,
  localTop2Rate: 50.1,
  motorTop2Rate: 40.2,
  boatTop2Rate: 38.4,
}] });

function verifiedLineage(observationType: string, sourceObservedAt = "2026-05-20T03:59:00.000Z") {
  const row: N2FeatureLineageEvidenceRow = {
    observationId: `obs-${observationType}`, canonicalRaceKey: "2026-05-20:01:01", observationType,
    observationRawDocumentId: `raw-${observationType}`, sourcePublishedAt: "2026-05-20T03:58:00.000Z",
    sourceObservedAt, firstSeenAt: new Date(Date.parse(sourceObservedAt) + 1_000).toISOString(),
    timingQuality: "source_exact", sourceQuality: "official_public", parseRawDocumentId: `raw-${observationType}`,
    parseStatus: "success", rawDocumentId: `raw-${observationType}`, integrityStatus: "verified",
    securityScanStatus: "passed", parserReplayEligible: 1,
  };
  const result = verifyN2FeatureLineage({
    canonicalRaceKey: row.canonicalRaceKey, observationId: row.observationId,
    rawDocumentId: row.rawDocumentId, allowedObservationTypes: [observationType],
  }, row);
  if (result.status !== "verified") throw new Error(result.reason);
  return result.lineage;
}

test("program adapter: imported_at is never substituted for unknown source availability", () => {
  const result = adaptOfficialProgramFeatures({
    raceId: "race-1", rawJson: PROGRAM_RAW, sourceFile: "program.json", importedAt: "2026-05-20T04:00:00.000Z",
    lineage: null,
  });
  assert.deepEqual(result, { status: "excluded", reason: "excluded_unverified_program_lineage" });
});

test("program adapter: timezone-less imported_at is rejected", () => {
  const result = adaptOfficialProgramFeatures({
    raceId: "race-1", rawJson: PROGRAM_RAW, sourceFile: "program.json", importedAt: "2026-05-20T04:00:00",
    lineage: verifiedLineage("official_program"),
  });
  assert.deepEqual(result, { status: "excluded", reason: "excluded_invalid_program_imported_at" });
});

test("program adapter: explicit timezone offset remains valid", () => {
  const result = adaptOfficialProgramFeatures({
    raceId: "race-1", rawJson: PROGRAM_RAW, sourceFile: "program.json", importedAt: "2026-05-20T13:00:00+09:00",
    lineage: verifiedLineage("official_program"),
  });
  assert.equal(result.status, "adapted");
});

test("program adapter: source availability is emitted as canonical UTC", () => {
  const result = adaptOfficialProgramFeatures({
    raceId: "race-1", rawJson: PROGRAM_RAW, sourceFile: "program.json", importedAt: "2026-05-20T13:00:00+09:00",
    lineage: {
      ...verifiedLineage("official_program"),
      sourceAvailableAt: "2026-05-20T12:58:00+09:00",
    },
  });
  assert.equal(result.status, "adapted");
  if (result.status !== "adapted") return;
  assert.equal(result.value.every((feature) => feature.availableAt === "2026-05-20T03:58:00.000Z"), true);
});

test("program adapter: trusted lineage emits only raw historical-safe feature observations", () => {
  const result = adaptOfficialProgramFeatures({
    raceId: "race-1", rawJson: PROGRAM_RAW, sourceFile: "program.json", importedAt: "2026-05-20T04:00:00.000Z",
    lineage: verifiedLineage("official_program"),
  });
  assert.equal(result.status, "adapted");
  if (result.status !== "adapted") return;
  assert.equal(result.value.length, 7);
  assert.equal(result.value.every((feature) => feature.pitClass === "historical_safe"), true);
  assert.equal(result.value.some((feature) => feature.featureKey.endsWith("courseAvgSt")), false);
});

test("program adapter: source availability after import is inconsistent", () => {
  const result = adaptOfficialProgramFeatures({
    raceId: "race-1", rawJson: PROGRAM_RAW, sourceFile: "program.json", importedAt: "2026-05-20T04:00:00.000Z",
    lineage: { ...verifiedLineage("official_program"), sourceAvailableAt: "2026-05-20T04:00:00.001Z" },
  });
  assert.equal(result.status, "excluded");
  if (result.status === "excluded") assert.equal(result.reason, "excluded_program_available_after_import");
});

function odds(over: Partial<OddsTimeseriesSourceRow> = {}): OddsTimeseriesSourceRow {
  const capturedAt = over.capturedAt ?? "2026-05-20T04:59:00.000Z";
  const lineage = Object.prototype.hasOwnProperty.call(over, "lineage")
    ? over.lineage ?? null
    : verifiedLineage("trifecta_market", capturedAt);
  return {
    id: 1, raceId: "race-1", betType: "exacta", betSelection: "1-2", odds: 5.2,
    capturedAt, source: "official", lineage, ...over,
  };
}

test("odds adapter: legacy row without bet_type is not inferred for exacta", () => {
  const result = adaptLiveOddsRows({ rows: [odds({ betType: null })], expectedBetType: "exacta" });
  assert.deepEqual(result, { status: "excluded", reason: "excluded_unknown_odds_bet_type" });
});

test("odds adapter: verified raw lineage is mandatory", () => {
  const result = adaptLiveOddsRows({ rows: [odds({ lineage: null })], expectedBetType: "exacta" });
  assert.deepEqual(result, { status: "excluded", reason: "excluded_unverified_odds_lineage" });
});

test("odds adapter: timezone-less captured_at is rejected", () => {
  const result = adaptLiveOddsRows({ rows: [odds({
    capturedAt: "2026-05-20T04:59:00",
    lineage: verifiedLineage("trifecta_market", "2026-05-20T04:59:00.000Z"),
  })], expectedBetType: "exacta" });
  assert.deepEqual(result, { status: "excluded", reason: "excluded_invalid_odds_captured_at" });
});

test("odds adapter: captured_at must identify the same F0 observation instant", () => {
  const result = adaptLiveOddsRows({ rows: [odds({
    lineage: verifiedLineage("trifecta_market", "2026-05-20T04:58:59.000Z"),
  })], expectedBetType: "exacta" });
  assert.deepEqual(result, { status: "excluded", reason: "excluded_odds_capture_lineage_mismatch" });
});

test("odds adapter: equivalent offset instants emit the same canonical observation times", () => {
  const canonicalLineage = verifiedLineage("trifecta_market", "2026-05-20T04:59:00.000Z");
  const zulu = adaptLiveOddsRows({ rows: [odds({
    capturedAt: "2026-05-20T04:59:00.000Z",
    lineage: canonicalLineage,
  })], expectedBetType: "exacta" });
  const offset = adaptLiveOddsRows({ rows: [odds({
    capturedAt: "2026-05-20T13:59:00+09:00",
    lineage: {
      ...canonicalLineage,
      sourceObservedAt: "2026-05-20T13:59:00+09:00",
      sourceAvailableAt: "2026-05-20T12:58:00+09:00",
    },
  })], expectedBetType: "exacta" });
  assert.equal(zulu.status, "adapted");
  assert.equal(offset.status, "adapted");
  if (zulu.status !== "adapted" || offset.status !== "adapted") return;
  assert.equal(offset.value[0].capturedAt, "2026-05-20T04:59:00.000Z");
  assert.equal(offset.value[0].availableAt, "2026-05-20T03:58:00.000Z");
  assert.deepEqual(offset.value, zulu.value);
});

test("adapter + builder: verified future odds still fail PIT", () => {
  const adapted = adaptLiveOddsRows({ rows: [odds({ capturedAt: "2026-05-20T05:00:00.001Z" })], expectedBetType: "exacta" });
  assert.equal(adapted.status, "adapted");
  if (adapted.status !== "adapted") return;
  const built = buildN2FeatureDatasetRows({
    canonicalRaceKey: "2026-05-20:01:01", betType: "exacta", decisionCutoff: "2026-05-20T05:00:00.000Z",
    mode: "historical", eligibility: { eligible: true, reason: "eligible" },
    winningSelections: ["1-2"], payoutYenBySelection: { "1-2": 500 },
    features: [], odds: adapted.value, requireOdds: false,
  });
  assert.equal(built.status, "excluded");
  assert.equal(built.exclusions[0].reason, "excluded_odds_capture_after_cutoff");
});
