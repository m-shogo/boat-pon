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
  classifyUnexpectedAddition,
  decideReparseAction,
  deriveSettlementCandidates,
  isAppendingAction,
  isSupersedingAction,
  type DerivedCandidate,
  type ExistingActiveCandidate,
} from "./n2SettlementReparse";

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

test("deriveSettlementCandidates: normal payout → settled/normal with payout line", () => {
  const out = deriveSettlementCandidates(parsed([condition()], [payout("trifecta", "1-2-3", { payoutYen: 4200 })]));
  assert.equal(out.length, 1);
  const c = out[0];
  assert.equal(c.raceKey, "2020-05-01:12:R1");
  assert.equal(c.status, "settled");
  assert.equal(c.resultKind, "normal");
  assert.deepEqual(c.payouts, [{ selection: "1-2-3", payoutYen: 4200, popularity: 1, lineKind: "payout" }]);
  assert.equal(c.refunds.length, 0);
});

test("deriveSettlementCandidates: full refund → refunded with refund line only", () => {
  const out = deriveSettlementCandidates(parsed(
    [condition()],
    [payout("exacta", "", { returned: true, payoutYen: null })],
  ));
  assert.equal(out.length, 1);
  assert.equal(out[0].status, "refunded");
  assert.equal(out[0].payouts.length, 0);
  assert.equal(out[0].refunds.length, 1);
  assert.equal(out[0].refunds[0].refundYenPer100, 100);
});

test("deriveSettlementCandidates: partial refund → partially_refunded", () => {
  const out = deriveSettlementCandidates(parsed(
    [condition()],
    [
      payout("quinella", "1-2", { payoutYen: 800 }),
      payout("quinella", "3-4", { returned: true, payoutYen: null }),
    ],
  ));
  assert.equal(out.length, 1);
  assert.equal(out[0].status, "partially_refunded");
  assert.equal(out[0].payouts.length, 1);
  assert.equal(out[0].refunds.length, 1);
});

test("deriveSettlementCandidates: special payout → settled/special_payout line", () => {
  const out = deriveSettlementCandidates(parsed(
    [condition()],
    [payout("win", "特", { payoutYen: 70 })],
  ));
  assert.equal(out.length, 1);
  assert.equal(out[0].status, "settled");
  assert.equal(out[0].resultKind, "special_payout");
  assert.equal(out[0].payouts.length, 1);
  assert.equal(out[0].payouts[0].lineKind, "special_payout");
});

test("deriveSettlementCandidates: unknown venue / out-of-range raceNo excluded", () => {
  assert.equal(deriveSettlementCandidates(parsed(
    [condition({ raceId: "x", venue: "存在しない場" })],
    [payout("trifecta", "1-2-3", { raceId: "x", venue: "存在しない場" })],
  )).length, 0);
  assert.equal(deriveSettlementCandidates(parsed(
    [condition({ raceId: "y", raceNo: 13 })],
    [payout("trifecta", "1-2-3", { raceId: "y", raceNo: 13 })],
  )).length, 0);
});

function v2(status: DerivedCandidate["status"], resultKind: DerivedCandidate["resultKind"]): DerivedCandidate {
  return {
    raceKey: "2020-05-01:12:R1", betType: "trifecta", status, resultKind,
    payouts: status === "settled" ? [{ selection: "1-2-3", payoutYen: 1000, popularity: 1, lineKind: resultKind === "special_payout" ? "special_payout" : "payout" }] : [],
    refunds: status === "refunded" ? [{ selection: null, scope: "bet_type", refundYenPer100: 100, reasonCode: "ARCHIVE_RETURNED" }] : [],
  };
}
function existing(
  status: "settled" | "refunded" | "partially_refunded",
  resultKind: "normal" | "special_payout",
): ExistingActiveCandidate {
  return { candidateId: "c1", status, resultKind, rawDocumentId: "raw1", sourceSchemaVersion: "modern_seven_display" };
}

test("decideReparseAction: exact when status+result_kind match", () => {
  assert.equal(decideReparseAction(existing("settled", "normal"), v2("settled", "normal")), "exact");
});

test("decideReparseAction: false_refund_correction refunded→settled", () => {
  assert.equal(decideReparseAction(existing("refunded", "normal"), v2("settled", "normal")), "false_refund_correction");
  assert.equal(decideReparseAction(existing("partially_refunded", "normal"), v2("settled", "normal")), "false_refund_correction");
});

test("decideReparseAction: result_kind_correction to special_payout", () => {
  assert.equal(decideReparseAction(existing("settled", "normal"), v2("settled", "special_payout")), "result_kind_correction");
});

test("decideReparseAction: special_payout_addition when no existing active", () => {
  assert.equal(decideReparseAction(null, v2("settled", "special_payout")), "special_payout_addition");
});

test("decideReparseAction: unexpected_addition when no existing and not special", () => {
  assert.equal(decideReparseAction(null, v2("settled", "normal")), "unexpected_addition");
});

test("decideReparseAction: ambiguous_non_defect when differs but not the defect", () => {
  // settled(normal) existing vs v2 refunded → not the defect direction → do not correct
  assert.equal(decideReparseAction(existing("settled", "normal"), v2("refunded", "normal")), "ambiguous_non_defect");
});

test("classifyUnexpectedAddition: win-refund omission held out, deterministic", () => {
  // 実データの2件: no v1 candidate, v2 win refunded → distinct v1 win-refund omission (scope外).
  const winRefund = classifyUnexpectedAddition({ betType: "win", v2Status: "refunded", v2ResultKind: "normal", anyCandidateForRaceBet: false, anyActiveForRaceBet: false });
  assert.equal(winRefund.classification, "CONFIRMED_V1_WIN_REFUND_OMISSION");
  assert.equal(winRefund.autoApplyEligible, false);
  // 決定的
  assert.deepEqual(classifyUnexpectedAddition({ betType: "win", v2Status: "refunded", v2ResultKind: "normal", anyCandidateForRaceBet: false, anyActiveForRaceBet: false }), winRefund);
  // no v1 candidate, v2 settled non-special → manual review
  assert.equal(classifyUnexpectedAddition({ betType: "trifecta", v2Status: "settled", v2ResultKind: "normal", anyCandidateForRaceBet: false, anyActiveForRaceBet: false }).classification, "MANUAL_REVIEW_REQUIRED");
  // candidate exists but none active → source duplicate
  assert.equal(classifyUnexpectedAddition({ betType: "exacta", v2Status: "settled", v2ResultKind: "normal", anyCandidateForRaceBet: true, anyActiveForRaceBet: false }).classification, "CONFIRMED_SOURCE_DUPLICATE");
  // active exists yet fell through → manual review
  assert.equal(classifyUnexpectedAddition({ betType: "exacta", v2Status: "settled", v2ResultKind: "normal", anyCandidateForRaceBet: true, anyActiveForRaceBet: true }).classification, "MANUAL_REVIEW_REQUIRED");
  // いずれも auto-apply 不可
  for (const s of ["refunded", "settled"] as const) assert.equal(classifyUnexpectedAddition({ betType: "win", v2Status: s, v2ResultKind: "normal", anyCandidateForRaceBet: false, anyActiveForRaceBet: false }).autoApplyEligible, false);
});

test("action classifiers", () => {
  assert.equal(isSupersedingAction("false_refund_correction"), true);
  assert.equal(isSupersedingAction("result_kind_correction"), true);
  assert.equal(isSupersedingAction("special_payout_addition"), false);
  assert.equal(isAppendingAction("special_payout_addition"), true);
  assert.equal(isAppendingAction("exact"), false);
  assert.equal(candidateKey("2020-05-01:12:R1", "trifecta"), "2020-05-01:12:R1 trifecta");
});
