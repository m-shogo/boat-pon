import assert from "node:assert/strict";
import test from "node:test";

import {
  N2_EXTERNAL_SOURCE_CATALOG,
  auditN2CaptureProposal,
  buildBoatRaceOfficialSourceUrl,
  summarizeN2ExternalSourceReadiness,
  type N2CaptureProposal,
} from "./n2ExternalSourceCaptureContract.js";

const baseProposal: N2CaptureProposal = {
  sourceId: "boatrace_official_trifecta_odds_html",
  sourceUrl:
    "https://www.boatrace.jp/owpc/pc/race/odds3t?hd=20260806&jcd=05&rno=12",
  canonicalRaceId: "20260806-05-R12",
  checkpointLabel: "T-10",
  fetchedAt: "2026-08-06T08:50:00.000Z",
  availableAt: "2026-08-06T08:49:00.000Z",
  availabilityBasis: "source_displayed_at",
  decisionCutoff: "2026-08-06T09:00:00.000Z",
  contentType: "text/html; charset=UTF-8",
  rawByteLength: 12345,
  rawSha256: "a".repeat(64),
  parserVersion: "boatrace-odds3t-v1",
  termsReviewApproved: true,
  boundedCaptureApprovalId: "APPROVAL-REVIEW-ONLY-001",
  requestedMode: "review",
};

test("source catalog fixes official priority and never authorizes production", () => {
  assert.deepEqual(
    N2_EXTERNAL_SOURCE_CATALOG.map((source) => source.sourceId),
    [
      "boatrace_official_trifecta_odds_html",
      "boatrace_official_beforeinfo_html",
      "jma_historical_station_csv",
    ],
  );
  for (const source of N2_EXTERNAL_SOURCE_CATALOG) {
    assert.equal(source.authority, "official");
    assert.equal(source.productionCaptureAuthorized, false);
    assert.equal(source.productionWriteAuthorized, false);
  }
  assert.equal(N2_EXTERNAL_SOURCE_CATALOG[0]?.role, "trifecta_market");
  assert.equal(N2_EXTERNAL_SOURCE_CATALOG[2]?.realTimeDecisionEligible, false);
});

test("official URL builder fixes date, venue and race identity", () => {
  assert.equal(
    buildBoatRaceOfficialSourceUrl("boatrace_official_trifecta_odds_html", {
      date: "20260806",
      venueCode: "05",
      raceNo: 12,
    }),
    "https://www.boatrace.jp/owpc/pc/race/odds3t?hd=20260806&jcd=05&rno=12",
  );
  assert.equal(
    buildBoatRaceOfficialSourceUrl("boatrace_official_beforeinfo_html", {
      date: "20260806",
      venueCode: "24",
      raceNo: 1,
    }),
    "https://www.boatrace.jp/owpc/pc/race/beforeinfo?hd=20260806&jcd=24&rno=1",
  );
  assert.throws(
    () =>
      buildBoatRaceOfficialSourceUrl("boatrace_official_trifecta_odds_html", {
        date: "2026-08-06",
        venueCode: "05",
        raceNo: 12,
      }),
    /INVALID_RACE_DATE/,
  );
  assert.throws(
    () =>
      buildBoatRaceOfficialSourceUrl("boatrace_official_beforeinfo_html", {
        date: "20260806",
        venueCode: "25",
        raceNo: 1,
      }),
    /INVALID_VENUE_CODE/,
  );
  assert.throws(
    () =>
      buildBoatRaceOfficialSourceUrl("boatrace_official_beforeinfo_html", {
        date: "20260806",
        venueCode: "05",
        raceNo: 13,
      }),
    /INVALID_RACE_NO/,
  );
});

test("review-only odds proposal passes structural and atomic PIT checks", () => {
  const result = auditN2CaptureProposal(baseProposal);
  assert.equal(result.status, "STRUCTURALLY_READY_FOR_BOUNDED_REVIEW");
  assert.equal(result.pitVerified, true);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.productionCaptureAuthorized, false);
  assert.equal(result.productionWriteAuthorized, false);
});

test("production mode remains blocked even with terms and bounded review approval", () => {
  const result = auditN2CaptureProposal({
    ...baseProposal,
    requestedMode: "production",
  });
  assert.equal(result.status, "INVENTORY_ONLY");
  assert.deepEqual(result.blockers, ["PRODUCTION_CAPTURE_NOT_AUTHORIZED"]);
  assert.equal(result.productionCaptureAuthorized, false);
});

test("odds require displayed update time and reject post-cutoff capture", () => {
  const result = auditN2CaptureProposal({
    ...baseProposal,
    availabilityBasis: "monotonic_first_seen_at",
    fetchedAt: "2026-08-06T09:00:01.000Z",
  });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.pitVerified, false);
  assert.ok(result.blockers.includes("CAPTURE_AFTER_DECISION_CUTOFF"));
  assert.ok(result.blockers.includes("ODDS_DISPLAYED_UPDATE_TIME_REQUIRED"));
});

test("beforeinfo accepts monotonic first-seen evidence but still needs review gates", () => {
  const result = auditN2CaptureProposal({
    ...baseProposal,
    sourceId: "boatrace_official_beforeinfo_html",
    sourceUrl:
      "https://www.boatrace.jp/owpc/pc/race/beforeinfo?hd=20260806&jcd=05&rno=12",
    parserVersion: "boatrace-beforeinfo-v1",
    availabilityBasis: "monotonic_first_seen_at",
    termsReviewApproved: false,
    boundedCaptureApprovalId: null,
  });
  assert.equal(result.status, "INVENTORY_ONLY");
  assert.equal(result.pitVerified, true);
  assert.deepEqual(result.blockers, [
    "TERMS_REVIEW_NOT_APPROVED",
    "BOUNDED_CAPTURE_APPROVAL_REQUIRED",
  ]);
});

test("JMA source is historical validation only and never a live production input", () => {
  const result = auditN2CaptureProposal({
    ...baseProposal,
    sourceId: "jma_historical_station_csv",
    sourceUrl: "https://www.data.jma.go.jp/risk/obsdl/",
    canonicalRaceId: null,
    checkpointLabel: "HISTORICAL-DAY",
    availabilityBasis: "historical_observation_time",
    decisionCutoff: null,
    contentType: "text/csv; charset=Shift_JIS",
    parserVersion: "jma-station-csv-v1",
    requestedMode: "production",
  });
  assert.equal(result.status, "INVENTORY_ONLY");
  assert.ok(result.blockers.includes("JMA_NOT_REALTIME_DECISION_SOURCE"));
  assert.ok(result.blockers.includes("PRODUCTION_CAPTURE_NOT_AUTHORIZED"));
  assert.equal(result.productionWriteAuthorized, false);
});

test("global readiness stays contract-only with explicit blockers", () => {
  assert.deepEqual(summarizeN2ExternalSourceReadiness(), {
    status: "CONTRACT_ONLY_NOT_AUTHORIZED",
    priorityOrder: [
      "boatrace_official_trifecta_odds_html",
      "boatrace_official_beforeinfo_html",
      "jma_historical_station_csv",
    ],
    productionCaptureAuthorized: false,
    productionWriteAuthorized: false,
    approvalCreated: false,
    productionApplyExecuted: false,
    blockers: [
      "BOATRACE_TERMS_REVIEW_REQUIRED",
      "BOUNDED_SOURCE_SPECIFIC_APPROVAL_MISSING",
      "RAW_CAPTURE_EXECUTOR_NOT_IMPLEMENTED",
      "PRODUCTION_WRITER_NOT_AUTHORIZED",
    ],
  });
});
