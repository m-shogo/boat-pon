import assert from "node:assert/strict";
import test from "node:test";
import type {
  ParsedResultDetail,
  RaceCondition,
  RacePayout,
} from "../domain/officialResultDetailParser";
import type { SettlementBetType } from "./settlement";
import {
  candidateKey,
  classifyPair,
  deriveArchiveCandidates,
  isFalseRefundDirection,
  venueCodeFromKey,
  venueNameFromCode,
  yearFromKey,
  type ArchiveCandidate,
  type CanonicalCandidate,
} from "./n2ArchiveCanonicalReconcile";

const DATE = "2020-05-01";
const VENUE = "住之江"; // VENUE_CODES → "12"
const RACE_ID = "20200501-住之江-01";

function condition(overrides: Partial<RaceCondition> = {}): RaceCondition {
  return {
    raceId: RACE_ID, date: DATE, venue: VENUE, raceNo: 1,
    raceType: null, distanceM: null, weather: null, windDir: null, windMps: null, waveCm: null,
    kimarite: null, returned: false, source: "test", fetchedAt: "1970-01-01T00:00:00.000Z",
    ...overrides,
  };
}
function payout(betType: SettlementBetType, combination: string, overrides: Partial<RacePayout> = {}): RacePayout {
  return {
    raceId: RACE_ID, date: DATE, venue: VENUE, raceNo: 1,
    betType, combination, payoutYen: 1000, popularity: 1,
    returned: false, source: "test", fetchedAt: "1970-01-01T00:00:00.000Z",
    ...overrides,
  };
}
function parsed(conditions: RaceCondition[], payouts: RacePayout[]): ParsedResultDetail {
  return { conditions, entries: [], payouts } as ParsedResultDetail;
}

test("normal payout → settled/normal candidate with canonical race key", () => {
  const out = deriveArchiveCandidates(parsed([condition()], [payout("trifecta", "1-2-3")]));
  assert.equal(out.length, 1);
  const c = out[0];
  assert.equal(c.raceKey, "2020-05-01:12:R1");
  assert.equal(c.betType, "trifecta");
  assert.equal(c.status, "settled");
  assert.equal(c.resultKind, "normal");
  assert.equal(c.payoutLineCount, 1);
  assert.equal(c.refundLineCount, 0);
  assert.equal(c.payoutYenTotal, 1000);
});

test("full refund → refunded candidate", () => {
  const out = deriveArchiveCandidates(parsed(
    [condition()],
    [payout("exacta", "", { returned: true, payoutYen: null })],
  ));
  assert.equal(out.length, 1);
  assert.equal(out[0].status, "refunded");
  assert.equal(out[0].refundLineCount, 1);
  assert.equal(out[0].payoutLineCount, 0);
});

test("partial refund → partially_refunded candidate", () => {
  const out = deriveArchiveCandidates(parsed(
    [condition()],
    [
      payout("quinella", "1-2", { payoutYen: 800 }),
      payout("quinella", "3-4", { returned: true, payoutYen: null }),
    ],
  ));
  assert.equal(out.length, 1);
  assert.equal(out[0].status, "partially_refunded");
  assert.equal(out[0].payoutLineCount, 1);
  assert.equal(out[0].refundLineCount, 1);
});

test("special payout (invalid selection with payout) → settled/special_payout", () => {
  const out = deriveArchiveCandidates(parsed(
    [condition()],
    [payout("win", "特", { payoutYen: 70 })],
  ));
  assert.equal(out.length, 1);
  assert.equal(out[0].status, "settled");
  assert.equal(out[0].resultKind, "special_payout");
  assert.equal(out[0].specialPayoutLineCount, 1);
});

test("unknown venue and out-of-range raceNo are excluded (fail-closed)", () => {
  const unknownVenue = deriveArchiveCandidates(parsed(
    [condition({ raceId: "x", venue: "存在しない場" })],
    [payout("trifecta", "1-2-3", { raceId: "x", venue: "存在しない場" })],
  ));
  assert.equal(unknownVenue.length, 0);
  const badRaceNo = deriveArchiveCandidates(parsed(
    [condition({ raceId: "y", raceNo: 13 })],
    [payout("trifecta", "1-2-3", { raceId: "y", raceNo: 13 })],
  ));
  assert.equal(badRaceNo.length, 0);
});

test("payout without a matching condition race is excluded", () => {
  const out = deriveArchiveCandidates(parsed([], [payout("trifecta", "1-2-3")]));
  assert.equal(out.length, 0);
});

test("derivation is deterministic and sorted", () => {
  const input = parsed(
    [condition()],
    [payout("wide", "1-2"), payout("trifecta", "1-2-3"), payout("exacta", "1-2")],
  );
  const a = deriveArchiveCandidates(input);
  const b = deriveArchiveCandidates(input);
  assert.deepEqual(a, b);
  const bets = a.map((c) => c.betType);
  assert.deepEqual(bets, [...bets].sort());
});

function arch(status: ArchiveCandidate["status"], resultKind: ArchiveCandidate["resultKind"]): ArchiveCandidate {
  return {
    raceKey: "2020-05-01:12:R1", betType: "trifecta", status, resultKind,
    payoutLineCount: 1, refundLineCount: 0, specialPayoutLineCount: resultKind === "special_payout" ? 1 : 0,
    payoutYenTotal: 1000,
  };
}
function canon(status: CanonicalCandidate["status"], resultKind: CanonicalCandidate["resultKind"]): CanonicalCandidate {
  return { raceKey: "2020-05-01:12:R1", betType: "trifecta", status, resultKind };
}

test("classifyPair covers all pair classes", () => {
  assert.equal(classifyPair(arch("settled", "normal"), canon("settled", "normal")), "exact_match");
  assert.equal(classifyPair(arch("settled", "normal"), canon("refunded", "normal")), "status_mismatch");
  assert.equal(classifyPair(arch("settled", "special_payout"), canon("settled", "normal")), "result_kind_mismatch");
  assert.equal(classifyPair(arch("settled", "normal"), null), "archive_only");
  assert.equal(classifyPair(null, canon("settled", "normal")), "canonical_only");
});

test("isFalseRefundDirection: canonical refund vs archive settled", () => {
  assert.equal(isFalseRefundDirection(arch("settled", "normal"), canon("refunded", "normal")), true);
  assert.equal(isFalseRefundDirection(arch("settled", "normal"), canon("partially_refunded", "normal")), true);
  assert.equal(isFalseRefundDirection(arch("refunded", "normal"), canon("refunded", "normal")), false);
  assert.equal(isFalseRefundDirection(arch("settled", "normal"), canon("settled", "normal")), false);
});

test("identity helpers", () => {
  assert.equal(yearFromKey("2020-05-01:12:R1"), "2020");
  assert.equal(venueCodeFromKey("2020-05-01:12:R1"), "12");
  assert.equal(venueNameFromCode("12"), "住之江");
  assert.equal(venueNameFromCode("99"), "99");
  assert.equal(candidateKey("2020-05-01:12:R1", "trifecta"), "2020-05-01:12:R1\u0000trifecta");
});
